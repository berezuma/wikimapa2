// --- Bikoiztuak kentzea. Wikidatan leku batzuk bi aldiz daude: adibidez, zebuanozko bot batek GeoNames-etik
// sortutako "Leioa (lungsod)", euskarazko artikulua duen Leioarekin lotu gabe; edo Arabako kontzejuak, euskarazko
// Wikipediak udalerriaren artikuluan biltzen dituenak. Falta den leku bat bikoiztutzat hartzen da, inguruan
// izen bera (parentesiak, hitz orokorrak eta azentuak kenduta), hitz-mota bera (eliza/iglesia, dorrea/torre...)
// eta leku-talde bateragarria (herriak, kultura, natura) duen euskarazko artikulu bat badago.
const WORD_CLASSES = {
    eliza: 'iglesia eglise eliza parroquia parrokia simbahan',
    baseliza: 'ermita ermitage baseliza capilla chapelle kapera santuario',
    dorrea: 'torre tour dorrea dorretxea',
    mendia: 'monte mont mendi mendia pico pic pena alto bukid bungtod kabukiran sierra mendilerroa tontor',
    ibaia: 'rio ibaia ibai arroyo erreka riviere suba ugalde',
    gaztelua: 'castillo chateau gaztelua',
    zubia: 'puente pont zubia',
    geltokia: 'estacion gare geltokia',
};
const WORD_CLASS = new Map(Object.entries(WORD_CLASSES).flatMap(([cls, words]) => words.split(' ').map(word => [word, cls])));
const STOP_WORDS = new Set(('de del la el los las le les du des d l y eta san santa saint sainte done lungsod concejo localidad '
    + 'municipio udalerria herria commune village pueblo kapital sa munisipyo baryo').split(' '));
const DUPLICATE_MAX_KM = 3;
const DUPLICATE_MAX_KM_BUILDING = 0.6; // izen bereko eliza/dorre asko daude (San Pedro...): oso gertu bakarrik

const analyseName = (title) => {
    const words = title.replace(/\(.*?\)/g, ' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9ñ ]/g, ' ').split(/\s+/).filter(Boolean);
    return {
        core: words.filter(word => !WORD_CLASS.has(word) && !STOP_WORDS.has(word)).join(' '),
        classes: [...new Set(words.filter(word => WORD_CLASS.has(word)).map(word => WORD_CLASS.get(word)))].sort().join(' '),
    };
};

const distanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
};

// Leku-taldea (index.html-eko iragazki-taldeak, app.js-eko articleGroup bezala)
export const groupMatcher = (html, categories) => {
    const headings = [...html.matchAll(/data-group="(\w+)"/g)];
    const groups = headings.map((heading, i) => {
        const section = html.slice(heading.index, headings[i + 1]?.index ?? html.indexOf('</div>', heading.index + 1));
        const types = new Set([...section.matchAll(/data-category="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)).flatMap(qid => categories[qid] || []));
        return [heading[1], types];
    });
    return (types = []) => groups.find(([, set]) => types.some(type => set.has(type)))?.[0] || 'besteak';
};

export const removeDuplicates = (missing, articles, groupOf) => {
    // Sareta (0,1°) inguruko artikuluak azkar bilatzeko
    const grid = new Map();
    articles.forEach(([title, lat, lon, types]) => {
        const key = `${Math.round(lat * 10)},${Math.round(lon * 10)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ title, lat, lon, group: groupOf(types), ...analyseName(title) });
    });
    const nearby = (lat, lon) => [-1, 0, 1].flatMap(dx => [-1, 0, 1].flatMap(dy => grid.get(`${Math.round(lat * 10) + dx},${Math.round(lon * 10) + dy}`) || []));

    return missing.filter(([, name, lat, lon, , , sourceTitle, types]) => {
        const group = groupOf(types);
        const keys = [analyseName(name), analyseName(sourceTitle)].filter(key => key.core);
        return !nearby(lat, lon).some(article => {
            const km = distanceKm(lat, lon, article.lat, article.lon);
            return keys.some(key => key.core === article.core && key.classes === article.classes
                && (group === article.group || group === 'besteak' || article.group === 'besteak')
                && km <= (key.classes ? DUPLICATE_MAX_KM_BUILDING : DUPLICATE_MAX_KM));
        });
    });
};
