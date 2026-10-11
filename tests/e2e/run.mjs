// Nabigatzaileko probak: zerbitzari estatiko bat abiarazi eta proba-orri bakoitza Chrome headless-en exekutatu.
// Proba-orriek benetako Wikipedia/Wikidata APIak erabiltzen dituzte, beraz sarea behar da.
// Erabilera: npm run test:e2e [-- orria.html ...]   (CHROME_BIN aldagaiarekin nabigatzailea aukeratu daiteke)
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['smoke.html', 'keyboard.html', 'filters.html', 'overview.html'];
const TIMEOUT_MS = 180000;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const findChrome = () => {
    if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
        if (spawnSync('which', [name]).status === 0) return name;
    }
    throw new Error('Ez da Chrome aurkitu. Ezarri CHROME_BIN aldagaia.');
};

const startServer = () => new Promise((resolve) => {
    const server = createServer(async (req, res) => {
        const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
        try {
            const body = await readFile(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
            res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(path)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404); res.end();
        }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
});

// Chrome DevTools Protocol, pipe bidez (--remote-debugging-pipe: fd 3 idazteko, fd 4 irakurtzeko; mezuak \0-z bukatuta)
const connectCdp = (child) => {
    let nextId = 1;
    let buffer = '';
    const pending = new Map();
    child.stdio[4].on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\0')) >= 0) {
            const message = JSON.parse(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
            if (message.id && pending.has(message.id)) {
                const { resolve, reject } = pending.get(message.id);
                pending.delete(message.id);
                if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
            }
        }
    });
    return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
};

// Orria denbora errealean exekutatu eta <pre id="result">-ek done: true izan arte itxaron
const runPage = async (chrome, url) => {
    const profile = await mkdtemp(join(tmpdir(), 'wikimapa-e2e-'));
    const args = ['--headless=new', '--disable-gpu', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
        '--window-size=1280,800', 'about:blank'];
    if (process.env.CHROME_NO_SANDBOX) args.unshift('--no-sandbox');
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    const send = connectCdp(child);
    try {
        const { targetId } = await send('Target.createTarget', { url });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const deadline = Date.now() + TIMEOUT_MS;
        let result = null;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const { result: value } = await send('Runtime.evaluate', {
                expression: "document.getElementById('result')?.textContent || ''", returnByValue: true,
            }, sessionId);
            if (value.value) result = JSON.parse(value.value);
            if (result?.done) break;
        }
        return result || { checks: [{ name: 'orriak emaitzarik ez du itzuli', ok: false }] };
    } finally {
        child.kill();
        await new Promise((resolve) => child.on('close', resolve));
        await rm(profile, { recursive: true, force: true });
    }
};

const chrome = findChrome();
const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
let failed = 0;

for (const page of PAGES) {
    console.log(`\n${page}`);
    const result = await runPage(chrome, `${base}/tests/e2e/${page}`);
    for (const check of result.checks) {
        if (!check.ok) failed++;
        console.log(`  ${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` (${check.detail})` : ''}`);
    }
    if (!result.done) { failed++; console.log('  ✗ proba ez da amaitu'); }
}

server.close();
console.log(failed ? `\n${failed} egiaztapenek huts egin dute` : '\nDena ondo');
process.exit(failed ? 1 : 0);
