// Mapa, markatzaileak eta datu-fluxua. Datuak api.js-tik datoz; interfazearen zatiak beste moduluetan:
// search.js (bilatzailea), filters.js (iragazki-panela), timeline.js (denbora-lerroa), popup.js (txartelak),
// intro.js (sarrera animatua), ui.js (mezuak eta laguntzaileak), data.js (datu estatikoak).
import {
    fetchJson, isAbortError, geosearchBox, geosearchAround, fetchAreaArticles, filterByCategories,
    fetchPage, findLocationViaWikidata, fetchThumbnails
} from './api.js';
import { loadOverview, loadSubclasses, overviewCovers } from './data.js';
import { createElement, formatNumber, showLoader, hideLoader, showMapMessage, hideStatusMessage } from './ui.js';
import { initSearch, setSearchText } from './search.js';
import { activeCategoryFilters, categoryGroups, initFilters } from './filters.js';
import { initTimeline, timelineYear } from './timeline.js';
import { bindArticlePopup, loadSummary } from './popup.js';
import { introActive, animateBorder, runIntro } from './intro.js';

const BORDER_DATA_URL = "ehmuga.json";

const locateButton = document.getElementById('locateButton');
const shareButton = document.getElementById('shareButton');
const surpriseButton = document.getElementById('surpriseButton');

// Artikuluak izenburuaren arabera identifikatzen dira (geosearch, Wikidata eta datu estatikoak)
let selectedTitle = null;
const MIN_FILTER_ZOOM = 12;
// Iragazkietarako azken eremuko artikuluak ({ bounds, articles }): kategoriak aldatzean edo
// eremu horren barruan mugitzean ez da Wikidata berriz kontsultatzen
let areaCache = null;

// Wikipediaren geosearch-ak ~400 km²-ko bbox-a onartzen du gehienez ("toobig" errorea bestela).
// Ikuspegia handiagoa bada, bista orokorra erabiltzen da (data/artikuluak.json), edo eremu horretatik
// kanpo erdiko zirkulua.
const GEOSEARCH_MAX_AREA_KM2 = 350;

// URLko parametroa zenbaki baliozkoa bada eta tartean badago, bera; bestela lehenetsia
const numberParam = (params, name, min, max, fallback) => {
    const raw = params.get(name);
    const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

const urlParams = new URLSearchParams(window.location.search);
const lat = numberParam(urlParams, 'lat', -90, 90, 43.0);
const lon = numberParam(urlParams, 'lon', -180, 180, -2.5);
const zoom = Math.round(numberParam(urlParams, 'zoom', 0, 19, 9));

// Zoom kontrolak behean, goiburuak estal ez ditzan
const map = L.map('map', { zoomControl: false }).setView([lat, lon], zoom);
L.control.zoom({ position: 'bottomleft' }).addTo(map);

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
// Egilea eta lizentzia Leaflet-en aitortzan (lehen oin batek OSM-ren aitortza estaltzen zuen)
map.attributionControl.setPrefix(
    'Beñat Erezuma · <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.eu" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a> · ' +
    '<a href="https://eu.wikipedia.org" target="_blank" rel="noopener noreferrer">Wikipedia</a>'
);

// Markatzaileak multzokatuta; zoom 17tik aurrera banan-banan
const markersLayer = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    disableClusteringAtZoom: 17,
    iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 30 : count < 100 ? 36 : count < 1000 ? 44 : 52;
        return L.divIcon({ html: formatNumber(count), className: 'marker-cluster wm-cluster', iconSize: [size, size] });
    },
}).addTo(map);
const indirectLayer = L.layerGroup().addTo(map);
const locationLayer = L.layerGroup().addTo(map);
// izenburua -> markatzailea; mapa mugitzean dauden markatzaileak mantentzeko
const markersByTitle = new Map();
let highlightedMarker = null;

let debounceTimer;
let updateController = null;

const plainBounds = (bounds) => ({
    north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest()
});

const drawBasqueCountryBorders = async () => {
    try {
        const ehMugaData = await fetchJson(BORDER_DATA_URL);
        if (Array.isArray(ehMugaData) && ehMugaData.length > 0) {
            // Koordenatuak [latitudea, longitudea] formatuan daude
            const border = L.polygon(ehMugaData, {
                color: '#D50000',
                weight: 2,
                opacity: 0.8,
                fillColor: '#D50000',
                fillOpacity: 0.04,
                interactive: false
            }).addTo(map);
            if (introActive) animateBorder(border);
        }
    } catch (error) {
        console.error("Errorea Euskal Herriko mugak marraztean:", error);
    }
};

const showFilteredArticles = (articles, subclasses) => {
    const filtered = filterByCategories(articles, [...activeCategoryFilters], subclasses);
    renderArticles(filtered);
    if (filtered.length === 0) showMapMessage("Ez dago iragazkiarekin bat datorren artikulurik ikuspegi honetan.", 4000);
};

const updateMapData = async () => {
    const filtering = activeCategoryFilters.size > 0;

    // Aurreko eskaera bertan behera utzi, erantzun zaharrek berriak gainidatz ez ditzaten
    updateController?.abort();
    const controller = new AbortController();
    updateController = controller;
    hideStatusMessage();

    try {
        const year = timelineYear();
        if (year !== null) {
            // Denbora-lerroa: data duten lekuak, aukeratutako urtera arte (iragazkiak ere aplikatuta)
            const [overview, subclasses] = await Promise.all([loadOverview(), loadSubclasses()]);
            if (updateController !== controller) return;
            if (!overviewCovers(overview, map.getCenter())) {
                renderArticles([]);
                showMapMessage('Denbora-lerroa Euskal Herriko eremuan bakarrik dabil.');
                return;
            }
            let articles = overview.articles.filter(article => article.year !== null && article.year <= year);
            if (filtering) articles = filterByCategories(articles, [...activeCategoryFilters], subclasses);
            renderArticles(articles);
        } else if (filtering) {
            // Euskal Herriko eremuan, edozein zoometan, datu estatikoekin iragazi (motak barne daude):
            // berehalakoa da, eta Wikidataren kontsultak batzuetan minutu erdi baino gehiago behar ditu
            showLoader("Iragazitako artikuluak kargatzen...");
            const [overview, subclasses] = await Promise.all([
                loadOverview().catch((error) => {
                    console.error("Errorea bista orokorra kargatzean:", error);
                    return null;
                }),
                loadSubclasses(),
            ]);
            if (updateController !== controller) return;
            if (overview && overviewCovers(overview, map.getCenter())) {
                showFilteredArticles(overview.articles, subclasses);
                return;
            }
            // Eremutik kanpo: Wikidata zuzenean, zoom nahikoarekin
            if (map.getZoom() < MIN_FILTER_ZOOM) {
                renderArticles([]);
                showMapMessage(`Zooma handitu iragazkiaren emaitzak ikusteko.`);
                return;
            }
            if (areaCache && areaCache.bounds.contains(map.getBounds())) {
                showFilteredArticles(areaCache.articles, subclasses);
                return;
            }
            showLoader("Iragazitako artikuluak kargatzen...");
            const bounds = map.getBounds().pad(0.2);
            const articles = await fetchAreaArticles(plainBounds(bounds), controller.signal);
            if (updateController !== controller) return;
            areaCache = { bounds, articles };
            showFilteredArticles(articles, subclasses);
        } else {
            showLoader("Artikuluak kargatzen...");
            const { articles, partial } = await fetchGeosearchData(controller.signal);
            if (updateController !== controller) return;
            renderArticles(articles);
            if (partial) {
                showMapMessage("Erdiko 10 km-ko artikuluak bakarrik erakusten dira. Handitu zooma gehiago ikusteko.");
            }
        }
    } catch (error) {
        if (isAbortError(error)) return;
        console.error("Errorea datuak eskuratzean:", error);
        showMapMessage("Errorea gertatu da datuak kargatzean.");
    } finally {
        if (updateController === controller) hideLoader();
    }
};

const boundsAreaKm2 = (bounds) => {
    const width = map.distance(bounds.getNorthWest(), bounds.getNorthEast());
    const height = map.distance(bounds.getNorthWest(), bounds.getSouthWest());
    return (width * height) / 1e6;
};

// Azken geosearch-a ({ bounds, articles }): popupen autoPan-ak eta mugimendu txikiek ez dute berriz bilatzen
let geosearchCache = null;

const fetchGeosearchData = async (signal) => {
    const bounds = map.getBounds();
    if (geosearchCache && geosearchCache.bounds.contains(bounds)) {
        return { articles: geosearchCache.articles, partial: false };
    }
    const fetchLargeView = async () => {
        const center = map.getCenter();
        // Bista orokorra, erdigunea datu estatikoen eremuan badago
        const overview = await loadOverview().catch((error) => {
            console.error("Errorea bista orokorra kargatzean:", error);
            return null;
        });
        if (overview && overviewCovers(overview, center)) {
            return { articles: overview.articles, partial: false };
        }
        return { articles: await geosearchAround({ lat: center.lat, lon: center.lng }, signal), partial: true };
    };

    if (boundsAreaKm2(bounds) > GEOSEARCH_MAX_AREA_KM2) return fetchLargeView();
    const padded = bounds.pad(0.25);
    const queryBounds = boundsAreaKm2(padded) <= GEOSEARCH_MAX_AREA_KM2 ? padded : bounds;
    try {
        const articles = await geosearchBox(plainBounds(queryBounds), signal);
        // 500eko mugara iritsiz gero, eremu zabalean falta daitezke artikuluak: ez gorde
        geosearchCache = articles.length < 500 ? { bounds: queryBounds, articles } : null;
        return { articles, partial: false };
    } catch (error) {
        if (error.code === 'toobig') return fetchLargeView();
        throw error;
    }
};

const highlightMarker = (marker, title) => {
    clearHighlight();
    marker.bindTooltip(title, { permanent: true, direction: 'top', offset: [0, -10], className: 'article-tooltip' }).openTooltip();
    highlightedMarker = marker;
};

// Hautatutako artikuluaren popupa ireki, markatzailea mapan badago (multzo batean ez)
const openPopupFor = (title) => {
    const marker = markersByTitle.get(title);
    if (marker && map.hasLayer(marker)) {
        marker.openPopup();
        return true;
    }
    return false;
};
let pendingPopupTitle = null;
map.on('moveend', () => {
    if (pendingPopupTitle && openPopupFor(pendingPopupTitle)) pendingPopupTitle = null;
});

const clearHighlight = () => {
    if (highlightedMarker) highlightedMarker.unbindTooltip();
    highlightedMarker = null;
};

// Markatzaileak eguneratu: ikuspegitik kanpokoak kendu, berriak gehitu eta daudenak mantendu.
// Popupa irekita duen markatzailea ez da inoiz kentzen (autoPan-ek mugimendua eragiten du).
// Multzokatzeak milaka markatzaile izan ditzake (bista orokorra), beraz sortetan gehitu eta kentzen dira.
const renderArticles = (sourceArticles) => {
    // Ainguratutako artikulua (Harritu nazazu): datu-iturriak ez badu ere, mapan egon dadin
    const articles = pinnedArticle && !sourceArticles.some(article => article.title === pinnedArticle.title)
        ? [...sourceArticles, pinnedArticle]
        : sourceArticles;
    const visibleTitles = new Set(articles.map(article => article.title));

    const toRemove = [];
    markersByTitle.forEach((marker, title) => {
        if (!visibleTitles.has(title) && !marker.isPopupOpen()) {
            if (marker === highlightedMarker) highlightedMarker = null;
            toRemove.push(marker);
            markersByTitle.delete(title);
        }
    });
    if (toRemove.length) markersLayer.removeLayers(toRemove);

    const toAdd = [];
    articles.forEach(article => {
        if (!markersByTitle.has(article.title)) {
            const marker = createMarker(article);
            markersByTitle.set(article.title, marker);
            toAdd.push(marker);
        }
    });
    if (toAdd.length) markersLayer.addLayers(toAdd);

    if (selectedTitle !== null && markersByTitle.has(selectedTitle)) {
        highlightMarker(markersByTitle.get(selectedTitle), selectedTitle);
        if (pendingPopupTitle === selectedTitle && openPopupFor(selectedTitle)) pendingPopupTitle = null;
        selectedTitle = null;
    }
    updatePhotoMarkers();
};

// Partekatzeko esteka: popupa irekita duen artikulua
let openArticleTitle = null;
const trackPopup = (marker, title) => {
    // Popupa irekita dagoenean tooltip-a ezkutatu (biak markatzailearen gainean daude)
    marker.on('popupopen', () => { openArticleTitle = title; marker.closeTooltip(); });
    marker.on('popupclose', () => {
        if (openArticleTitle === title) openArticleTitle = null;
        if (marker.getTooltip()) marker.openTooltip();
        if (pendingMoveUpdate && !openArticleTitle) {
            pendingMoveUpdate = false;
            debouncedUpdate();
        }
    });
};

// Markatzaileen kolorea taldearen arabera (iragazki-paneleko taldeak: kultura, natura, herriak; bestela besteak).
// Artikuluaren motak datu estatikoetatik datoz (izenburuz), geosearch-ek ez baititu ematen.
const GROUPS = ['kultura', 'natura', 'herriak', 'besteak'];
const markerIcons = Object.fromEntries(GROUPS.map(group => [group, L.divIcon({
    className: `wm-marker wm-${group}`, iconSize: [20, 20], popupAnchor: [0, -7], tooltipAnchor: [0, -5],
})]));
let groupTypes = null; // [[taldea, Set(motak)], ...]
let typesByTitle = null;

// Zoom honetatik aurrera (multzokatzerik gabe), irudia duten artikuluak argazki biribil gisa
const PHOTO_ZOOM = 17;
const thumbnails = new Map(); // izenburua -> URL edo null
let photoController = null;
let pinnedArticle = null;

const markerIconFor = (article) => {
    const group = articleGroup(article);
    const photo = map.getZoom() >= PHOTO_ZOOM ? thumbnails.get(article.title) : null;
    if (!photo) return { key: group, icon: markerIcons[group] };
    const image = document.createElement('img');
    image.src = photo;
    image.alt = '';
    return {
        key: `${group}|${photo}`,
        icon: L.divIcon({ className: `wm-photo wm-${group}`, html: image, iconSize: [44, 44], popupAnchor: [0, -20], tooltipAnchor: [0, -20] }),
    };
};

// Ikonoa aldatu bakarrik behar denean (argazkiak berriro ez sortzeko)
const refreshMarkerIcon = (marker) => {
    const { key, icon } = markerIconFor(marker.article);
    if (marker.iconKey !== key) {
        marker.iconKey = key;
        marker.setIcon(icon);
    }
};

const updatePhotoMarkers = async () => {
    photoController?.abort();
    if (map.getZoom() < PHOTO_ZOOM) {
        markersByTitle.forEach(marker => { if (marker.iconKey?.includes('|')) refreshMarkerIcon(marker); });
        return;
    }
    const bounds = map.getBounds().pad(0.1);
    const visible = [...markersByTitle.values()].filter(marker => bounds.contains(marker.getLatLng()));
    const missing = visible.map(marker => marker.article.title).filter(title => !thumbnails.has(title)).slice(0, 200);
    if (missing.length) {
        const controller = new AbortController();
        photoController = controller;
        try {
            (await fetchThumbnails(missing, controller.signal)).forEach((url, title) => thumbnails.set(title, url));
        } catch (error) {
            if (!isAbortError(error)) console.error("Errorea irudiak kargatzean:", error);
            return;
        }
    }
    visible.forEach(refreshMarkerIcon);
};
map.on('zoomend', updatePhotoMarkers);

const articleGroup = (article) => {
    const types = article.types?.length ? article.types : typesByTitle?.get(article.title);
    if (!types || !groupTypes) return 'besteak';
    const match = groupTypes.find(([, typeSet]) => types.some(type => typeSet.has(type)));
    return match ? match[0] : 'besteak';
};

// Taldeen datuak kargatu (atzeko planoan) eta dauden markatzaileak koloreztatu
const loadMarkerGroups = async () => {
    try {
        const [overview, subclasses] = await Promise.all([loadOverview(), loadSubclasses()]);
        // Datu estatikoen data (astero eguneratzen dira automatikoki)
        if (overview.generated) {
            document.querySelectorAll('.data-date').forEach(element => {
                element.textContent = `Datuak: ${overview.generated}`;
                element.classList.remove('hidden');
            });
        }
        typesByTitle = new Map(overview.articles.map(article => [article.title, article.types]));
        groupTypes = categoryGroups(subclasses);
        markersByTitle.forEach(refreshMarkerIcon);
    } catch (error) {
        console.error("Errorea markatzaileen taldeak kargatzean:", error);
    }
};

const createMarker = (article) => {
    const { key, icon } = markerIconFor(article);
    const marker = L.marker([article.lat, article.lon], { icon });
    marker.article = article;
    marker.iconKey = key;
    bindArticlePopup(marker, article);
    // Laburpena aurrez kargatu (hatza/sagua markatzailean jartzean), popupa irekitzean prest egon dadin
    marker.on('mouseover mousedown', () => loadSummary(article.title).catch(() => {}));
    trackPopup(marker, article.title);
    return marker;
};

const showIndirectMarker = (info) => {
    indirectLayer.clearLayers();
    const marker = L.marker(info.coords, { icon: markerIcons[articleGroup({ title: info.title })] });
    marker.bindTooltip(info.title, { permanent: true, direction: 'top', offset: [0, -10], className: 'article-tooltip' }).openTooltip();
    bindArticlePopup(marker, { title: info.title }, info.locTitle);
    trackPopup(marker, info.title);
    indirectLayer.addLayer(marker);
    return marker;
};

const selectArticle = async (title) => {
    map.closePopup();
    pendingPopupTitle = null;
    pinnedArticle = null;
    indirectLayer.clearLayers();
    clearHighlight();
    setSearchText(title);
    try {
        const page = await fetchPage(title);
        if (!page) {
            showMapMessage(`Ez da '${title}' artikulua aurkitu.`, 4000);
            return;
        }
        if (page.coords) {
            selectedTitle = page.title;
            // Popupa iristean irekiko da (moveend edo markatzailea sortzean)
            pendingPopupTitle = page.title;
            // Markatzailea dagoeneko mapan badago, berehala nabarmendu
            const existing = markersByTitle.get(page.title);
            if (existing) {
                highlightMarker(existing, page.title);
                selectedTitle = null;
            }
            map.flyTo([page.coords.lat, page.coords.lon], 18);
        } else {
            showLoader(`'${title}' artikuluaren kokapen garrantzitsuena bilatzen...`);
            const location = await findLocationViaWikidata(page.title);
            hideLoader();
            if (location) {
                const { title: locTitle, coords } = location;
                selectedTitle = null;
                const marker = showIndirectMarker({ title: page.title, coords: [coords.lat + 0.001, coords.lon], locTitle: locTitle });
                map.once('moveend', () => marker.openPopup());
                map.flyTo([coords.lat, coords.lon], 17);
            } else {
                showMapMessage(`Ezin izan da kokapenik aurkitu '${title}' artikuluarentzat.`, 4000);
            }
        }
    } catch (error) {
        console.error("Errorea artikulua hautatzean:", error);
        hideLoader();
        showMapMessage("Errorea gertatu da artikulua bilatzean.", 4000);
    }
};

// Popup bat irekita dagoen bitartean (autoPan, edo irakurtzen ari da), mapa mugitzeak ez ditu markatzaileak
// aldatzen: lan alferrikakoa da, eta markercluster-ek popupa duen markatzailea multzo batean sar dezake
// (popupa itxiz). Eguneraketa popupa ixtean egiten da. Iragazkiek eta denbora-lerroak zuzenean eguneratzen dute.
let pendingMoveUpdate = false;
const debouncedUpdate = () => {
    clearTimeout(debounceTimer);
    if (openArticleTitle) {
        pendingMoveUpdate = true;
        return;
    }
    debounceTimer = setTimeout(updateMapData, 500);
};

// Event Listeners
map.on('moveend', debouncedUpdate);
initSearch(selectArticle);
initFilters(map, updateMapData);
initTimeline(updateMapData);

locateButton.addEventListener('click', () => {
    if (!navigator.geolocation) {
        showMapMessage('Nabigatzaile honek ez du kokapena eskuratzeko aukerarik.', 4000);
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const latlng = [position.coords.latitude, position.coords.longitude];
            locationLayer.clearLayers();
            L.circle(latlng, { radius: position.coords.accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(locationLayer);
            L.circleMarker(latlng, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
                .bindTooltip('Zu hemen zaude', { direction: 'top', offset: [0, -8] })
                .addTo(locationLayer);
            map.flyTo(latlng, 17);
        },
        () => showMapMessage('Ezin izan da zure kokapena eskuratu. Mesedez, egiaztatu baimenak.', 4000)
    );
});
shareButton.addEventListener('click', () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const params = new URLSearchParams({ lat: center.lat.toFixed(5), lon: center.lng.toFixed(5), zoom: String(zoom) });
    if (openArticleTitle) params.set('artikulua', openArticleTitle);
    const url = `${window.location.origin}${window.location.pathname}?${params}`;
    if (!navigator.clipboard) {
        showMapMessage(url, 8000);
        return;
    }
    navigator.clipboard.writeText(url)
        .then(() => showMapMessage(openArticleTitle ? `'${openArticleTitle}' artikuluaren esteka kopiatu da!` : 'Maparen esteka arbelean kopiatu da!', 3000))
        .catch(() => showMapMessage(url, 8000));
});

// Harritu nazazu: Euskal Herriko artikulu aleatorio batera hegan egin eta txartela ireki.
// Iragazkiak aktibo badaude, horien artean; bestela, kategoriaren bat duten artikuluen artean (interesgarriagoak).
const surpriseMe = async () => {
    surpriseButton.classList.remove('spinning');
    void surpriseButton.offsetWidth; // animazioa berrabiarazteko
    surpriseButton.classList.add('spinning');
    try {
        const [overview, subclasses] = await Promise.all([loadOverview(), loadSubclasses()]);
        let pool = overview.articles;
        if (activeCategoryFilters.size > 0) {
            pool = filterByCategories(pool, [...activeCategoryFilters], subclasses);
        } else if (groupTypes) {
            pool = pool.filter(article => articleGroup(article) !== 'besteak');
        }
        if (pool.length === 0) {
            showMapMessage('Ez dago artikulurik iragazki hauekin.', 3000);
            return;
        }
        const article = pool[Math.floor(Math.random() * pool.length)];
        indirectLayer.clearLayers();
        clearHighlight();
        map.closePopup();
        setSearchText('');
        pinnedArticle = article;
        selectedTitle = article.title;
        pendingPopupTitle = article.title;
        map.flyTo([article.lat, article.lon], PHOTO_ZOOM, { duration: 2.5 });
    } catch (error) {
        console.error("Errorea ausazko artikulua aukeratzean:", error);
        showMapMessage('Errorea gertatu da. Saiatu berriro.', 3000);
    }
};
surpriseButton.addEventListener('click', surpriseMe);

// Legenda (ordenagailuan; mugikorrean iragazki-paneleko izenburuek erakusten dituzte koloreak)
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = () => {
    const box = createElement('div', 'wm-legend');
    [['kultura', 'Kultura eta ondarea'], ['natura', 'Natura eta geografia'], ['herriak', 'Herriak eta azpiegiturak'], ['besteak', 'Besteak']]
        .forEach(([group, label]) => {
            const row = createElement('div');
            row.append(createElement('span', `wm-swatch wm-${group}`), label);
            box.appendChild(row);
        });
    return box;
};
legend.addTo(map);

if (introActive) runIntro();

// Hasierako datu karga; ?artikulua=… badago, artikulu hori hautatu
updateMapData();
loadMarkerGroups();
if (urlParams.get('artikulua')) selectArticle(urlParams.get('artikulua'));
// Euskal Herriko muga kargatu hasieran
drawBasqueCountryBorders();
