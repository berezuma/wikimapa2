// Proba-orrien laguntzaileak: aplikazioa iframe batean kargatu eta emaitzak <pre id="result">-en idatzi (JSON).
const results = { checks: [], done: false };

const writeResults = () => {
    document.getElementById('result').textContent = JSON.stringify(results);
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const until = async (fn, ms = 20000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
        const value = fn();
        if (value) return value;
        await sleep(200);
    }
    return null;
};

export const check = (name, ok, detail = '') => {
    results.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
    writeResults();
};

// query: index.html-ri pasatzeko URL parametroak. Itzultzen du { w, d } (iframe-aren window eta document).
export const loadApp = (query = '') => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:1000px;height:700px;border:0';
    frame.src = `/index.html${query}`;
    frame.onload = () => resolve({ w: frame.contentWindow, d: frame.contentDocument });
    document.body.prepend(frame);
});

export const key = (w, element, keyName) =>
    element.dispatchEvent(new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));

export const type = (w, input, text) => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new w.Event('input'));
};

export const run = async (fn) => {
    try {
        await fn();
    } catch (error) {
        check('salbuespena', false, error.stack);
    }
    results.done = true;
    writeResults();
};
