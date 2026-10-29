// Manual backup from the Home page (on the PC): copies your data — config.json, inputs/, output_master_data/, reports/ —
// from your folder (the Dropbox folder on this PC) into a new dated folder inside a backup folder you choose on this PC,
// and logs each backup in backups.json in your folder, so the Home page can say how many days it's been since the last.
// A tablet or phone can't make one (no folders there), but shows how long ago the last one was.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';

/** What a backup copies, from the top of your folder. Anything else there (like Dropbox's desktop.ini) is left out. */
const DATA = ['config.json', 'inputs', 'output_master_data', 'reports', 'backups.json'];
const LOG_PATH = 'backups.json';
const DEST_KEY = 'backup'; // the backup folder, remembered in this browser
const DAY = 864e5;

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mb = n => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const longDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The backups made so far, oldest first: [{ date ('YYYY-MM-DDTHH:MM', this PC's time), folder, to, files, bytes }]. */
async function loadLog() {
    const text = await fs.readText(LOG_PATH);
    const list = text ? JSON.parse(text).backups : null;
    return Array.isArray(list) ? list : [];
}

async function saveLog(list) {
    await fs.writeText(LOG_PATH, JSON.stringify({
        _readme: 'Manual backups made from the Home page, oldest first. Each is a copy of this folder\'s data in a dated folder on the PC.',
        backups: list,
    }, null, 2) + '\n');
}

/** Every file of the data at the top of `root`: [{ path ('inputs/pets/pets.json'), handle }]. */
async function dataFiles(root) {
    const out = [];
    const walk = async (h, path) => {
        if (h.kind === 'file') { out.push({ path, handle: h }); return; }
        for await (const [name, child] of h.entries()) await walk(child, `${path}/${name}`);
    };
    for (const name of DATA) {
        const h = await root.getDirectoryHandle(name).catch(() => root.getFileHandle(name)).catch(() => null);
        if (h) await walk(h, name);
    }
    return out;
}

/** A new folder in `dest` named 'ErikLifeApp backup 2026-10-29 1104' (with ' (2)' … if that's taken). */
async function newSnapshot(dest, now) {
    const base = `ErikLifeApp backup ${stamp(now)} ${pad(now.getHours())}${pad(now.getMinutes())}`;
    for (let n = 1; ; n++) {
        const name = n === 1 ? base : `${base} (${n})`;
        const taken = await dest.getDirectoryHandle(name).then(() => true, () => false);
        if (!taken) return dest.getDirectoryHandle(name, { create: true });
    }
}

/** Copy the data from `root` into a new dated folder in `dest`. onProgress(done, total, bytes). Returns the log entry. */
export async function backUp(root, dest, onProgress = () => {}) {
    const now = new Date();
    const files = await dataFiles(root);
    if (!files.some(f => f.path.startsWith('inputs/'))) throw new Error('Your folder has no inputs/ folder, so there\'s nothing to back up');
    const snap = await newSnapshot(dest, now);
    const dirs = new Map([['', snap]]);
    const dirFor = async path => {
        if (dirs.has(path)) return dirs.get(path);
        const i = path.lastIndexOf('/');
        const d = await (await dirFor(i < 0 ? '' : path.slice(0, i))).getDirectoryHandle(path.slice(i + 1), { create: true });
        dirs.set(path, d);
        return d;
    };
    let bytes = 0;
    for (const [k, f] of files.entries()) {
        const i = f.path.lastIndexOf('/');
        const file = await f.handle.getFile();
        const w = await (await (await dirFor(i < 0 ? '' : f.path.slice(0, i))).getFileHandle(f.path.slice(i + 1), { create: true })).createWritable();
        await w.write(file);
        await w.close();
        bytes += file.size;
        onProgress(k + 1, files.length, bytes);
    }
    return { date: `${stamp(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`, folder: snap.name, to: dest.name, files: files.length, bytes };
}

/** The Backup line on the Home page. Returns { refresh() }, to call once the folder (or Dropbox) is connected. */
export function backupPanel(el) {
    const pc = fs.isSupported();
    let busy = false;

    const lastText = log => {
        const last = log.at(-1);
        if (!last) return 'No manual backup yet.';
        const [y, m, d] = last.date.slice(0, 10).split('-').map(Number);
        const t = new Date(), days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(y, m - 1, d)) / DAY);
        const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
        return `Last manual backup: <strong>${ago}</strong> <span class="muted">(${esc(longDay(new Date(y, m - 1, d)))}${last.to ? `, to “${esc(last.to)}”` : ''})</span>`;
    };

    async function draw(message = '') {
        if (!fs.folder() || (pc && fs.isCloud())) {
            el.innerHTML = pc ? `<strong>Backup</strong> <span class="muted">${fs.isCloud() ? 'Backups are made from your folder: sign out of Dropbox on this PC first.'
                : 'Reconnect your folder above to back up.'}</span>` : '';
            el.hidden = !pc;
            return;
        }
        let log = [];
        try { log = await loadLog(); } catch (e) { message ||= `<span class="bad">Couldn't read ${LOG_PATH}: ${esc(e.message)}</span>`; }
        const dest = pc ? await fs.rememberedHandle(DEST_KEY) : null;
        el.innerHTML = `<strong>Backup</strong> ${lastText(log)}
            ${pc ? `<button type="button" class="primary" data-backup>💾 Back up now</button>
                <button type="button" data-choose>${dest ? 'Change backup folder…' : 'Choose backup folder…'}</button>
                <span class="muted">${dest ? `Goes to “${esc(dest.name)}” on this PC` : 'Pick a folder on this PC, outside Dropbox'}${log.at(-1)?.bytes ? ` · about ${mb(log.at(-1).bytes)}` : ''}</span>`
                : '<span class="muted">(backups are made on the PC)</span>'}
            ${message ? `<div class="backup-msg">${message}</div>` : ''}`;
        el.hidden = false;
        el.querySelector('[data-backup]')?.addEventListener('click', run);
        el.querySelector('[data-choose]')?.addEventListener('click', async () => { if (await choose()) draw(); });
    }

    /** Pick the backup folder (not inside your data folder). The handle, or null if cancelled. */
    async function choose() {
        let h;
        try { h = await window.showDirectoryPicker({ id: 'erik-backup', mode: 'readwrite', startIn: 'documents' }); } catch { return null; }
        if ((await fs.folder().resolve(h)) !== null) {
            draw('<span class="bad">That folder is inside your data folder (Dropbox). Pick one outside it, e.g. a new folder in Documents.</span>');
            return null;
        }
        await fs.rememberHandle(DEST_KEY, h);
        return h;
    }

    async function run() {
        if (busy) return;
        let dest = await fs.rememberedHandle(DEST_KEY);
        // Chrome asks again after it restarts; a backup folder that was moved or deleted is chosen again.
        if (dest && ((await dest.requestPermission({ mode: 'readwrite' })) !== 'granted' || await fs.isGone(dest))) dest = null;
        dest ||= await choose();
        if (!dest) return;
        busy = true;
        const btn = el.querySelector('[data-backup]');
        btn.disabled = true;
        const show = text => { btn.textContent = text; };
        show('Backing up…');
        try {
            const entry = await backUp(fs.folder(), dest, (done, total, bytes) => show(`Backing up… ${done} of ${total} files (${mb(bytes)})`));
            await saveLog([...(await loadLog().catch(() => [])), entry]);
            busy = false;
            draw(`<span class="ok">✓ Backed up ${entry.files} files (${mb(entry.bytes)}) to “${esc(entry.to)}” › ${esc(entry.folder)}</span>`);
        } catch (e) {
            busy = false;
            console.error(e);
            draw(`<span class="bad">The backup didn't finish: ${esc(e.message)}. Any new “ErikLifeApp backup …” folder it started in “${esc(dest.name)}” is incomplete; you can delete it.</span>`);
        }
    }

    return { refresh: () => (busy ? null : draw()) };
}
