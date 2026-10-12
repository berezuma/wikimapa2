// Denbora-lerroa. Graduatzailea artikuluen indizearen araberakoa da (ez urtearena): urte bakoitzak
// bere artikulu-kopuruaren araberako tartea du, eta Erdi Aroa ez da milurteko hutsetan galtzen.
import { loadOverview } from './data.js';
import { formatNumber, showMapMessage } from './ui.js';

const timelineButton = document.getElementById('timelineButton');
const timelineBox = document.getElementById('timeline');
const timelinePlay = document.getElementById('timelinePlay');
const timelineSlider = document.getElementById('timelineSlider');

let timelineYears = null; // data duten artikuluen urteak, goranzko ordenan
let timelineIndex = null; // null: itxita
let timelinePlayTimer = null;
let onChange = () => {};
const ERAS = [[476, 'Antzinaroa'], [1492, 'Erdi Aroa'], [1789, 'Aro Modernoa'], [Infinity, 'Aro Garaikidea']];
const formatYear = (year) => (year < 0 ? `K.a. ${formatNumber(-year)}` : String(year));

// Aukeratutako urtea, edo null denbora-lerroa itxita badago
export const timelineYear = () => (timelineIndex === null ? null : timelineYears[timelineIndex]);

const updateTimelineLabels = () => {
    const year = timelineYears[timelineIndex];
    // Urte bereko artikulu guztiak barne
    let count = timelineIndex + 1;
    while (count < timelineYears.length && timelineYears[count] === year) count++;
    document.getElementById('timelineYear').textContent = formatYear(year);
    document.getElementById('timelineEra').textContent = ERAS.find(([end]) => year < end)[1];
    document.getElementById('timelineCount').textContent = `${formatNumber(count)} leku`;
    timelineSlider.setAttribute('aria-valuetext', formatYear(year));
};

const setTimelineIndex = (index) => {
    timelineIndex = Math.max(0, Math.min(timelineYears.length - 1, index));
    timelineSlider.value = String(timelineIndex);
    updateTimelineLabels();
    onChange();
};

const stopTimelinePlay = () => {
    clearInterval(timelinePlayTimer);
    timelinePlayTimer = null;
    document.getElementById('timelinePlayIcon').classList.remove('hidden');
    document.getElementById('timelinePauseIcon').classList.add('hidden');
    timelinePlay.setAttribute('aria-label', 'Erreproduzitu');
};

// ~12 segundotan hasieratik bukaerara
const startTimelinePlay = () => {
    if (timelineIndex >= timelineYears.length - 1) setTimelineIndex(0);
    const step = Math.max(1, Math.ceil(timelineYears.length / 240));
    document.getElementById('timelinePlayIcon').classList.add('hidden');
    document.getElementById('timelinePauseIcon').classList.remove('hidden');
    timelinePlay.setAttribute('aria-label', 'Gelditu');
    timelinePlayTimer = setInterval(() => {
        if (timelineIndex >= timelineYears.length - 1) {
            stopTimelinePlay();
            return;
        }
        setTimelineIndex(timelineIndex + step);
    }, 50);
};

const openTimeline = async () => {
    try {
        const { articles } = await loadOverview();
        timelineYears = articles.filter(article => article.year !== null).map(article => article.year).sort((a, b) => a - b);
        if (timelineYears.length === 0) return;
        timelineSlider.max = String(timelineYears.length - 1);
        document.getElementById('timelineTotal').textContent = `${formatNumber(timelineYears.length)} leku datatu`;
        timelineBox.classList.remove('hidden');
        document.body.classList.add('timeline-open');
        timelineButton.setAttribute('aria-pressed', 'true');
        setTimelineIndex(0);
        startTimelinePlay();
    } catch (error) {
        console.error("Errorea denbora-lerroa irekitzean:", error);
        showMapMessage('Errorea gertatu da denbora-lerroa irekitzean.', 3000);
    }
};

const closeTimeline = () => {
    stopTimelinePlay();
    timelineIndex = null;
    timelineBox.classList.add('hidden');
    document.body.classList.remove('timeline-open');
    timelineButton.setAttribute('aria-pressed', 'false');
    onChange();
};

// change: urtea aldatzean edo denbora-lerroa ireki/ixtean (mapa eguneratzeko)
export const initTimeline = (change) => {
    onChange = change;
    timelineButton.addEventListener('click', () => (timelineIndex === null ? openTimeline() : closeTimeline()));
    document.getElementById('timelineClose').addEventListener('click', closeTimeline);
    timelinePlay.addEventListener('click', () => (timelinePlayTimer ? stopTimelinePlay() : startTimelinePlay()));
    timelineSlider.addEventListener('input', () => {
        stopTimelinePlay();
        setTimelineIndex(Number(timelineSlider.value));
    });
};
