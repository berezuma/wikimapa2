// data/ karpetako fitxategi berriak egiaztatzen ditu, aurreko commit-ekoekin (git HEAD) alderatuta (npm run check:data).
// Akatsik badago, 1 kodearekin amaitzen da: eguneratze automatikoak ez du ezer igotzen.
// GitHub Actions-en, irteerak idazten ditu: changed (true/false) eta summary.
import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_DROP = 0.1; // artikulu-kopurua % 10 baino gehiago jaitsiz gero, zerbait gaizki dago (Wikidata, sarea...)
const MIN_ARTICLES = 5000;

const readCurrent = async (file) => JSON.parse(await readFile(`${ROOT}${file}`, 'utf8'));
const readPrevious = (file) => {
    try {
        return JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
        return null; // lehen aldia
    }
};

const errors = [];
const fail = (message) => errors.push(message);

const overview = await readCurrent('data/artikuluak.json');
const categories = await readCurrent('data/kategoriak.json');
const previousOverview = readPrevious('data/artikuluak.json');
const previousCategories = readPrevious('data/kategoriak.json');

// Egitura
if (!/^\d{4}-\d{2}-\d{2}$/.test(overview.generated || '')) fail('generated data okerra');
const { south, west, north, east } = overview.bounds || {};
if (!(south < north && west < east)) fail('bounds okerra');
if (!Array.isArray(overview.articles)) fail('articles ez da zerrenda bat');
const articles = overview.articles || [];
articles.forEach((article, i) => {
    const [title, lat, lon, types, year] = article;
    // 0,001°-ko tolerantzia: koordenatuak 4 hamartarrera biribiltzen dira
    const inside = lat >= south - 0.001 && lat <= north + 0.001 && lon >= west - 0.001 && lon <= east + 0.001;
    if (typeof title !== 'string' || !title || !inside
        || (types !== undefined && !Array.isArray(types)) || (year !== undefined && !Number.isInteger(year))) {
        if (errors.length < 10) fail(`artikulu okerra (${i}): ${JSON.stringify(article)}`);
    }
});
if (new Set(articles.map(a => a[0])).size !== articles.length) fail('izenburu bikoiztuak');

// Kategoriak: index.html-eko data-category guztiak, azpiklaseekin
const html = await readFile(`${ROOT}index.html`, 'utf8');
const qids = [...new Set([...html.matchAll(/data-category="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)))];
qids.forEach(qid => {
    if (!Array.isArray(categories[qid]) || categories[qid].length === 0) fail(`${qid} kategoriak ez du azpiklaserik`);
});

// Kopuruak, aurrekoarekin alderatuta
const dated = articles.filter(a => a.length > 4).length;
if (articles.length < MIN_ARTICLES) fail(`artikulu gutxiegi: ${articles.length}`);
if (previousOverview) {
    const before = previousOverview.articles.length;
    const datedBefore = previousOverview.articles.filter(a => a.length > 4).length;
    if (articles.length < before * (1 - MAX_DROP)) fail(`artikuluak jaitsi dira: ${before} → ${articles.length}`);
    if (dated < datedBefore * (1 - MAX_DROP)) fail(`datatutako lekuak jaitsi dira: ${datedBefore} → ${dated}`);
}

// Aldaketak (data kenduta)
const strip = (data) => data && JSON.stringify({ ...data, generated: undefined });
const changed = strip(overview) !== strip(previousOverview) || JSON.stringify(categories) !== JSON.stringify(previousCategories);
const before = previousOverview?.articles.length;
const titlesBefore = new Set(previousOverview?.articles.map(a => a[0]) || []);
const added = articles.filter(a => !titlesBefore.has(a[0])).length;
const removed = before === undefined ? 0 : before - (articles.length - added);
const summary = `${articles.length} artikulu (+${added}, -${removed}), ${dated} datatu`;

console.log(errors.length ? `AKATSAK:\n- ${errors.join('\n- ')}` : 'Datuak zuzenak.');
console.log(`${summary}; ${changed ? 'aldaketak daude' : 'aldaketarik ez'}.`);

if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed && !errors.length}\nsummary=${summary}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Datuak\n\n${summary}\n\n${errors.length ? `**Akatsak:**\n- ${errors.join('\n- ')}` : (changed ? 'Aldaketak igoko dira.' : 'Aldaketarik ez.')}\n`);
}
process.exit(errors.length ? 1 : 0);
