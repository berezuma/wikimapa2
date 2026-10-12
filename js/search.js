// Bilatzailea: ARIA combobox-a (gezi-teklak, Enter, Escape), Wikipediaren prefixsearch-ekin
import { isAbortError, searchArticles } from './api.js';
import { createElement } from './ui.js';

const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

let searchDebounceTimer;
let searchController = null;
let onSelect = () => {};

const hideSearchResults = () => {
    searchResults.innerHTML = '';
    searchResults.classList.add('hidden');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeResultIndex = -1;
};

// Bilaketa bertan behera utzi eta testua ezarri (artikulu bat hautatzean, edo hutsik)
export const setSearchText = (text) => {
    searchController?.abort();
    clearTimeout(searchDebounceTimer);
    searchInput.value = text;
    hideSearchResults();
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
        onSelect(items[Math.max(activeResultIndex, 0)].dataset.title);
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

    option.onclick = () => onSelect(result.title);
    return option;
};

const debouncedSearch = () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(handleSearch, 250);
};

// select: emaitza bat aukeratzean deitzen da (izenburuarekin)
export const initSearch = (select) => {
    onSelect = select;
    searchInput.addEventListener('input', debouncedSearch);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    document.addEventListener('click', (e) => {
        if (!searchResults.contains(e.target) && e.target !== searchInput) hideSearchResults();
    });
};
