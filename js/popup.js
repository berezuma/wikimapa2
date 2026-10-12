// Artikuluen popup txartelak eta laburpenak (Wikipediaren REST APIa, izenburu bakoitzeko promesa bat)
import { fetchSummary } from './api.js';
import { createElement } from './ui.js';

export const POPUP_OPTIONS = { maxWidth: 320, minWidth: 260, className: 'article-popup' };

const summaryCache = {};
const summaryPromises = new Map();

export const loadSummary = (title) => {
    if (!summaryPromises.has(title)) {
        summaryPromises.set(title, fetchSummary(title).catch((error) => {
            summaryPromises.delete(title);
            throw error;
        }));
    }
    return summaryPromises.get(title);
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
        // Eskeletoa: azken txartelaren tamaina gutxi gorabehera (irudia + lerroak), laburpena iristean
        // tamaina ez aldatzeko eta mapa berriz ez mugitzeko (autoPan)
        body.setAttribute('aria-busy', 'true');
        body.appendChild(createElement('div', 'w-20 h-20 rounded-md shrink-0 bg-gray-200 animate-pulse'));
        const lines = createElement('div', 'flex-grow space-y-2 pt-1');
        lines.appendChild(createElement('span', 'sr-only', 'Laburpena kargatzen…'));
        ['w-full', 'w-full', 'w-5/6', 'w-2/3'].forEach(width => lines.appendChild(createElement('div', `h-3 ${width} rounded bg-gray-200 animate-pulse`)));
        body.appendChild(lines);
    }
    container.appendChild(body);

    const link = createElement('a', 'article-read inline-flex items-center gap-1 mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold hover:bg-blue-700', 'Irakurri Wikipedian →');
    link.href = `https://eu.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    container.appendChild(link);
    return container;
};

const fetchAndDisplaySummary = async (article, marker, locTitle) => {
    const popup = marker.getPopup();
    if (summaryCache[article.title]) {
        popup.setContent(createPopupContent(article, summaryCache[article.title], locTitle)); return;
    }
    try {
        const summary = await loadSummary(article.title);
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

// Markatzaileari popupa lotu. Edukia popupa irekitzean sortzen da (bista orokorrak milaka markatzaile ditu).
// locTitle: koordenaturik gabeko artikuluetan, kokapena eman duen artikulua
export const bindArticlePopup = (marker, article, locTitle = null) => {
    marker.bindPopup(() => createPopupContent(article, summaryCache[article.title] || null, locTitle), POPUP_OPTIONS);
    marker.on('popupopen', () => fetchAndDisplaySummary(article, marker, locTitle));
};
