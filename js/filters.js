// Iragazki-panela: kategoriak, iragazki aktiboen etiketak eta kategoria bakoitzeko kopurua.
// Panela itxita dagoenean "inert" da; ireki eta itxi openFilterPanel/closeFilterPanel bidez bakarrik.
import { filterByCategories } from './api.js';
import { loadOverview, loadSubclasses, overviewCovers } from './data.js';
import { createElement, formatNumber } from './ui.js';

const filterButton = document.getElementById('filterButton');
const closeFilterButton = document.getElementById('closeFilterButton');
const filterPanel = document.getElementById('filterPanel');
const categoryFilters = document.getElementById('category-filters');
const clearFilterButton = document.getElementById('clearFilterButton');
const filterCount = document.getElementById('filterCount');
const activeFiltersBox = document.getElementById('activeFilters');
const categoryCountsNote = document.getElementById('categoryCountsNote');

// Markatutako kategorien data-category balioak
export const activeCategoryFilters = new Set();

let map = null;
let onChange = () => {};
let filterDebounceTimer;

const categoryInputs = () => [...categoryFilters.querySelectorAll('input[type="checkbox"]')];
const categoryLabel = (input) => input.parentElement.querySelector('span').textContent.trim();

// Taldeak (.category-group izenburuak) eta beren kategorien azpiklase guztiak: [[taldea, Set(motak)], ...]
export const categoryGroups = (subclasses) =>
    [...categoryFilters.querySelectorAll('.category-group')].map(heading => {
        const typeSet = new Set();
        let next = heading.nextElementSibling;
        while (next && !next.classList.contains('category-group')) {
            const input = next.querySelector('input[data-category]');
            if (input) input.dataset.category.split(/\s+/).forEach(qid => (subclasses[qid] || []).forEach(type => typeSet.add(type)));
            next = next.nextElementSibling;
        }
        return [heading.dataset.group, typeSet];
    });

const openFilterPanel = () => {
    // Artikuluaren popupa itxi: mugikorrean panelak ia pantaila osoa estaltzen du, eta popupak (bere
    // geruzekin) panela marraztea eragozten zuen
    map.closePopup();
    filterPanel.inert = false;
    filterPanel.classList.add('open');
    filterButton.setAttribute('aria-expanded', 'true');
    // preventScroll: mugikorretan fokuak ez dezala orria mugitu animazioaren erdian
    categoryFilters.querySelector('input')?.focus({ preventScroll: true });
    // Kopuruak irristatze-animazioa (0,3 s) amaitu ondoren kalkulatu, animazioa leuna izan dadin
    setTimeout(updateCategoryCounts, 320);
};
const closeFilterPanel = () => {
    const hadFocus = filterPanel.contains(document.activeElement);
    filterPanel.classList.remove('open');
    filterPanel.inert = true;
    filterButton.setAttribute('aria-expanded', 'false');
    if (hadFocus) filterButton.focus();
};

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
    // Datuak oraindik kargatzen ari badira (mugikorreko sare motelean), "…"
    categoryInputs().forEach(input => {
        const count = input.parentElement.querySelector('.category-count');
        if (!count.textContent) count.textContent = '…';
    });
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
    filterDebounceTimer = setTimeout(onChange, 150);
};

// change: iragazkiak aldatzean (mapa eguneratzeko)
export const initFilters = (leafletMap, change) => {
    map = leafletMap;
    onChange = change;
    filterButton.addEventListener('click', openFilterPanel);
    closeFilterButton.addEventListener('click', closeFilterPanel);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && filterPanel.classList.contains('open')) closeFilterPanel();
    });
    categoryFilters.addEventListener('change', (event) => {
        if (event.target.matches('input[type="checkbox"]')) applyFilters();
    });
    clearFilterButton.addEventListener('click', () => {
        categoryInputs().forEach(input => { input.checked = false; });
        applyFilters();
    });
    map.on('moveend', updateCategoryCounts);
};
