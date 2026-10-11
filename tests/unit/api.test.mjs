// js/api.js-en probak, fetch simulatuarekin (sarerik gabe)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    fetchJson, searchArticles, geosearchBox, geosearchAround, fetchAreaArticles, filterByCategories, fetchOverviewArticles,
    fetchPage, findLocationViaWikidata
} from '../../js/api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// handler(url) -> erantzunaren JSONa (edo { status } HTTP errorerako). Deiak gordetzen ditu.
const mockFetch = (handler) => {
    const calls = [];
    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(input, 'http://localhost/');
        calls.push(url);
        const body = await handler(url, options);
        const status = body?.__status || 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        };
    };
    return calls;
};

const sparqlRow = (lon, lat, title, type) => ({
    location: { value: `Point(${lon} ${lat})` },
    article: { value: `https://eu.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` },
    ...(type ? { type: { value: `http://www.wikidata.org/entity/${type}` } } : {}),
});

test('fetchJson: HTTP errorea jaurtitzen du', async () => {
    mockFetch(() => ({ __status: 503 }));
    await assert.rejects(fetchJson('https://example.org/x'), /HTTP 503/);
});

test('fetchJson: MediaWikiren errorea code-arekin jaurtitzen du', async () => {
    mockFetch(() => ({ error: { code: 'toobig', info: 'Bounding box is too big' } }));
    await assert.rejects(fetchJson('https://example.org/x'), (error) => error.code === 'toobig');
});

test('geosearchBox: bbox iparra|mendebaldea|hegoa|ekialdea ordenan', async () => {
    const calls = mockFetch(() => ({ query: { geosearch: [{ pageid: 1, title: 'A', lat: 43, lon: -2 }] } }));
    const result = await geosearchBox({ north: 43.3, south: 43.2, east: -2.9, west: -3.0 });
    assert.equal(calls[0].searchParams.get('gsbbox'), '43.3|-3|43.2|-2.9');
    assert.equal(calls[0].searchParams.get('origin'), '*');
    assert.deepEqual(result.map(a => a.pageid), [1]);
});

test('geosearch: cirrussearch-too-busy-error jasotzean berriz saiatzen da', async () => {
    let n = 0;
    const calls = mockFetch(() => (++n === 1
        ? { error: { code: 'cirrussearch-too-busy-error', info: 'busy' } }
        : { query: { geosearch: [{ pageid: 7 }] } }));
    const result = await geosearchAround({ lat: 43, lon: -2.5 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].searchParams.get('gsradius'), '10000');
    assert.deepEqual(result, [{ pageid: 7 }]);
});

test('searchArticles: index ordenan, deskribapen eta irudiarekin; too busy berriz saiatu', async () => {
    let n = 0;
    const calls = mockFetch(() => (++n === 1
        ? { error: { code: 'cirrussearch-too-busy-error', info: 'busy' } }
        : { query: { pages: {
            '2': { title: 'Bilboko itsasadarra', index: 2 },
            '1': { title: 'Bilbo', index: 1, description: 'Bizkaiko hiriburua', thumbnail: { source: 'https://x/b.jpg' }, coordinates: [{ lat: 43.26, lon: -2.93 }] },
        } } }));
    assert.deepEqual(await searchArticles('Bilb'), [
        { title: 'Bilbo', description: 'Bizkaiko hiriburua', thumbnail: 'https://x/b.jpg', hasCoords: true },
        { title: 'Bilboko itsasadarra', description: '', thumbnail: null, hasCoords: false },
    ]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].searchParams.get('gpssearch'), 'Bilb');
});

test('geosearch: beste erroreekin ez da berriz saiatzen', async () => {
    const calls = mockFetch(() => ({ error: { code: 'toobig', info: 'too big' } }));
    await assert.rejects(geosearchBox({ north: 44, south: 42, east: -1, west: -4 }), (error) => error.code === 'toobig');
    assert.equal(calls.length, 1);
});

test('geosearch: abort egitean itxaronaldia eteten da', async () => {
    mockFetch(() => ({ error: { code: 'cirrussearch-too-busy-error', info: 'busy' } }));
    const controller = new AbortController();
    const promise = geosearchAround({ lat: 43, lon: -2.5 }, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(promise, (error) => error.name === 'AbortError');
});

test('fetchAreaArticles: izenburua URLtik, motak izenburuka bilduta', async () => {
    const calls = mockFetch(() => ({ results: { bindings: [
        sparqlRow(-2.93, 43.26, 'Bilboko Euskal Museoa', 'Q33506'),
        sparqlRow(-2.93, 43.26, 'Bilboko Euskal Museoa', 'Q207694'),
        sparqlRow(-2.93, 43.26, 'Bilboko Euskal Museoa', 'Q33506'),
        sparqlRow(-2.92, 43.25, 'Santiago katedrala (Bilbo)', 'Q2977'),
        sparqlRow(-2.91, 43.24, 'Motarik gabea'),
    ] } }));
    const articles = await fetchAreaArticles({ north: 43.3, south: 43.2, east: -2.9, west: -3.0 });
    assert.deepEqual(articles, [
        { title: 'Bilboko Euskal Museoa', lat: 43.26, lon: -2.93, types: [33506, 207694] },
        { title: 'Santiago katedrala (Bilbo)', lat: 43.25, lon: -2.92, types: [2977] },
        { title: 'Motarik gabea', lat: 43.24, lon: -2.91, types: [] },
    ]);
    const sparql = calls[0].searchParams.get('query');
    assert.match(sparql, /Point\(-3 43\.2\)/);
    assert.doesNotMatch(sparql, /P279/);
});

test('filterByCategories: azpiklaseak eta Q-id anitzeko kategoriak', () => {
    const articles = [
        { title: 'Museoa', types: [33506] },
        { title: 'Arte museoa', types: [207694] },
        { title: 'Katedrala', types: [2977] },
        { title: 'Urtegia', types: [131681] },
        { title: 'Motarik gabea', types: [] },
    ];
    const subclasses = { Q33506: [33506, 207694], Q16970: [16970, 2977], Q23397: [23397], Q131681: [131681] };
    assert.deepEqual(filterByCategories(articles, ['Q33506'], subclasses).map(a => a.title), ['Museoa', 'Arte museoa']);
    assert.deepEqual(filterByCategories(articles, ['Q16970', 'Q23397 Q131681'], subclasses).map(a => a.title), ['Katedrala', 'Urtegia']);
    assert.deepEqual(filterByCategories(articles, ['Q999'], subclasses), []);
});

test('fetchOverviewArticles: motak aukerakoak dira', async () => {
    const bounds = { south: 42, west: -4, north: 44, east: -1 };
    mockFetch(() => ({ generated: '2026-10-11', bounds, articles: [['Bilbo', 43.26, -2.93, [515]], ['Ibaia', 43.1, -2.5]] }));
    assert.deepEqual(await fetchOverviewArticles(), {
        bounds,
        articles: [
            { title: 'Bilbo', lat: 43.26, lon: -2.93, types: [515] },
            { title: 'Ibaia', lat: 43.1, lon: -2.5, types: [] },
        ],
    });
});

test('fetchPage: orria ez badago null', async () => {
    mockFetch(() => ({ query: { pages: { '-1': { title: 'Ezer ez', missing: '' } } } }));
    assert.equal(await fetchPage('Ezer ez'), null);
});

test('fetchPage: koordenatuak itzultzen ditu', async () => {
    mockFetch(() => ({ query: { pages: { '5': { pageid: 5, title: 'Bilbo', coordinates: [{ lat: 43.26, lon: -2.93 }] } } } }));
    assert.deepEqual(await fetchPage('Bilbo'), { title: 'Bilbo', coords: { lat: 43.26, lon: -2.93 } });
});

test('findLocationViaWikidata: somevalue saltatu eta lehentasun-ordena errespetatu', async () => {
    mockFetch((url) => {
        const action = url.searchParams.get('action');
        if (action === 'query') return { query: { pages: { '9': { pageprops: { wikibase_item: 'Q9' } } } } };
        if (action === 'wbgetclaims') return { claims: {
            P19: [{ mainsnak: { snaktype: 'somevalue' } }],
            P131: [{ mainsnak: { datavalue: { value: { id: 'Q131' } } } }],
            P276: [{ mainsnak: { datavalue: { value: { id: 'Q276' } } } }],
        } };
        if (action === 'wbgetentities') {
            const id = url.searchParams.get('ids');
            return { entities: { [id]: {
                labels: { eu: { value: `Leku ${id}` } },
                claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 43.1, longitude: -2.1 } } } }] },
            } } };
        }
    });
    // P19 "somevalue" da, P740 falta da, beraz P276 (P131 baino lehen)
    assert.deepEqual(await findLocationViaWikidata('Pertsona'), { title: 'Leku Q276', coords: { lat: 43.1, lon: -2.1 } });
});
