// Access to the user's local erik-life-app folder via the File System Access API (Chrome / Edge).
// The folder handle is remembered in IndexedDB so it can be reconnected after a reload.
// Signed in to Dropbox on this device (a tablet or phone, which can't open a local folder): the same files are read
// and written in the Dropbox app folder instead (shared/js/dropbox.js). Decided when the page loads.
import * as dbx from '../../shared/js/dropbox.js';

const DROPBOX = { name: 'Dropbox', kind: 'dropbox' };
let root = dbx.signedIn() ? DROPBOX : null;

// Chrome on Android may offer folder access too, but the data isn't on the tablet or phone: there it's Dropbox.
export const isSupported = () => typeof window.showDirectoryPicker === 'function' && !/Android/i.test(navigator.userAgent);
export const folder = () => root;
export const isCloud = () => root === DROPBOX;

/** Go to Dropbox to sign in; this page opens again afterwards, using Dropbox. */
export const useDropbox = (returnTo = location.href) => dbx.signIn(returnTo);

/** Sign this device out of Dropbox. */
export async function leaveDropbox() {
    await dbx.signOut();
    if (isCloud()) root = null;
}

const FILE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    heic: 'image/heic', bmp: 'image/bmp', pdf: 'application/pdf' };
const typeOf = name => FILE_TYPES[name.split('.').pop().toLowerCase()] || '';

/** Use an already-obtained directory handle (e.g. the browser-private OPFS root for testing). */
export const useFolder = handle => { root = handle; };

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('billsetc', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
    });
}

export async function pickFolder() {
    const handle = await window.showDirectoryPicker({ id: 'billsetc', mode: 'readwrite' });
    root = handle;
    try { await idbOp('readwrite', s => s.put(handle, 'root')); } catch { /* not remembered; fine */ }
    return handle;
}

/** True if the folder behind `handle` is no longer there (moved or renamed after it was chosen). Needs permission. */
export async function isGone(handle) {
    try { await handle.values().next(); return false; } catch (e) { return e.name === 'NotFoundError'; }
}

/** What to tell the user when their folder is no longer where it was chosen. */
export const movedMessage = handle =>
    `The folder “${handle.name}” was moved or renamed after it was chosen, so its files can’t be found.`;

function movedError() {
    const e = new Error(`${movedMessage(root)} Reload the page (F5) and choose it again where it is now.`);
    e.name = 'FolderMovedError';
    return e;
}

// A missing file is normal, but the whole folder missing is not: say so instead of acting as if it were empty.
async function checkFolder(e) {
    if (e.name === 'NotFoundError' && root && await isGone(root)) throw movedError();
}

/** Returns {handle, granted, moved} for the remembered folder, or null. A moved folder is not connected. */
export async function rememberedFolder() {
    if (isCloud()) return null; // using Dropbox, not a folder on this computer
    let handle;
    try { handle = await idbOp('readonly', s => s.get('root')); } catch { return null; }
    if (!handle) return null;
    const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    const moved = granted && await isGone(handle);
    if (granted && !moved) root = handle;
    return { handle, granted, moved };
}

/** Remember another folder handle under `key` (e.g. where the phone copy goes). */
export async function rememberHandle(key, handle) {
    try { await idbOp('readwrite', s => s.put(handle, key)); } catch { /* not remembered; fine */ }
}

/** A folder handle remembered under `key`, or null. */
export async function rememberedHandle(key) {
    try { return (await idbOp('readonly', s => s.get(key))) || null; } catch { return null; }
}

/** Must be called from a user gesture. False if not allowed or moved (rememberedFolder() then reports `moved`). */
export async function reconnect(handle) {
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    if (await isGone(handle)) return false;
    root = handle;
    return true;
}

async function dir(path, create = false) {
    if (!root) throw new Error('No folder selected — choose your erik-life-app folder on the Setup page.');
    let d = root;
    for (const part of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
    return d;
}

function split(path) {
    const i = path.lastIndexOf('/');
    return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
}

/** File text, or null if it doesn't exist. */
export async function readText(path) {
    if (isCloud()) { const f = await dbx.download(path); return f && await f.blob.text(); }
    const [d, name] = split(path);
    try {
        const fh = await (await dir(d)).getFileHandle(name);
        return await (await fh.getFile()).text();
    } catch (e) {
        await checkFolder(e);
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

/** The file itself (a File, e.g. for showing a photo), or null if it doesn't exist. */
export async function readFile(path) {
    const [d, name] = split(path);
    if (isCloud()) {
        const f = await dbx.download(path);
        return f && new File([f.blob], name, { type: typeOf(name), lastModified: Date.parse(f.meta.server_modified) || Date.now() });
    }
    try {
        return await (await (await dir(d)).getFileHandle(name)).getFile();
    } catch (e) {
        await checkFolder(e);
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

/** An image for showing on screen: the file itself, or from Dropbox a smaller copy (photos are camera-sized). */
export async function readImage(path) {
    if (!isCloud()) return readFile(path);
    const small = await dbx.thumbnail(path).catch(() => null); // e.g. a type Dropbox can't shrink: use the file
    return small ? new File([small], split(path)[1], { type: 'image/jpeg' }) : readFile(path);
}

/** When the file was last written, or null if it doesn't exist. */
export async function modifiedAt(path) {
    if (isCloud()) { const m = await dbx.metadata(path); return m?.['.tag'] === 'file' ? new Date(m.server_modified) : null; }
    const [d, name] = split(path);
    try {
        return new Date((await (await (await dir(d)).getFileHandle(name)).getFile()).lastModified);
    } catch (e) {
        await checkFolder(e);
        if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
        throw e;
    }
}

export async function writeText(path, text) {
    if (isCloud()) { await dbx.upload(path, text); return; }
    if (root && await isGone(root)) throw movedError(); // never write into a moved folder's old place
    const [d, name] = split(path);
    const fh = await (await dir(d, true)).getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
}

export async function exists(path) {
    if (isCloud()) return (await dbx.metadata(path))?.['.tag'] === 'file';
    return (await readText(path)) !== null;
}

export async function removeFile(path) {
    if (isCloud()) { await dbx.remove(path); return; }
    const [d, name] = split(path);
    try { await (await dir(d)).removeEntry(name); } catch (e) { await checkFolder(e); throw e; }
}

/** Names of files in `path` ending with `ext` (case-insensitive), sorted. Missing folder → []. */
export async function listFiles(path, ext = '.csv') {
    if (isCloud()) {
        return ((await dbx.list(path)) || []).filter(e => e['.tag'] === 'file' && e.name.toLowerCase().endsWith(ext))
            .map(e => e.name).sort();
    }
    let d;
    try { d = await dir(path); } catch (e) { await checkFolder(e); if (e.name === 'NotFoundError') return []; throw e; }
    const names = [];
    for await (const [name, h] of d.entries()) {
        if (h.kind === 'file' && name.toLowerCase().endsWith(ext)) names.push(name);
    }
    return names.sort();
}

export async function moveFile(from, to) {
    await writeText(to, await readText(from));
    await removeFile(from);
}
