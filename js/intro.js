// Sarrera animatua: lehen bisitan, parametrorik gabe (partekatutako esteketan ez) eta mugimendua murriztu gabe.
// Kontagailua, muga marrazten den animazioa eta markatzaileak gero agertzea.
import { loadOverview } from './data.js';
import { formatNumber } from './ui.js';

const INTRO_KEY = 'wikimapa-sarrera-ikusita';

export const introActive = (() => {
    if (window.location.search || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    try {
        if (localStorage.getItem(INTRO_KEY)) return false;
        localStorage.setItem(INTRO_KEY, '1');
    } catch {
        // localStorage-rik gabe: sarrera erakutsi (ezin da gogoratu)
    }
    return true;
})();

// Muga marrazten den animazioa (SVG trazuaren luzera), gero betegarria
export const animateBorder = (border) => {
    const path = border.getElement();
    if (!path?.getTotalLength) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.style.fillOpacity = '0';
    path.getBoundingClientRect(); // hasierako egoera aplikatzeko
    path.style.transition = 'stroke-dashoffset 2.2s ease-in-out, fill-opacity 0.8s ease 2s';
    path.style.strokeDashoffset = '0';
    path.style.fillOpacity = '';
    // Zoomak trazuaren luzera aldatzen du: amaitzean estiloak kendu
    setTimeout(() => {
        path.style.transition = '';
        path.style.strokeDasharray = '';
        path.style.strokeDashoffset = '';
    }, 3000);
};

// Kontagailua 0tik artikulu-kopururaino, eta gero txartela desagertzen da
export const runIntro = async () => {
    const intro = document.getElementById('intro');
    const introCount = document.getElementById('introCount');
    const mapElement = document.getElementById('map');
    mapElement.classList.add('wm-intro-running');
    setTimeout(() => mapElement.classList.remove('wm-intro-running'), 1800);
    try {
        const { articles } = await loadOverview();
        intro.classList.remove('hidden');
        const total = articles.length;
        const start = performance.now();
        const duration = 2000;
        const tick = (now) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            introCount.textContent = formatNumber(Math.round(total * eased));
            if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => intro.classList.add('leaving'), 3200);
        setTimeout(() => intro.classList.add('hidden'), 3900);
    } catch {
        mapElement.classList.remove('wm-intro-running');
    }
};
