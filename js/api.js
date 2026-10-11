// Wikipedia eta Wikidata APIetarako sarbidea. Ez du maparekin edo DOMarekin zerikusirik.

const WIKIPEDIA_API_ENDPOINT = "https://eu.wikipedia.org/w/api.php";
const WIKIDATA_SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_API_ENDPOINT = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_ARTICLE_PREFIX = "https://eu.wikipedia.org/wiki/";

// Geosearch-en muga: 10 km-ko erradioa gehienez
const GEOSEARCH_MAX_RADIUS_M = 10000;

const buildUrl = (endpoint, params) => {
    const url = new URL(endpoint);
    url.search = new URLSearchParams(params).toString();
    return url.toString();
};

// fetch + HTTP eta APIaren erroreen egiaztapena
export const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    const data = await response.json();
    if (data && data.error) {
        const error = new Error(data.error.info || data.error.code);
        error.code = data.error.code;
        throw error;
    }
    return data;
};

export const isAbortError = (error) => error.name === 'AbortError';

const wikipediaApi = (params, signal) =>
    fetchJson(buildUrl(WIKIPEDIA_API_ENDPOINT, { ...params, format: 'json', origin: '*' }), { signal });
const wikidataApi = (params, signal) =>
    fetchJson(buildUrl(WIKIDATA_API_ENDPOINT, { ...params, format: 'json', origin: '*' }), { signal });

const sleep = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

// Geosearch CirrusSearch-ek egiten du, eta erabiltzaileko aldibereko bilaketak mugatzen ditu.
// Bertan behera utzitako eskaerek zerbitzarian jarraitzen dute, beraz hurrengoak "too busy" jaso dezake.
const geosearch = async (params, signal) => {
    const retryDelays = [700, 1500];
    for (let attempt = 0; ; attempt++) {
        try {
            const data = await wikipediaApi({ action: "query", list: "geosearch", gslimit: "500", ...params }, signal);
            return data.query?.geosearch || [];
        } catch (error) {
            if (error.code !== 'cirrussearch-too-busy-error' || attempt >= retryDelays.length) throw error;
            await sleep(retryDelays[attempt], signal);
        }
    }
};

// bounds: { north, south, east, west }
export const geosearchBox = (bounds, signal) =>
    geosearch({ gsbbox: `${bounds.north}|${bounds.west}|${bounds.south}|${bounds.east}` }, signal);

export const geosearchAround = ({ lat, lon }, signal) =>
    geosearch({ gscoord: `${lat}|${lon}`, gsradius: String(GEOSEARCH_MAX_RADIUS_M) }, signal);

// Izenburuak -> pageid, 50eko multzoetan (APIaren muga)
const getPageIds = async (titles, signal) => {
    const pageIds = new Map();
    for (let i = 0; i < titles.length; i += 50) {
        const chunk = titles.slice(i, i + 50);
        const data = await wikipediaApi({ action: 'query', titles: chunk.join('|') }, signal);
        Object.values(data.query?.pages || {}).forEach(page => {
            if (page.pageid) pageIds.set(page.title, page.pageid);
        });
    }
    return pageIds;
};

// Wikidatako kategorietako (Q-id) elementuak, euskarazko artikulua dutenak, bounds barruan
export const fetchCategoryArticles = async (categories, bounds, signal) => {
    const categoryValues = categories.map(cat => `wd:${cat}`).join(' ');
    const sparqlQuery = `
        SELECT ?item ?location ?article WHERE {
            VALUES ?category { ${categoryValues} }
            ?item wdt:P31/wdt:P279* ?category.

            SERVICE wikibase:box {
              ?item wdt:P625 ?location.
              bd:serviceParam wikibase:cornerWest "Point(${bounds.west} ${bounds.south})"^^geo:wktLiteral.
              bd:serviceParam wikibase:cornerEast "Point(${bounds.east} ${bounds.north})"^^geo:wktLiteral.
            }

            ?article schema:about ?item;
                     schema:isPartOf <https://eu.wikipedia.org/>.
        } LIMIT 1000`;

    const url = buildUrl(WIKIDATA_SPARQL_ENDPOINT, { query: sparqlQuery, format: 'json' });
    const data = await fetchJson(url, { headers: { 'Accept': 'application/sparql-results+json' }, signal });

    // Elementu bakoitzeko lehen emaitza bakarrik (kategoria edo koordenatu bat baino gehiago izan ditzake).
    // Izenburua artikuluaren URLtik ateratzen da, ez etiketatik: etiketa eta izenburua ez dira beti berdinak.
    const byTitle = new Map();
    data.results.bindings.forEach(row => {
        const articleUrl = row.article.value;
        if (!articleUrl.startsWith(WIKIPEDIA_ARTICLE_PREFIX)) return;
        const title = decodeURIComponent(articleUrl.slice(WIKIPEDIA_ARTICLE_PREFIX.length)).replace(/_/g, ' ');
        const coord = row.location.value.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
        if (!coord || byTitle.has(title)) return;
        byTitle.set(title, { title, lat: parseFloat(coord[2]), lon: parseFloat(coord[1]) });
    });

    const pageIds = await getPageIds([...byTitle.keys()], signal);
    return [...byTitle.values()]
        .filter(article => pageIds.has(article.title))
        .map(article => ({ ...article, pageid: pageIds.get(article.title) }));
};

export const fetchSummary = async (pageid) => {
    const data = await wikipediaApi({ action: 'query', pageids: pageid, prop: 'extracts|pageimages', exintro: 'true', explaintext: 'true', pithumbsize: '200' });
    const page = data.query?.pages?.[pageid];
    if (!page) return null;
    return { extract: page.extract || 'Ez da laburpenik aurkitu.', imageSrc: page.thumbnail?.source };
};

export const searchTitles = async (query, signal) => {
    const data = await wikipediaApi({ action: 'opensearch', search: query, limit: '5', namespace: '0' }, signal);
    return data[1] || [];
};

// Orria eta bere koordenatuak (badaude); null orria ez badago
export const fetchPage = async (title) => {
    const data = await wikipediaApi({ action: 'query', titles: title, prop: 'coordinates', redirects: '1' });
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;
    return { pageid: page.pageid, title: page.title, coords: page.coordinates?.[0] || null };
};

// Koordenaturik gabeko artikuluentzat, Wikidatan kokapen erlazionatu bat bilatu
export const findLocationViaWikidata = async (pageId) => {
    try {
        const pagePropsData = await wikipediaApi({ action: 'query', pageids: pageId, prop: 'pageprops' });
        const wikidataId = pagePropsData.query?.pages?.[pageId]?.pageprops?.wikibase_item;
        if (!wikidataId) return null;

        // Lehentasun-ordenan: jaiotza-lekua, sorrera-lekua, kokapena, administrazio-unitatea
        const locationProperties = ['P19', 'P740', 'P276', 'P131'];
        const claimsData = await wikidataApi({ action: 'wbgetclaims', entity: wikidataId });

        let locationId = null;
        for (const prop of locationProperties) {
            // "somevalue"/"novalue" adierazpenek ez dute datavalue-rik
            const claim = claimsData.claims?.[prop]?.find(c => c.mainsnak?.datavalue?.value?.id);
            if (claim) {
                locationId = claim.mainsnak.datavalue.value.id;
                break;
            }
        }

        if (!locationId) return null;

        const entitiesData = await wikidataApi({ action: 'wbgetentities', ids: locationId, props: 'claims|labels', languages: 'eu' });
        const locationEntity = entitiesData.entities?.[locationId];
        const coordsValue = locationEntity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
        const locTitle = locationEntity?.labels?.eu?.value || locationId;

        if (coordsValue) {
            return { title: locTitle, coords: { lat: coordsValue.latitude, lon: coordsValue.longitude } };
        }
    } catch (error) {
        console.error("Errorea Wikidata kontsultatzean:", error);
    }
    return null;
};
