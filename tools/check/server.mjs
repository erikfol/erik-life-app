// Serves a docs/ folder, plus /__seed.html, which copies a data folder into the page's private browser storage (OPFS)
// and remembers that as the app's folder. The app then works on that copy and never sees the real data folder.
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

const SEED = `<!doctype html><meta charset="utf-8"><title>seeding</title><pre id="log"></pre><script type="module">
const files = await (await fetch('/__files.json')).json();
const root = await navigator.storage.getDirectory();
for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
for (const file of files) {
    const parts = file.split('/');
    let d = root;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const blob = await (await fetch('/__data/' + parts.map(encodeURIComponent).join('/'))).blob();
    const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await w.write(blob);
    await w.close();
}
// The same IndexedDB place fs.js keeps the chosen folder, so the app connects to the copy by itself.
await new Promise((ok, no) => {
    const req = indexedDB.open('billsetc', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => { const tx = req.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(root, 'root'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); };
    req.onerror = () => no(req.error);
});
document.getElementById('log').textContent = files.length + ' files';
document.title = 'seeded';
</script>`;

async function listFiles(dir, prefix = '') {
    const out = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isDirectory()) out.push(...await listFiles(path.join(dir, e.name), `${prefix}${e.name}/`));
        else if (e.isFile()) out.push(prefix + e.name);
    }
    return out.sort();
}

/** Serve `docs` with the data in `data`; resolves to { port, close() }. */
export function serve(docs, data) {
    const inside = (base, rel) => { const f = path.resolve(base, rel); return f === base || f.startsWith(base + path.sep) ? f : null; };
    const server = http.createServer(async (req, res) => {
        const send = (code, body, type = 'text/plain') => {
            res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            res.end(body);
        };
        try {
            const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
            if (url === '/__seed.html') return send(200, SEED, TYPES['.html']);
            if (url === '/__files.json') return send(200, JSON.stringify(await listFiles(data)), TYPES['.json']);
            if (url.startsWith('/__data/')) {
                const f = inside(path.resolve(data), url.slice('/__data/'.length));
                return f ? send(200, await readFile(f), 'application/octet-stream') : send(404, 'not found');
            }
            let f = inside(path.resolve(docs), '.' + url);
            if (f && (await stat(f).catch(() => null))?.isDirectory()) f = path.join(f, 'index.html');
            if (!f) return send(404, 'not found');
            send(200, await readFile(f), TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream');
        } catch (e) {
            send(e.code === 'ENOENT' ? 404 : 500, String(e.message));
        }
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        port: server.address().port,
        close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
    })));
}
