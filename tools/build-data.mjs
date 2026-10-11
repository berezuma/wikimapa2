// data/ karpetako fitxategi estatikoak sortzen ditu Wikidatatik (npm run build:data):
//  - data/kategoriak.json: iragazki bakoitzeko Q-id-aren azpiklase guztiak (P279*), zenbaki gisa.
//    Kategoriak index.html-eko data-category atributuetatik irakurtzen dira.
//  - data/artikuluak.json: Euskal Herriko eremuko (ehmuga.json + marjina) euskarazko artikulu
//    geolokalizatu guztiak, [izenburua, lat, lon, motak?, urtea?] gisa (motak: P31 Q-zenbakiak;
//    urtea: sorrera/irekiera/hasiera/lehen aipamena, txikiena), bista orokorrerako, iragazkietarako
//    eta denbora-lerrorako.
//  - data/falta.json: Euskal Herriko mugaren barruko lekuak, Wikipediaren beste hizkuntzaren batean
//    artikulua dutenak baina euskaraz ez ("Zer falta da" geruza). Gertaerak (Q1190554) kanpoan.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'euswikimapa-build/1.0 (https://github.com/berezuma/euswikimapa; info@berezuma.com)';
const ARTICLE_PREFIX = 'https://eu.wikipedia.org/wiki/';
const REGION_MARGIN_DEG = 0.25;
const TILES = 4; // eremua TILES x TILES zatitan kontsultatzen da, timeout-ak saihesteko
// Denbora-lerrorako: sorrera (P571), irekiera (P1619), hasiera (P580) edo lehen aipamen idatzia (P1249).
// Hortik aurrerako datak (formazio geologikoak, adib. mendiak) ez dira kontuan hartzen.
const DATE_PROPERTIES = 'wdt:P571|wdt:P1619|wdt:P580|wdt:P1249';
const MIN_YEAR = -10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sparql = async (query, attempts = 4) => {
    for (let attempt = 1; ; attempt++) {
        const response = await fetch(SPARQL_ENDPOINT, {
            method: 'POST',
            headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ query }),
        });
        if (response.ok) return (await response.json()).results.bindings;
        if (attempt >= attempts) throw new Error(`SPARQL ${response.status}: ${(await response.text()).slice(0, 200)}`);
        console.warn(`  SPARQL ${response.status}, berriz saiatzen (${attempt})...`);
        await sleep(5000 * attempt);
    }
};

const qidNumber = (uri) => Number(uri.slice(uri.lastIndexOf('/Q') + 2));
const round = (value) => Math.round(value * 1e4) / 1e4;

const buildCategories = async () => {
    const html = await readFile(`${ROOT}index.html`, 'utf8');
    const qids = [...new Set([...html.matchAll(/data-category="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)))];
    const categories = {};
    for (const qid of qids) {
        const rows = await sparql(`SELECT ?class WHERE { ?class wdt:P279* wd:${qid} }`);
        categories[qid] = [...new Set(rows.map(row => qidNumber(row.class.value)))].sort((a, b) => a - b);
        console.log(`  ${qid}: ${categories[qid].length} azpiklase`);
    }
    return categories;
};

const buildArticles = async () => {
    const border = JSON.parse(await readFile(`${ROOT}ehmuga.json`, 'utf8'));
    const lats = border.map(p => p[0]);
    const lons = border.map(p => p[1]);
    const south = Math.min(...lats) - REGION_MARGIN_DEG;
    const north = Math.max(...lats) + REGION_MARGIN_DEG;
    const west = Math.min(...lons) - REGION_MARGIN_DEG;
    const east = Math.max(...lons) + REGION_MARGIN_DEG;
    const articles = new Map();

    for (let i = 0; i < TILES; i++) {
        for (let j = 0; j < TILES; j++) {
            const s = south + ((north - south) * i) / TILES;
            const n = south + ((north - south) * (i + 1)) / TILES;
            const w = west + ((east - west) * j) / TILES;
            const e = west + ((east - west) * (j + 1)) / TILES;
            const rows = await sparql(`
                SELECT ?location ?article ?type WHERE {
                    SERVICE wikibase:box {
                        ?item wdt:P625 ?location.
                        bd:serviceParam wikibase:cornerWest "Point(${w} ${s})"^^geo:wktLiteral.
                        bd:serviceParam wikibase:cornerEast "Point(${e} ${n})"^^geo:wktLiteral.
                    }
                    ?article schema:about ?item; schema:isPartOf <https://eu.wikipedia.org/>.
                    OPTIONAL { ?item wdt:P31 ?type. }
                }`);
            rows.forEach(row => {
                const title = decodeURIComponent(row.article.value.slice(ARTICLE_PREFIX.length)).replace(/_/g, ' ');
                const coord = row.location.value.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
                if (!coord) return;
                if (!articles.has(title)) articles.set(title, [title, round(parseFloat(coord[2])), round(parseFloat(coord[1])), []]);
                const types = articles.get(title)[3];
                const type = row.type ? qidNumber(row.type.value) : 0;
                if (type && !types.includes(type)) types.push(type);
            });
            const dated = await sparql(`
                SELECT ?article (MIN(YEAR(?date)) AS ?year) WHERE {
                    SERVICE wikibase:box {
                        ?item wdt:P625 ?location.
                        bd:serviceParam wikibase:cornerWest "Point(${w} ${s})"^^geo:wktLiteral.
                        bd:serviceParam wikibase:cornerEast "Point(${e} ${n})"^^geo:wktLiteral.
                    }
                    ?article schema:about ?item; schema:isPartOf <https://eu.wikipedia.org/>.
                    ?item ${DATE_PROPERTIES} ?date.
                } GROUP BY ?article`);
            dated.forEach(row => {
                const title = decodeURIComponent(row.article.value.slice(ARTICLE_PREFIX.length)).replace(/_/g, ' ');
                const year = row.year ? Number(row.year.value) : NaN;
                const article = articles.get(title);
                if (article && Number.isFinite(year) && year >= MIN_YEAR) {
                    article[4] = article[4] === undefined ? year : Math.min(article[4], year);
                }
            });
            console.log(`  zatia ${i * TILES + j + 1}/${TILES * TILES}: ${rows.length} errenkada, ${dated.length} data (guztira ${articles.size})`);
        }
    }
    return {
        bounds: { south, west, north, east },
        // Motarik eta urterik gabeko artikuluek 3 elementu besterik ez dute (fitxategia txikiagoa)
        articles: [...articles.values()]
            .map(article => (article[4] !== undefined ? article : article[3].length ? article.slice(0, 4) : article.slice(0, 3)))
            // Kode-puntuen ordena (ez localeCompare): makina guztietan berdina, diff garbiak
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    };
};

// Elementu bat lerro bakoitzeko: astero eguneratzean, git-ek aldatutako lerroak bakarrik gordetzen ditu
const formatCategories = (categories) =>
    '{\n' + Object.entries(categories).map(([qid, types]) => `${JSON.stringify(qid)}: ${JSON.stringify(types)}`).join(',\n') + '\n}\n';
// Itzultzeko iturri hobetsiak (lehena dagoena). js/app.js-eko TRANSLATABLE_LANGUAGES-ekin bat etorri behar du:
// beste hizkuntzak (zebuanoa, errumaniera... bot-zirriborroak) ez dira itzultzeko eskaintzen
const SOURCE_LANGUAGES = ['es', 'fr', 'en', 'ca', 'gl', 'it', 'de', 'pt', 'oc', 'an'];
const EVENT_CLASS = 'Q1190554'; // gertaera

// Puntua poligonoaren barruan dagoen ([lat, lon] puntuak)
const insidePolygon = (polygon, lat, lon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [yi, xi] = polygon[i];
        const [yj, xj] = polygon[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
};

const buildMissing = async () => {
    const border = JSON.parse(await readFile(`${ROOT}ehmuga.json`, 'utf8'));
    const lats = border.map(p => p[0]);
    const lons = border.map(p => p[1]);
    const [south, north, west, east] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
    const items = new Map(); // qid -> { label, lat, lon, articles: Map(hizkuntza -> izenburua), types: Set }

    for (let i = 0; i < TILES; i++) {
        for (let j = 0; j < TILES; j++) {
            const s = south + ((north - south) * i) / TILES;
            const n = south + ((north - south) * (i + 1)) / TILES;
            const w = west + ((east - west) * j) / TILES;
            const e = west + ((east - west) * (j + 1)) / TILES;
            const rows = await sparql(`
                SELECT ?item ?location ?article ?type ?label WHERE {
                    SERVICE wikibase:box {
                        ?item wdt:P625 ?location.
                        bd:serviceParam wikibase:cornerWest "Point(${w} ${s})"^^geo:wktLiteral.
                        bd:serviceParam wikibase:cornerEast "Point(${e} ${n})"^^geo:wktLiteral.
                    }
                    ?article schema:about ?item; schema:isPartOf ?wiki.
                    ?wiki wikibase:wikiGroup "wikipedia".
                    FILTER NOT EXISTS { ?euArticle schema:about ?item; schema:isPartOf <https://eu.wikipedia.org/>. }
                    OPTIONAL { ?item wdt:P31 ?type. }
                    OPTIONAL { ?item rdfs:label ?label. FILTER(LANG(?label) = "eu") }
                }`);
            rows.forEach(row => {
                const coord = row.location.value.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
                if (!coord) return;
                const lat = parseFloat(coord[2]);
                const lon = parseFloat(coord[1]);
                if (!insidePolygon(border, lat, lon)) return;
                const qid = row.item.value.slice(row.item.value.lastIndexOf('/') + 1);
                if (!items.has(qid)) items.set(qid, { label: null, lat: round(lat), lon: round(lon), articles: new Map(), types: new Set() });
                const item = items.get(qid);
                const url = new URL(row.article.value);
                item.articles.set(url.hostname.split('.')[0], decodeURIComponent(url.pathname.slice('/wiki/'.length)).replace(/_/g, ' '));
                if (row.type) item.types.add(qidNumber(row.type.value));
                if (row.label) item.label = row.label.value;
            });
            console.log(`  zatia ${i * TILES + j + 1}/${TILES * TILES}: ${rows.length} errenkada (guztira ${items.size})`);
        }
    }

    // Gertaerak kanpoan: moten artean zein diren gertaeraren azpiklase (kontsulta bakarra)
    const allTypes = [...new Set([...items.values()].flatMap(item => [...item.types]))];
    const eventTypes = new Set();
    // gearing "forward": motetatik gora zeharkatu (gertaeraren azpiklase-zuhaitza izugarria da, eta alderantziz timeout)
    for (let i = 0; i < allTypes.length; i += 100) {
        const values = allTypes.slice(i, i + 100).map(type => `wd:Q${type}`).join(' ');
        const rows = await sparql(`SELECT DISTINCT ?type WHERE { VALUES ?type { ${values} } ?type wdt:P279* wd:${EVENT_CLASS}. hint:Prior hint:gearing "forward". }`);
        rows.forEach(row => eventTypes.add(qidNumber(row.type.value)));
    }

    const missing = [...items.entries()]
        .filter(([, item]) => ![...item.types].some(type => eventTypes.has(type)))
        .map(([qid, item]) => {
            const source = SOURCE_LANGUAGES.find(lang => item.articles.has(lang)) || null;
            const fallbackLang = source || [...item.articles.keys()].sort()[0];
            const name = item.label || item.articles.get(source || fallbackLang);
            // [qid, izena, lat, lon, hizkuntza-kopurua, iturri-hizkuntza, iturri-izenburua, motak]
            return [qid, name, item.lat, item.lon, item.articles.size, fallbackLang, item.articles.get(fallbackLang), [...item.types].sort((a, b) => a - b)];
        })
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    console.log(`  ${items.size - missing.length} gertaera kanpoan`);
    return missing;
};

const formatMissing = ({ generated, items }) =>
    `{"generated": ${JSON.stringify(generated)}, "items": [\n` + items.map(item => JSON.stringify(item)).join(',\n') + '\n]}\n';

const formatOverview = ({ generated, bounds, articles }) =>
    `{"generated": ${JSON.stringify(generated)}, "bounds": ${JSON.stringify(bounds)}, "articles": [\n` +
    articles.map(article => JSON.stringify(article)).join(',\n') + '\n]}\n';

// Argumentu batekin, fitxategi hori bakarrik: node tools/build-data.mjs [kategoriak|artikuluak|falta]
const only = process.argv[2];
const today = new Date().toISOString().slice(0, 10);
await mkdir(`${ROOT}data`, { recursive: true });
if (!only || only === 'kategoriak') {
    console.log('Kategoriak...');
    await writeFile(`${ROOT}data/kategoriak.json`, formatCategories(await buildCategories()));
}
if (!only || only === 'artikuluak') {
    console.log('Artikuluak...');
    const overview = await buildArticles();
    await writeFile(`${ROOT}data/artikuluak.json`, formatOverview({ generated: today, ...overview }));
    console.log(`  ${overview.articles.length} artikulu`);
}
if (!only || only === 'falta') {
    console.log('Falta direnak...');
    const missing = await buildMissing();
    await writeFile(`${ROOT}data/falta.json`, formatMissing({ generated: today, items: missing }));
    console.log(`  ${missing.length} falta`);
}
console.log('Eginda.');
