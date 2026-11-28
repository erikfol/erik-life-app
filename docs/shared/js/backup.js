// Manual backup from the Home page (on the PC): copies your data — config.json, inputs/, output_master_data/ —
// from your folder (the Dropbox folder on this PC) into a new dated folder inside a backup folder you choose on this PC,
// and logs each backup in backups.json in your folder, so the Home page can say how many days it's been since the last.
// A tablet or phone can't make one (no folders there), but shows how long ago the last one was.
import * as fs from './fs.js';
import { esc } from './util.js';
import { daysBetween } from './dates.js';

/** What a backup copies, from the top of your folder. Anything else there (like Dropbox's desktop.ini) is left out. */
const DATA = ['config.json', 'inputs', 'output_master_data', 'backups.json'];
const LOG_PATH = 'backups.json';
const DEST_KEY = 'backup'; // the backup folder, remembered in this browser
/** The Backup line turns yellow after this many days without a backup, and red after this many (or with none yet). */
export const BACKUP_YELLOW_DAYS = 15, BACKUP_RED_DAYS = 30;

const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mb = n => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
const longDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * backups.json: { location, backups }. backups are the backups made so far, oldest first:
 * [{ date ('YYYY-MM-DDTHH:MM', this PC's time), folder, to (the backup folder's name), files, bytes, path? }].
 * location is { folder, path }: where the backup folder is on the PC, typed in once, since Chrome only tells a page
 * a folder's name. null until it's given.
 */
async function loadLog() {
    const text = await fs.readText(LOG_PATH);
    const data = text ? JSON.parse(text) : {};
    return {
        backups: Array.isArray(data.backups) ? data.backups : [],
        location: data.location?.folder && data.location?.path ? data.location : null,
    };
}

async function saveLog({ backups, location }) {
    await fs.writeText(LOG_PATH, JSON.stringify({
        _readme: 'Manual backups made from the Home page, oldest first. Each is a copy of this folder\'s data in a dated folder on the PC. location is where the backup folder is on the PC (Chrome only tells the app its name).',
        ...(location ? { location } : {}),
        backups,
    }, null, 2) + '\n');
}

/** Where the backup folder called `name` is on the PC, if that's the folder whose location was given; else ''. */
const pathOf = (location, name) => (location && name && location.folder.toLowerCase() === name.toLowerCase() ? location.path : '');

/** { path } from a pasted location (File Explorer's "Copy as path" adds quotes), or { error }. */
export function cleanPath(text, name) {
    const path = text.trim().replace(/^"(.*)"$/, '$1').trim().replace(/(?<=.)[\\/]+$/, '');
    if (!path) return { error: 'Paste the folder’s location first.' };
    const last = path.split(/[\\/]/).pop();
    if (last.toLowerCase() !== name.toLowerCase()) return { error: `That location ends in “${last}”, but the folder you picked is called “${name}”.` };
    return { path };
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

    /** { level ('ok', 'yellow' over BACKUP_YELLOW_DAYS, 'red' over BACKUP_RED_DAYS or none yet), html } */
    const status = ({ backups, location }) => {
        const last = backups.at(-1);
        if (!last) return { level: 'red', html: '<strong>No manual backup yet.</strong>' };
        const [y, m, d] = last.date.slice(0, 10).split('-').map(Number);
        const days = daysBetween(new Date(y, m - 1, d), new Date());
        const path = last.path || pathOf(location, last.to);
        const when = `<span class="muted">(${esc(longDay(new Date(y, m - 1, d)))}${path ? `, to ${esc(path)}` : last.to ? `, to “${esc(last.to)}”` : ''})</span>`;
        return {
            level: days > BACKUP_RED_DAYS ? 'red' : days > BACKUP_YELLOW_DAYS ? 'yellow' : 'ok',
            html: days === 0 ? `Your last backup was <strong>today</strong> ${when}`
                : `It's been <strong>${days} day${days === 1 ? '' : 's'}</strong> since your last backup ${when}`,
        };
    };

    /** The Backup line. `ask`: also ask where the backup folder is on the PC (after it's chosen). */
    async function draw(message = '', ask = false) {
        if (!fs.folder() || (pc && fs.isCloud())) {
            el.innerHTML = pc ? `<strong>Backup</strong> <span class="muted">${fs.isCloud() ? 'Backups are made from your folder: sign out of Dropbox on this PC first.'
                : 'Reconnect your folder above to back up.'}</span>` : '';
            el.className = 'backup';
            el.hidden = !pc;
            return;
        }
        let log = { backups: [], location: null }, readable = true;
        try { log = await loadLog(); } catch (e) {
            readable = false;
            message ||= `<span class="bad">Couldn't read ${LOG_PATH}: ${esc(e.message)}</span>`;
        }
        const dest = pc ? await fs.rememberedHandle(DEST_KEY) : null;
        const destPath = dest ? pathOf(log.location, dest.name) : '';
        ask &&= !!dest && readable;
        const s = status(log);
        const size = log.backups.at(-1)?.bytes ? ` · about ${mb(log.backups.at(-1).bytes)}` : '';
        el.className = `backup ${s.level}`;
        el.innerHTML = `<strong>Backup</strong> ${s.html}
            ${pc ? `<button type="button" class="primary" data-backup>💾 Back up now</button>
                <button type="button" data-choose>${dest ? 'Change backup folder…' : 'Choose backup folder…'}</button>
                <span class="muted">${!dest ? 'Pick a folder on this PC, outside Dropbox'
                    : destPath ? `Goes to ${esc(destPath)}`
                    : `Goes to “${esc(dest.name)}” on this PC${ask || !readable ? '' : ' <button type="button" data-where>Add its location</button>'}`}${size}</span>`
                : '<span class="muted">(backups are made on the PC)</span>'}
            ${message ? `<div class="backup-msg">${message}</div>` : ''}
            ${ask ? `<div class="backup-msg backup-where">
                Where is “${esc(dest.name)}” on this PC? Chrome only tells the app its name. In File Explorer, open the folder,
                click the address bar, copy, and paste it here:
                <div class="backup-where-row">
                    <input type="text" data-path spellcheck="false" autocomplete="off" placeholder="C:\\…\\${esc(dest.name)}" value="${esc(destPath)}">
                    <button type="button" class="primary" data-save>Save</button>
                    <button type="button" data-skip>Not now</button>
                </div>
                <div class="bad" data-error></div>
            </div>` : ''}`;
        el.hidden = false;
        el.querySelector('[data-backup]')?.addEventListener('click', run);
        el.querySelector('[data-choose]')?.addEventListener('click', async () => { if (await choose()) draw('', true); });
        el.querySelector('[data-where]')?.addEventListener('click', () => draw('', true));
        if (ask) {
            const input = el.querySelector('[data-path]');
            const save = async () => {
                const r = cleanPath(input.value, dest.name);
                if (r.error) { el.querySelector('[data-error]').textContent = r.error; input.focus(); return; }
                try {
                    await saveLog({ ...(await loadLog()), location: { folder: dest.name, path: r.path } }); // read fresh: keeps the log
                } catch (e) {
                    el.querySelector('[data-error]').textContent = `Couldn't save it in ${LOG_PATH}: ${e.message}`;
                    return;
                }
                draw('<span class="ok">✓ Location saved</span>');
            };
            el.querySelector('[data-save]').addEventListener('click', save);
            input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
            el.querySelector('[data-skip]').addEventListener('click', () => draw());
            input.focus();
        }
    }

    /** Pick the backup folder (not inside your data folder). The handle, null if cancelled, false if refused (says why). */
    async function choose() {
        let h;
        try { h = await window.showDirectoryPicker({ id: 'erik-backup', mode: 'readwrite', startIn: 'documents' }); } catch { return null; }
        if ((await fs.folder().resolve(h)) !== null) {
            draw('<span class="bad">That folder is inside your data folder (Dropbox). Pick one outside it, e.g. a new folder in Documents.</span>');
            return false;
        }
        await fs.rememberHandle(DEST_KEY, h);
        return h;
    }

    async function run() {
        if (busy) return;
        busy = true;
        const btn = el.querySelector('[data-backup]');
        btn.disabled = true;
        const show = text => { btn.textContent = text; };
        const stop = (message = '') => { busy = false; draw(message); };
        let dest = await fs.rememberedHandle(DEST_KEY);
        if (dest) {
            show('Checking the backup folder…');
            const permission = await fs.permissionOf(dest);
            // Chrome has been seen to never answer about a saved folder; picking it again saves a fresh one.
            if (permission === null) {
                return stop('<span class="bad">Chrome didn’t answer about your backup folder. Click <strong>Change backup folder…</strong> and pick it again.</span>');
            }
            // Chrome asks again after it restarts; a backup folder that was moved or deleted is chosen again.
            if ((permission !== 'granted' && (await dest.requestPermission({ mode: 'readwrite' })) !== 'granted') || await fs.isGone(dest)) dest = null;
        }
        const chosen = !dest;
        dest ||= await choose();
        if (dest === false) { busy = false; return; } // choose() said why
        if (!dest) return stop();
        show('Backing up…');
        try {
            const before = await loadLog().catch(() => ({ backups: [], location: null }));
            const path = pathOf(before.location, dest.name);
            const entry = { ...await backUp(fs.folder(), dest, (done, total, bytes) => show(`Backing up… ${done} of ${total} files (${mb(bytes)})`)), ...(path ? { path } : {}) };
            const log = await loadLog().catch(() => before);
            await saveLog({ ...log, backups: [...log.backups, entry] });
            busy = false;
            draw(`<span class="ok">✓ Backed up ${entry.files} files (${mb(entry.bytes)}) to ${path ? esc(`${path}\\${entry.folder}`) : `“${esc(entry.to)}” › ${esc(entry.folder)}`}</span>`,
                chosen && !path);
        } catch (e) {
            busy = false;
            console.error(e);
            draw(`<span class="bad">The backup didn't finish: ${esc(e.message)}. Any new “ErikLifeApp backup …” folder it started in “${esc(dest.name)}” is incomplete; you can delete it.</span>`);
        }
    }

    return { refresh: () => (busy ? null : draw()) };
}
