// Mapa, markatzaileak eta interfazea. Datuak api.js-tik datoz.
import {
    fetchJson, isAbortError, geosearchBox, geosearchAround, fetchAreaArticles, filterByCategories,
    fetchSubclasses, fetchOverviewArticles, fetchSummary, searchTitles, fetchPage, findLocationViaWikidata
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
const applyFilterButton = document.getElementById('applyFilterButton');
const clearFilterButton = document.getElementById('clearFilterButton');
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

// Markatzaileak multzokatuta; zoom 17tik aurrera banan-banan
const markersLayer = L.markerClusterGroup({
    chunkedLoading: true,
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    disableClusteringAtZoom: 17,
}).addTo(map);
const indirectLayer = L.layerGroup().addTo(map);
// izenburua -> markatzailea; mapa mugitzean dauden markatzaileak mantentzeko
const markersByTitle = new Map();
let highlightedMarker = null;

let debounceTimer;
let searchDebounceTimer;
let updateController = null;
let searchController = null;
let mapMessageTimer;

const showLoader = (text = "Artikuluak kargatzen...") => {
    loaderText.textContent = text;
    loader.classList.remove('hidden');
};
const hideLoader = () => {
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
                fillOpacity: 0.1,
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
        if (filtering && map.getZoom() < MIN_FILTER_ZOOM) {
            // Zoom txikian, bista orokorreko datuekin iragazi (motak barne daude): Wikidatari eskatu gabe
            showLoader("Iragazitako artikuluak kargatzen...");
            const [overview, subclasses] = await Promise.all([loadOverview(), loadSubclasses()]);
            if (updateController !== controller) return;
            if (overviewCovers(overview, map.getCenter())) {
                showFilteredArticles(overview.articles, subclasses);
            } else {
                renderArticles([]);
                showMapMessage(`Zooma handitu iragazkiaren emaitzak ikusteko.`);
            }
        } else if (filtering) {
            if (areaCache && areaCache.bounds.contains(map.getBounds())) {
                showFilteredArticles(areaCache.articles, await loadSubclasses());
                return;
            }
            showLoader("Iragazitako artikuluak kargatzen...");
            const bounds = map.getBounds().pad(0.2);
            const [articles, subclasses] = await Promise.all([
                fetchAreaArticles(plainBounds(bounds), controller.signal),
                loadSubclasses(),
            ]);
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
        selectedTitle = null;
    }
};

const createMarker = (article) => {
    const marker = L.marker([article.lat, article.lon]);
    // Edukia popupa irekitzean sortzen da (bista orokorrak milaka markatzaile ditu)
    marker.bindPopup(() => createPopupContent(article, summaryCache[article.title] || 'Laburpena kargatzen...'));
    marker.on('popupopen', () => fetchAndDisplaySummary(article, marker));
    return marker;
};

const showIndirectMarker = (info) => {
    indirectLayer.clearLayers();
    const marker = L.marker(info.coords);
    marker.bindTooltip(info.title, { permanent: true, direction: 'top', offset: [0, -10], className: 'article-tooltip' }).openTooltip();
    const articleForPopup = { title: info.title };
    marker.bindPopup(createPopupContent(articleForPopup, 'Laburpena kargatzen...', info.locTitle));
    marker.on('popupopen', () => fetchAndDisplaySummary(articleForPopup, marker, info.locTitle));
    indirectLayer.addLayer(marker);
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

// DOM nodoak erabiltzen dira (ez HTML katerik), Wikipediako testuak HTML gisa interpreta ez daitezen
const createPopupContent = (article, summaryData, locTitle = null) => {
    const summary = typeof summaryData === 'string' ? summaryData : summaryData.extract;
    const imageSrc = typeof summaryData === 'string' ? null : summaryData.imageSrc;
    const container = document.createElement('div');

    if (imageSrc) {
        const image = createElement('img', 'w-full h-auto rounded-md my-2');
        image.src = imageSrc;
        image.alt = article.title;
        container.appendChild(image);
    }
    container.appendChild(createElement('div', 'font-bold text-lg mb-1', article.title));
    container.appendChild(createElement('p', 'text-gray-700 text-sm mb-2', summary));

    const link = createElement('a', 'text-blue-600 hover:underline', 'Artikulua irakurri →');
    link.href = `https://eu.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.appendChild(link);

    if (locTitle) {
        container.appendChild(createElement('p', 'text-xs italic mt-2 text-gray-500', `Erakutsitako kokapena: ${locTitle}`));
    }
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
        selectArticle(items[Math.max(activeResultIndex, 0)].textContent);
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
        const suggestions = await searchTitles(query, controller.signal);
        hideSearchResults();
        if (suggestions.length > 0) {
            searchResults.classList.remove('hidden');
            searchInput.setAttribute('aria-expanded', 'true');
            suggestions.forEach((title, i) => {
                const div = createElement('div', 'p-2 hover:bg-gray-100 cursor-pointer', title);
                div.id = `searchResult-${i}`;
                div.setAttribute('role', 'option');
                div.setAttribute('aria-selected', 'false');
                div.onclick = () => selectArticle(title);
                searchResults.appendChild(div);
            });
        }
    } catch (error) {
        if (isAbortError(error)) return;
        console.error("Errorea bilaketan:", error);
        hideSearchResults();
    }
};

const debouncedSearch = () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(handleSearch, 250);
};

const selectArticle = async (title) => {
    searchController?.abort();
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
                showIndirectMarker({ title: page.title, coords: [coords.lat + 0.001, coords.lon], locTitle: locTitle });
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
        (position) => map.flyTo([position.coords.latitude, position.coords.longitude], 17),
        () => showMapMessage('Ezin izan da zure kokapena eskuratu. Mesedez, egiaztatu baimenak.', 4000)
    );
});
shareButton.addEventListener('click', () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const url = `${window.location.origin}${window.location.pathname}?lat=${center.lat.toFixed(5)}&lon=${center.lng.toFixed(5)}&zoom=${zoom}`;
    if (!navigator.clipboard) {
        showMapMessage(url, 8000);
        return;
    }
    navigator.clipboard.writeText(url)
        .then(() => showMapMessage('Maparen esteka arbelean kopiatu da!', 3000))
        .catch(() => showMapMessage(url, 8000));
});

applyFilterButton.addEventListener('click', () => {
    activeCategoryFilters.clear();
    categoryFilters.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        activeCategoryFilters.add(cb.dataset.category);
    });
    closeFilterPanel();
    updateMapData();
});

clearFilterButton.addEventListener('click', () => {
    categoryFilters.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    activeCategoryFilters.clear();
    closeFilterPanel();
    updateMapData();
});

// Hasierako datu karga
updateMapData();
// Euskal Herriko muga kargatu hasieran
drawBasqueCountryBorders();
