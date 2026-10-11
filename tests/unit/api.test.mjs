// js/api.js-en probak, fetch simulatuarekin (sarerik gabe)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    fetchJson, geosearchBox, geosearchAround, fetchCategoryArticles, fetchPage, findLocationViaWikidata
} from '../../js/api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// handler(url) -> erantzunaren JSONa (edo { status } HTTP errorerako). Deiak gordetzen ditu.
const mockFetch = (handler) => {
    const calls = [];
    globalThis.fetch = async (input, options = {}) => {
        const url = new URL(input);
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

const sparqlRow = (qid, lon, lat, title) => ({
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    location: { value: `Point(${lon} ${lat})` },
    article: { value: `https://eu.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` },
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

test('fetchCategoryArticles: izenburua URLtik, bikoiztuak kenduta, pageid gabekoak kanpoan', async () => {
    const calls = mockFetch((url) => {
        if (url.host === 'query.wikidata.org') {
            return { results: { bindings: [
                sparqlRow('Q1', -2.93, 43.26, 'Bilboko Euskal Museoa'),
                sparqlRow('Q1', -2.93, 43.26, 'Bilboko Euskal Museoa'),
                sparqlRow('Q2', -2.92, 43.25, 'Santiago katedrala (Bilbo)'),
                sparqlRow('Q3', -2.91, 43.24, 'Ez dagoen orria'),
            ] } };
        }
        return { query: { pages: {
            '100': { pageid: 100, title: 'Bilboko Euskal Museoa' },
            '200': { pageid: 200, title: 'Santiago katedrala (Bilbo)' },
            '-1': { title: 'Ez dagoen orria', missing: '' },
        } } };
    });
    const articles = await fetchCategoryArticles(['Q33506'], { north: 43.3, south: 43.2, east: -2.9, west: -3.0 });
    assert.deepEqual(articles, [
        { title: 'Bilboko Euskal Museoa', lat: 43.26, lon: -2.93, pageid: 100 },
        { title: 'Santiago katedrala (Bilbo)', lat: 43.25, lon: -2.92, pageid: 200 },
    ]);
    const sparql = calls[0].searchParams.get('query');
    assert.match(sparql, /wd:Q33506/);
    assert.match(sparql, /Point\(-3 43\.2\)/);
});

test('fetchPage: orria ez badago null', async () => {
    mockFetch(() => ({ query: { pages: { '-1': { title: 'Ezer ez', missing: '' } } } }));
    assert.equal(await fetchPage('Ezer ez'), null);
});

test('fetchPage: koordenatuak itzultzen ditu', async () => {
    mockFetch(() => ({ query: { pages: { '5': { pageid: 5, title: 'Bilbo', coordinates: [{ lat: 43.26, lon: -2.93 }] } } } }));
    assert.deepEqual(await fetchPage('Bilbo'), { pageid: 5, title: 'Bilbo', coords: { lat: 43.26, lon: -2.93 } });
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
    assert.deepEqual(await findLocationViaWikidata(9), { title: 'Leku Q276', coords: { lat: 43.1, lon: -2.1 } });
});
