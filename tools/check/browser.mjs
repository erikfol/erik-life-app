// A headless Chrome (or Edge) in a throwaway profile, driven over the DevTools protocol. Nothing here touches the
// browser you normally use.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import net from 'node:net';

const BROWSERS = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
].filter(Boolean);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A port nothing is listening on. */
export const freePort = () => new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
});

/** Start the browser with its profile in `profile` (emptied first). Returns { send, evaluate, on, close }. */
export async function launch(profile) {
    const exe = BROWSERS.find(p => existsSync(p));
    if (!exe) throw new Error('No Chrome or Edge found. Set CHROME to the browser\'s path.');
    rmSync(profile, { recursive: true, force: true });
    const port = await freePort();
    const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
        '--no-default-browser-check', '--disable-extensions', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
    let url;
    for (let i = 0; i < 75 && !url; i++) {
        await sleep(200);
        try { url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
    }
    if (!url) { proc.kill(); throw new Error('The browser didn\'t start.'); }
    const ws = new WebSocket(url);
    await new Promise((ok, no) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', no, { once: true }); });
    let nextId = 0;
    const pending = new Map(), listeners = new Set();
    ws.addEventListener('message', e => {
        const m = JSON.parse(e.data);
        if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); } else for (const l of listeners) l(m);
    });
    const send = (method, params = {}) => new Promise((res, rej) => {
        const id = ++nextId;
        pending.set(id, m => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
        ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
    };
    const on = fn => { listeners.add(fn); return () => listeners.delete(fn); };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');
    const close = async () => {
        try { ws.close(); } catch { /* gone */ }
        proc.kill();
        await sleep(500);
    };
    return { send, evaluate, on, close };
}

/** Open `url` and wait for it to load and stop changing. */
export async function open(browser, url) {
    const loaded = new Promise(r => { const off = browser.on(m => { if (m.method === 'Page.loadEventFired') { off(); r(); } }); });
    await browser.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(15000)]);
    await settle(browser);
}

/** Wait until the page has gone 0.9 s without a change (at most 15 s). */
export const settle = browser => browser.evaluate(`new Promise(res => {
    let t; const done = () => { obs.disconnect(); res(true); };
    const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, 900); });
    obs.observe(document, { subtree: true, childList: true, characterData: true });
    t = setTimeout(done, 900); setTimeout(done, 15000);
})`);
