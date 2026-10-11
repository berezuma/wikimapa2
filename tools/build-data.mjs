// data/ karpetako fitxategi estatikoak sortzen ditu Wikidatatik (npm run build:data):
//  - data/kategoriak.json: iragazki bakoitzeko Q-id-aren azpiklase guztiak (P279*), zenbaki gisa.
//    Kategoriak index.html-eko data-category atributuetatik irakurtzen dira.
//  - data/artikuluak.json: Euskal Herriko eremuko (ehmuga.json + marjina) euskarazko artikulu
//    geolokalizatu guztiak, [izenburua, lat, lon, motak?, urtea?] gisa (motak: P31 Q-zenbakiak;
//    urtea: sorrera/irekiera/hasiera/lehen aipamena, txikiena), bista orokorrerako, iragazkietarako
//    eta denbora-lerrorako.
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
const formatOverview = ({ generated, bounds, articles }) =>
    `{"generated": ${JSON.stringify(generated)}, "bounds": ${JSON.stringify(bounds)}, "articles": [\n` +
    articles.map(article => JSON.stringify(article)).join(',\n') + '\n]}\n';

await mkdir(`${ROOT}data`, { recursive: true });
console.log('Kategoriak...');
await writeFile(`${ROOT}data/kategoriak.json`, formatCategories(await buildCategories()));
console.log('Artikuluak...');
const overview = await buildArticles();
await writeFile(`${ROOT}data/artikuluak.json`, formatOverview({ generated: new Date().toISOString().slice(0, 10), ...overview }));
console.log(`Eginda: ${overview.articles.length} artikulu.`);
