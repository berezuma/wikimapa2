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

// Geosearch eta opensearch CirrusSearch-ek egiten ditu, eta erabiltzaileko aldibereko bilaketak mugatzen ditu.
// Bertan behera utzitako eskaerek zerbitzarian jarraitzen dute, beraz hurrengoak "too busy" jaso dezake.
const searchApi = async (params, signal) => {
    const retryDelays = [700, 1500];
    for (let attempt = 0; ; attempt++) {
        try {
            return await wikipediaApi(params, signal);
        } catch (error) {
            if (error.code !== 'cirrussearch-too-busy-error' || attempt >= retryDelays.length) throw error;
            await sleep(retryDelays[attempt], signal);
        }
    }
};

const geosearch = async (params, signal) => {
    const data = await searchApi({ action: "query", list: "geosearch", gslimit: "500", ...params }, signal);
    return data.query?.geosearch || [];
};

// bounds: { north, south, east, west }
export const geosearchBox = (bounds, signal) =>
    geosearch({ gsbbox: `${bounds.north}|${bounds.west}|${bounds.south}|${bounds.east}` }, signal);

export const geosearchAround = ({ lat, lon }, signal) =>
    geosearch({ gscoord: `${lat}|${lon}`, gsradius: String(GEOSEARCH_MAX_RADIUS_M) }, signal);

const parseTitle = (articleUrl) => decodeURIComponent(articleUrl.slice(WIKIPEDIA_ARTICLE_PREFIX.length)).replace(/_/g, ' ');
const parsePoint = (wkt) => {
    const coord = wkt.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
    return coord ? { lat: parseFloat(coord[2]), lon: parseFloat(coord[1]) } : null;
};

// Eremuko euskarazko artikulu guztiak, Wikidatako motekin (P31, Q-zenbaki gisa).
// Kategoriaren araberako iragazketa bezeroan egiten da (filterByCategories): P279* bidea
// kontsultan sartzean 10-60 s behar ditu Wikidatak, eta hau 3-5 s-tan egiten da.
export const fetchAreaArticles = async (bounds, signal) => {
    const sparqlQuery = `
        SELECT ?location ?article ?type WHERE {
            SERVICE wikibase:box {
              ?item wdt:P625 ?location.
              bd:serviceParam wikibase:cornerWest "Point(${bounds.west} ${bounds.south})"^^geo:wktLiteral.
              bd:serviceParam wikibase:cornerEast "Point(${bounds.east} ${bounds.north})"^^geo:wktLiteral.
            }
            ?article schema:about ?item;
                     schema:isPartOf <https://eu.wikipedia.org/>.
            OPTIONAL { ?item wdt:P31 ?type. }
        }`;

    const url = buildUrl(WIKIDATA_SPARQL_ENDPOINT, { query: sparqlQuery, format: 'json' });
    const data = await fetchJson(url, { headers: { 'Accept': 'application/sparql-results+json' }, signal });

    // Izenburua artikuluaren URLtik ateratzen da, ez etiketatik: etiketa eta izenburua ez dira beti berdinak.
    // Elementu batek errenkada bat du mota eta koordenatu bakoitzeko; izenburuaren arabera biltzen dira.
    const byTitle = new Map();
    data.results.bindings.forEach(row => {
        if (!row.article.value.startsWith(WIKIPEDIA_ARTICLE_PREFIX)) return;
        const title = parseTitle(row.article.value);
        let article = byTitle.get(title);
        if (!article) {
            const point = parsePoint(row.location.value);
            if (!point) return;
            article = { title, ...point, types: [] };
            byTitle.set(title, article);
        }
        if (row.type) {
            const type = Number(row.type.value.slice(row.type.value.lastIndexOf('/Q') + 2));
            if (type && !article.types.includes(type)) article.types.push(type);
        }
    });
    return [...byTitle.values()];
};

// categories: data-category balioak ("Q1" edo "Q1 Q2"); subclasses: data/kategoriak.json ({ Q-id: [zenbakiak] })
export const filterByCategories = (articles, categories, subclasses) => {
    const wanted = new Set(categories.flatMap(category => category.split(/\s+/)).flatMap(qid => subclasses[qid] || []));
    return articles.filter(article => article.types.some(type => wanted.has(type)));
};

// Artikuluen irudi txikiak (izenburua -> URL edo null), 50eko sortetan (APIaren muga)
export const fetchThumbnails = async (titles, signal) => {
    const thumbnails = new Map();
    for (let i = 0; i < titles.length; i += 50) {
        const chunk = titles.slice(i, i + 50);
        const data = await wikipediaApi({
            action: 'query', titles: chunk.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '96', pilimit: '50',
        }, signal);
        // Izenburu normalizatuak (adib. lehen letra larria) jatorrizkora itzuli
        const original = new Map((data.query?.normalized || []).map(n => [n.to, n.from]));
        Object.values(data.query?.pages || {}).forEach(page => {
            thumbnails.set(original.get(page.title) || page.title, page.thumbnail?.source || null);
        });
        chunk.forEach(title => { if (!thumbnails.has(title)) thumbnails.set(title, null); });
    }
    return thumbnails;
};

// Aurrez sortutako datuak (npm run build:data)
export const fetchSubclasses = () => fetchJson('data/kategoriak.json');

export const fetchOverviewArticles = async () => {
    const data = await fetchJson('data/artikuluak.json');
    return {
        bounds: data.bounds,
        articles: data.articles.map(([title, lat, lon, types = []]) => ({ title, lat, lon, types })),
    };
};

export const fetchSummary = async (title) => {
    const data = await wikipediaApi({ action: 'query', titles: title, redirects: '1', prop: 'extracts|pageimages', exintro: 'true', explaintext: 'true', pithumbsize: '200' });
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;
    return { extract: page.extract || 'Ez da laburpenik aurkitu.', imageSrc: page.thumbnail?.source };
};

// Izenburu-hasieraren araberako bilaketa, deskribapen, irudi txiki eta koordenatuekin (eskaera bakarra)
export const searchArticles = async (query, signal) => {
    const data = await searchApi({
        action: 'query', generator: 'prefixsearch', gpssearch: query, gpslimit: '6', gpsnamespace: '0',
        prop: 'description|pageimages|coordinates', piprop: 'thumbnail', pithumbsize: '80', pilimit: '6', redirects: '1',
    }, signal);
    return Object.values(data.query?.pages || {})
        .sort((a, b) => a.index - b.index)
        .map(page => ({
            title: page.title,
            description: page.description || '',
            thumbnail: page.thumbnail?.source || null,
            hasCoords: Boolean(page.coordinates?.length),
        }));
};

// Orria eta bere koordenatuak (badaude); null orria ez badago
export const fetchPage = async (title) => {
    const data = await wikipediaApi({ action: 'query', titles: title, prop: 'coordinates', redirects: '1' });
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;
    return { title: page.title, coords: page.coordinates?.[0] || null };
};

// Koordenaturik gabeko artikuluentzat, Wikidatan kokapen erlazionatu bat bilatu
export const findLocationViaWikidata = async (title) => {
    try {
        const pagePropsData = await wikipediaApi({ action: 'query', titles: title, prop: 'pageprops' });
        const wikidataId = Object.values(pagePropsData.query?.pages || {})[0]?.pageprops?.wikibase_item;
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
