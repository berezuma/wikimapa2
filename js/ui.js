// Interfazeko laguntzaile orokorrak: DOM elementuak, zenbakiak, kargatze-adierazlea eta maparen gaineko mezuak

const loader = document.getElementById('loader');
const loaderText = document.getElementById('loader-text');
const mapMessage = document.getElementById('mapMessage');
const mapMessageText = document.getElementById('mapMessageText');

let mapMessageTimer;
let loaderTimer;

export const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};

// Milakoak puntuz (1.109), euskarazko idazkeraren arabera
export const formatNumber = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// Adierazlea 300 ms-tik gorako kargetan bakarrik agertzen da (bestela keinuka ibiliko litzateke)
export const showLoader = (text = "Artikuluak kargatzen...") => {
    loaderText.textContent = text;
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(() => loader.classList.remove('hidden'), 300);
};
export const hideLoader = () => {
    clearTimeout(loaderTimer);
    loader.classList.add('hidden');
};

// timeout ematen bada, mezua automatikoki ezkutatzen da
export const showMapMessage = (text, timeout = 0) => {
    clearTimeout(mapMessageTimer);
    mapMessageText.textContent = text;
    mapMessage.classList.remove('hidden');
    if (timeout) mapMessageTimer = setTimeout(hideMapMessage, timeout);
};
export const hideMapMessage = () => {
    clearTimeout(mapMessageTimer);
    mapMessageTimer = null;
    mapMessage.classList.add('hidden');
};
// Mapa eguneratzean: egoera-mezuak (iraunkorrak) bakarrik ezkutatu, ez "esteka kopiatu da" bezalakoak
export const hideStatusMessage = () => {
    if (!mapMessageTimer) hideMapMessage();
};
