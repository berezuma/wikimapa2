// Mapa, markatzaileak eta interfazea. Datuak api.js-tik datoz.
import {
    fetchJson, isAbortError, geosearchBox, geosearchAround, fetchAreaArticles, filterByCategories,
    fetchSubclasses, fetchOverviewArticles, fetchSummary, searchArticles, fetchPage, findLocationViaWikidata
} from './api.js';

const BORDER_DATA_URL = "ehmuga.json";

const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const filterButton = document.getElementById('filterButton');
const closeFilterButton = document.getElementById('closeFilterButton');
const filterPanel = document.getElementById('filterPanel');
const locateButton = document.getElementById('locateButton');
const shareButton = document.getElementById('shareButton');
const categoryFilters = document.getElementById('category-filters');
const clearFilterButton = document.getElementById('clearFilterButton');
const filterCount = document.getElementById('filterCount');
const activeFiltersBox = document.getElementById('activeFilters');
const categoryCountsNote = document.getElementById('categoryCountsNote');
const mapMessage = document.getElementById('mapMessage');
const mapMessageText = document.getElementById('mapMessageText');

// Artikuluak izenburuaren arabera identifikatzen dira (geosearch, Wikidata eta datu estatikoak)
const summaryCache = {};
let selectedTitle = null;
const activeCategoryFilters = new Set();
const MIN_FILTER_ZOOM = 12;
// Iragazkietarako azken eremuko artikuluak ({ bounds, articles }): kategoriak aldatzean edo
// eremu horren barruan mugitzean ez da Wikidata berriz kontsultatzen
let areaCache = null;
let subclassesPromise = null;
let overviewPromise = null;

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
let searchDebounceTimer;
let updateController = null;
let searchController = null;
let mapMessageTimer;
let loaderTimer;
let filterDebounceTimer;

// Adierazlea 300 ms-tik gorako kargetan bakarrik agertzen da (bestela keinuka ibiliko litzateke)
const showLoader = (text = "Artikuluak kargatzen...") => {
    loaderText.textContent = text;
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(() => loader.classList.remove('hidden'), 300);
};
const hideLoader = () => {
    clearTimeout(loaderTimer);
    loader.classList.add('hidden');
};
// timeout ematen bada, mezua automatikoki ezkutatzen da
const showMapMessage = (text, timeout = 0) => {
    clearTimeout(mapMessageTimer);
    mapMessageText.textContent = text;
    mapMessage.classList.remove('hidden');
    if (timeout) mapMessageTimer = setTimeout(hideMapMessage, timeout);
};
const hideMapMessage = () => {
    clearTimeout(mapMessageTimer);
    mapMessage.classList.add('hidden');
};

const plainBounds = (bounds) => ({
    north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest()
});

const drawBasqueCountryBorders = async () => {
    try {
        const ehMugaData = await fetchJson(BORDER_DATA_URL);
        if (Array.isArray(ehMugaData) && ehMugaData.length > 0) {
            // Koordenatuak [latitudea, longitudea] formatuan daude
            L.polygon(ehMugaData, {
                color: '#D50000',
                weight: 2,
                opacity: 0.8,
                fillColor: '#D50000',
                fillOpacity: 0.04,
                interactive: false
            }).addTo(map);
        }
    } catch (error) {
        console.error("Errorea Euskal Herriko mugak marraztean:", error);
    }
};

// Datu estatikoak behin bakarrik kargatzen dira; huts eginez gero, hurrengoan berriz saiatzen da
const loadSubclasses = () => {
    subclassesPromise ??= fetchSubclasses().catch((error) => { subclassesPromise = null; throw error; });
    return subclassesPromise;
};
const loadOverview = () => {
    overviewPromise ??= fetchOverviewArticles().catch((error) => { overviewPromise = null; throw error; });
    return overviewPromise;
};

const showFilteredArticles = (articles, subclasses) => {
    const filtered = filterByCategories(articles, [...activeCategoryFilters], subclasses);
    renderArticles(filtered);
    if (filtered.length === 0) showMapMessage("Ez dago iragazkiarekin bat datorren artikulurik ikuspegi honetan.", 4000);
};

// Bista orokorreko datuek mapa-erdigunea estaltzen duten
const overviewCovers = (overview, center) => {
    const { south, west, north, east } = overview.bounds;
    return L.latLngBounds([south, west], [north, east]).contains(center);
};

const updateMapData = async () => {
    const filtering = activeCategoryFilters.size > 0;

    // Aurreko eskaera bertan behera utzi, erantzun zaharrek berriak gainidatz ez ditzaten
    updateController?.abort();
    const controller = new AbortController();
    updateController = controller;
    hideMapMessage();

    try {
        if (filtering) {
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

const fetchGeosearchData = async (signal) => {
    const bounds = map.getBounds();
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
    try {
        return { articles: await geosearchBox(plainBounds(bounds), signal), partial: false };
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
const renderArticles = (articles) => {
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
};

// Partekatzeko esteka: popupa irekita duen artikulua
let openArticleTitle = null;
const trackPopup = (marker, title) => {
    // Popupa irekita dagoenean tooltip-a ezkutatu (biak markatzailearen gainean daude)
    marker.on('popupopen', () => { openArticleTitle = title; marker.closeTooltip(); });
    marker.on('popupclose', () => {
        if (openArticleTitle === title) openArticleTitle = null;
        if (marker.getTooltip()) marker.openTooltip();
    });
};

const POPUP_OPTIONS = { maxWidth: 320, minWidth: 260, className: 'article-popup' };

// Markatzaileen kolorea taldearen arabera (iragazki-paneleko taldeak: kultura, natura, herriak; bestela besteak).
// Artikuluaren motak datu estatikoetatik datoz (izenburuz), geosearch-ek ez baititu ematen.
const GROUPS = ['kultura', 'natura', 'herriak', 'besteak'];
const markerIcons = Object.fromEntries(GROUPS.map(group => [group, L.divIcon({
    className: `wm-marker wm-${group}`, iconSize: [20, 20], popupAnchor: [0, -7], tooltipAnchor: [0, -5],
})]));
let groupTypes = null; // [[taldea, Set(motak)], ...]
let typesByTitle = null;

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
        typesByTitle = new Map(overview.articles.map(article => [article.title, article.types]));
        groupTypes = [...categoryFilters.querySelectorAll('.category-group')].map(heading => {
            const typeSet = new Set();
            let next = heading.nextElementSibling;
            while (next && !next.classList.contains('category-group')) {
                const input = next.querySelector('input[data-category]');
                if (input) input.dataset.category.split(/\s+/).forEach(qid => (subclasses[qid] || []).forEach(type => typeSet.add(type)));
                next = next.nextElementSibling;
            }
            return [heading.dataset.group, typeSet];
        });
        markersByTitle.forEach(marker => marker.setIcon(markerIcons[articleGroup(marker.article)]));
    } catch (error) {
        console.error("Errorea markatzaileen taldeak kargatzean:", error);
    }
};

const createMarker = (article) => {
    const marker = L.marker([article.lat, article.lon], { icon: markerIcons[articleGroup(article)] });
    marker.article = article;
    // Edukia popupa irekitzean sortzen da (bista orokorrak milaka markatzaile ditu)
    marker.bindPopup(() => createPopupContent(article, summaryCache[article.title] || null), POPUP_OPTIONS);
    marker.on('popupopen', () => fetchAndDisplaySummary(article, marker));
    trackPopup(marker, article.title);
    return marker;
};

const showIndirectMarker = (info) => {
    indirectLayer.clearLayers();
    const marker = L.marker(info.coords, { icon: markerIcons[articleGroup({ title: info.title })] });
    marker.bindTooltip(info.title, { permanent: true, direction: 'top', offset: [0, -10], className: 'article-tooltip' }).openTooltip();
    const articleForPopup = { title: info.title };
    marker.bindPopup(() => createPopupContent(articleForPopup, summaryCache[info.title] || null, info.locTitle), POPUP_OPTIONS);
    marker.on('popupopen', () => fetchAndDisplaySummary(articleForPopup, marker, info.locTitle));
    trackPopup(marker, info.title);
    indirectLayer.addLayer(marker);
    return marker;
};

const fetchAndDisplaySummary = async (article, marker, locTitle = null) => {
    const popup = marker.getPopup();
    if (summaryCache[article.title]) {
        popup.setContent(createPopupContent(article, summaryCache[article.title], locTitle)); return;
    }
    try {
        const summary = await fetchSummary(article.title);
        if (summary) {
            summaryCache[article.title] = summary;
            popup.setContent(createPopupContent(article, summary, locTitle));
        } else {
            popup.setContent(createPopupContent(article, { extract: "Ezin izan da artikuluaren informazioa aurkitu." }, locTitle));
        }
    } catch (error) {
        console.error("Ezin izan da laburpena eskuratu:", error);
        popup.setContent(createPopupContent(article, { extract: "Errorea laburpena kargatzean." }, locTitle));
    }
};

const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};

// Popup txartela: izenburua, irudi txikia alboan, laburpen moztua eta Wikipediarako botoia.
// summaryData: null (kargatzen), { extract, imageSrc } edo errore-testua { extract }.
// DOM nodoak erabiltzen dira (ez HTML katerik), Wikipediako testuak HTML gisa interpreta ez daitezen
const createPopupContent = (article, summaryData, locTitle = null) => {
    const container = createElement('div', 'article-card');
    container.appendChild(createElement('h3', 'text-base font-bold text-gray-900 leading-snug pr-4', article.title));
    if (locTitle) {
        container.appendChild(createElement('p', 'text-xs text-gray-500 mt-0.5', `Kokapen erlazionatua: ${locTitle}`));
    }

    const body = createElement('div', 'flex gap-3 mt-2');
    if (summaryData?.imageSrc) {
        const image = createElement('img', 'w-20 h-20 object-cover rounded-md shrink-0 bg-gray-100');
        image.src = summaryData.imageSrc;
        image.alt = '';
        body.appendChild(image);
    }
    if (summaryData) {
        body.appendChild(createElement('p', 'text-sm text-gray-700 leading-relaxed line-clamp-5 m-0', summaryData.extract));
    } else {
        body.appendChild(createElement('p', 'text-sm text-gray-400 m-0', 'Laburpena kargatzen…'));
    }
    container.appendChild(body);

    const link = createElement('a', 'article-read inline-flex items-center gap-1 mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-700', 'Irakurri Wikipedian →');
    link.href = `https://eu.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.appendChild(link);
    return container;
};

const hideSearchResults = () => {
    searchResults.innerHTML = '';
    searchResults.classList.add('hidden');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeResultIndex = -1;
};

// Teklatuz nabigatzeko: gezi-teklekin hautatutako emaitza
let activeResultIndex = -1;
const resultItems = () => [...searchResults.querySelectorAll('[role="option"]')];

const setActiveResult = (index) => {
    const items = resultItems();
    items.forEach((item, i) => {
        const active = i === index;
        item.classList.toggle('bg-gray-100', active);
        item.setAttribute('aria-selected', String(active));
    });
    activeResultIndex = index;
    if (items[index]) {
        searchInput.setAttribute('aria-activedescendant', items[index].id);
        items[index].scrollIntoView({ block: 'nearest' });
    } else {
        searchInput.removeAttribute('aria-activedescendant');
    }
};

const handleSearchKeydown = (event) => {
    const items = resultItems();
    if (event.key === 'Escape') {
        hideSearchResults();
        return;
    }
    if (items.length === 0) return;
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveResult((activeResultIndex + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveResult(activeResultIndex <= 0 ? items.length - 1 : activeResultIndex - 1);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        selectArticle(items[Math.max(activeResultIndex, 0)].dataset.title);
    }
};

const handleSearch = async () => {
    const query = searchInput.value;
    searchController?.abort();
    if (query.length < 3) {
        hideSearchResults(); return;
    }
    const controller = new AbortController();
    searchController = controller;
    try {
        const results = await searchArticles(query, controller.signal);
        hideSearchResults();
        if (results.length > 0) {
            searchResults.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            results.forEach((result, i) => searchResults.appendChild(createSearchResult(result, i)));
        } else {
            searchResults.classList.remove('hidden');
            searchResults.appendChild(createElement('div', 'p-3 text-sm text-gray-500', 'Ez da artikulurik aurkitu.'));
        }
    } catch (error) {
        if (isAbortError(error)) return;
        console.error("Errorea bilaketan:", error);
        hideSearchResults();
    }
};

// Emaitza bakoitza: irudi txikia, izenburua eta deskribapena. Koordenaturik ez badu, lotutako lekua erakutsiko da.
const createSearchResult = (result, index) => {
    const option = createElement('div', 'flex items-center gap-2 p-2 hover:bg-gray-100 cursor-pointer');
    option.id = `searchResult-${index}`;
    option.dataset.title = result.title;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');

    if (result.thumbnail) {
        const image = createElement('img', 'w-10 h-10 object-cover rounded shrink-0 bg-gray-100');
        image.src = result.thumbnail;
        image.alt = '';
        option.appendChild(image);
    } else {
        option.appendChild(createElement('div', 'w-10 h-10 rounded shrink-0 bg-gray-100'));
    }
    const text = createElement('div', 'min-w-0');
    text.appendChild(createElement('div', 'text-sm font-medium text-gray-900 truncate', result.title));
    const details = [result.description, result.hasCoords ? '' : 'kokapen erlazionatua'].filter(Boolean).join(' · ');
    if (details) text.appendChild(createElement('div', 'text-xs text-gray-500 truncate', details));
    option.appendChild(text);

    option.onclick = () => selectArticle(result.title);
    return option;
};

const debouncedSearch = () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(handleSearch, 250);
};

const selectArticle = async (title) => {
    searchController?.abort();
    pendingPopupTitle = null;
    indirectLayer.clearLayers();
    clearHighlight();
    searchInput.value = title;
    hideSearchResults();
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

const debouncedUpdate = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateMapData, 500);
};

// Event Listeners
map.on('moveend', debouncedUpdate);
searchInput.addEventListener('input', debouncedSearch);
searchInput.addEventListener('keydown', handleSearchKeydown);
document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) hideSearchResults();
});

// Panela itxita dagoenean "inert" da, Tab teklak bere kontroletara heldu ez dadin
const openFilterPanel = () => {
    filterPanel.inert = false;
    filterPanel.classList.add('open');
    filterButton.setAttribute('aria-expanded', 'true');
    categoryFilters.querySelector('input')?.focus();
    updateCategoryCounts();
};
const closeFilterPanel = () => {
    const hadFocus = filterPanel.contains(document.activeElement);
    filterPanel.classList.remove('open');
    filterPanel.inert = true;
    filterButton.setAttribute('aria-expanded', 'false');
    if (hadFocus) filterButton.focus();
};

filterButton.addEventListener('click', openFilterPanel);
closeFilterButton.addEventListener('click', closeFilterPanel);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filterPanel.classList.contains('open')) closeFilterPanel();
});
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

// Milakoak puntuz (1.109), euskarazko idazkeraren arabera
const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const categoryInputs = () => [...categoryFilters.querySelectorAll('input[type="checkbox"]')];
const categoryLabel = (input) => input.parentElement.querySelector('span').textContent.trim();

// Iragazki aktiboak: botoiko zenbakia eta bilatzailearen azpiko etiketak (✕ sakatuta kentzen dira)
const renderActiveFilters = () => {
    const checked = categoryInputs().filter(input => input.checked);
    filterCount.textContent = String(checked.length);
    filterCount.classList.toggle('hidden', checked.length === 0);
    activeFiltersBox.classList.toggle('hidden', checked.length === 0);
    activeFiltersBox.replaceChildren(...checked.map(input => {
        const chip = createElement('button', 'inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-xs font-semibold hover:bg-blue-100');
        chip.type = 'button';
        chip.setAttribute('aria-label', `Kendu iragazkia: ${categoryLabel(input)}`);
        chip.append(categoryLabel(input), createElement('span', 'text-blue-400', '✕'));
        chip.addEventListener('click', () => {
            input.checked = false;
            applyFilters();
        });
        return chip;
    }));
};

// Kategoria bakoitzeko kopurua uneko ikuspegian, datu estatikoekin (eremutik kanpo ez da erakusten)
const updateCategoryCounts = async () => {
    if (!filterPanel.classList.contains('open')) return;
    let overview = null;
    let subclasses = null;
    try {
        [overview, subclasses] = await Promise.all([loadOverview(), loadSubclasses()]);
    } catch {
        // kopururik gabe jarraitu
    }
    const bounds = map.getBounds();
    const covered = overview && subclasses && overviewCovers(overview, map.getCenter());
    const visible = covered ? overview.articles.filter(article => bounds.contains([article.lat, article.lon])) : [];
    categoryInputs().forEach(input => {
        const count = input.parentElement.querySelector('.category-count');
        count.textContent = covered ? formatNumber(filterByCategories(visible, [input.dataset.category], subclasses).length) : '';
    });
    categoryCountsNote.classList.toggle('hidden', !covered);
};

// Kategoriak markatzean berehala aplikatzen dira (debounce txiki batekin, hainbat azkar markatzeko)
const applyFilters = () => {
    activeCategoryFilters.clear();
    categoryInputs().filter(input => input.checked).forEach(input => activeCategoryFilters.add(input.dataset.category));
    renderActiveFilters();
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(updateMapData, 150);
};

categoryFilters.addEventListener('change', (event) => {
    if (event.target.matches('input[type="checkbox"]')) applyFilters();
});

clearFilterButton.addEventListener('click', () => {
    categoryInputs().forEach(input => { input.checked = false; });
    applyFilters();
});

map.on('moveend', updateCategoryCounts);

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

// Hasierako datu karga; ?artikulua=… badago, artikulu hori hautatu
updateMapData();
loadMarkerGroups();
if (urlParams.get('artikulua')) selectArticle(urlParams.get('artikulua'));
// Euskal Herriko muga kargatu hasieran
drawBasqueCountryBorders();
