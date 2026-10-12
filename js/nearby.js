// Zure inguruan: kokapena eskuratzean, gertuen dauden artikuluak distantziaren arabera (behealdeko txartela)
import { createElement } from './ui.js';

const nearbyBox = document.getElementById('nearby');
const nearbyList = document.getElementById('nearbyList');

const MAX_ITEMS = 30;
let onPick = () => {};

// 350 m, 1,2 km, 12 km (euskaraz koma hamartarra)
export const formatDistance = (meters) => {
    if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
    if (meters < 10000) return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
    return `${Math.round(meters / 1000)} km`;
};

export const hideNearby = () => {
    nearbyBox.classList.add('hidden');
    document.body.classList.remove('nearby-open');
};

// articles: { title, lat, lon }; groupOf: artikuluaren taldea (markatzailearen kolorea)
export const showNearby = (position, articles, groupOf) => {
    const here = L.latLng(position);
    const sorted = articles
        .map(article => ({ article, distance: here.distanceTo([article.lat, article.lon]) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_ITEMS);
    nearbyList.replaceChildren(...sorted.map(({ article, distance }) => {
        const item = createElement('li');
        const button = createElement('button', 'w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none');
        button.type = 'button';
        const swatch = createElement('span', `wm-swatch wm-${groupOf(article)} shrink-0`);
        swatch.setAttribute('aria-hidden', 'true');
        button.append(
            swatch,
            createElement('span', 'flex-grow min-w-0 truncate text-sm font-medium text-gray-900', article.title),
            createElement('span', 'shrink-0 text-xs text-gray-500 tabular-nums', formatDistance(distance)),
        );
        button.addEventListener('click', () => {
            hideNearby();
            onPick(article);
        });
        item.appendChild(button);
        return item;
    }));
    nearbyList.scrollTop = 0;
    nearbyBox.classList.remove('hidden');
    document.body.classList.add('nearby-open');
};

// pick: zerrendako artikulu bat aukeratzean
export const initNearby = (pick) => {
    onPick = pick;
    document.getElementById('nearbyClose').addEventListener('click', hideNearby);
    nearbyBox.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideNearby();
    });
};
