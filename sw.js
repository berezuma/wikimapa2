// Service worker-a: sare txarrean edo lineaz kanpo, azken bisitako aplikazioa eta datuak cachetik.
// - Gune honetako fitxategiak: sarea lehenik (argitalpen berri batek ez ditu kode zaharra eta berria nahasten);
//   sareak 4 s baino gehiago behar baditu edo ez badago, cacheko kopia. Erantzun berriak cachean gordetzen dira.
// - CDNko liburutegiak (bertsio finkoak) eta letra-tipoak: cachea lehenik.
// - Wikipedia/Wikidata APIak eta OSM-ren lauzak: ez dira ukitzen.
const CACHE = 'wikimapa-v1';
const NETWORK_TIMEOUT_MS = 4000;
const PRECACHE = [
    './', 'css/tailwind.css', 'manifest.json', 'ehmuga.json', 'img/icon.svg',
    'js/app.js', 'js/api.js', 'js/data.js', 'js/ui.js', 'js/search.js', 'js/filters.js', 'js/timeline.js',
    'js/popup.js', 'js/intro.js', 'js/nearby.js',
    'data/kategoriak.json', 'data/artikuluak.json',
];
const IMMUTABLE_HOSTS = ['unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
    // Fitxategi bat huts eginez gero ere, besteak gorde (instalazioa ez da galtzen)
    event.waitUntil(caches.open(CACHE).then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => {})))));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
        .then(() => self.clients.claim()));
});

const networkFirst = async (request) => {
    const cache = await caches.open(CACHE);
    // Nabigazioak (?lat=…&zoom=…) orri berbera dira
    const cacheKey = request.mode === 'navigate' ? './' : request;
    const network = fetch(request).then((response) => {
        if (response.ok) cache.put(cacheKey, response.clone());
        return response;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS));
    try {
        const response = await Promise.race([network, timeout]);
        if (response) return response;
    } catch {
        // sarerik ez: cachea
    }
    const cached = await cache.match(cacheKey);
    return cached || network;
};

const cacheFirst = async (request) => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
};

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirst(request));
    } else if (IMMUTABLE_HOSTS.includes(url.hostname)) {
        event.respondWith(cacheFirst(request));
    }
});
