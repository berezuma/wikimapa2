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
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['smoke.html', 'keyboard.html'];
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

const runPage = async (chrome, url) => {
    const profile = await mkdtemp(join(tmpdir(), 'wikimapa-e2e-'));
    try {
        const args = ['--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--window-size=1280,800',
            '--virtual-time-budget=150000', '--dump-dom', url];
        if (process.env.CHROME_NO_SANDBOX) args.unshift('--no-sandbox');
        const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'ignore'] });
        let dom = '';
        child.stdout.on('data', (chunk) => { dom += chunk; });
        const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
        await new Promise((resolve) => child.on('close', resolve));
        clearTimeout(timer);
        const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
        if (!match) return { checks: [{ name: 'orriak emaitzarik ez du itzuli', ok: false }] };
        const text = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        return JSON.parse(text);
    } finally {
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
