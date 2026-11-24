// The Home page (docs/index.html): a red and a yellow count on each section's card — how many red and yellow banners
// its pages show right now (point at one to see what they are) — the Backup line (backup.js), and, on a tablet or
// phone, Dropbox sign-in. Each
// section's rules are in its own alerts.js, which its pages use for their banners too, so the counts always agree.
import * as dbx from './dropbox.js';
import * as fs from './fs.js';
import { esc } from './util.js';
import { backupPanel } from './backup.js';
import { assistantPanel } from './assistant/panel.js';

// The sections that have red / yellow banners (the others have none), by their folder.
const ALERTS = {
    'bills-etc': () => import('../../bills-etc/js/alerts.js'),
    '401k': () => import('../../401k/js/alerts.js'),
    taxes: () => import('../../taxes/js/alerts.js'),
    health: () => import('../../health/js/alerts.js'),
    vehicles: () => import('../../vehicles/js/alerts.js'),
    house: () => import('../../house/js/alerts.js'),
    pets: () => import('../../pets/js/alerts.js'),
    gifts: () => import('../../gifts/js/alerts.js'),
    'dinner-planner': () => import('../../dinner-planner/js/alerts.js'),
};

const slot = id => document.querySelector(`.app[href="${id}/"] .alerts`);
// The counts from the last time in this tab are shown at once (faded) while they're counted again, which on a tablet
// takes a while: every file is a Dropbox download.
const SAVED = 'home-counts';
const saveCounts = () => {
    try { sessionStorage.setItem(SAVED, JSON.stringify(Object.fromEntries(Object.keys(ALERTS).map(id => [id, slot(id).innerHTML])))); } catch { /* not kept; fine */ }
};
const showSaved = () => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SAVED)); } catch { /* none */ }
    for (const [id, html] of Object.entries(saved || {})) {
        if (!ALERTS[id] || slot(id).innerHTML) continue;
        slot(id).innerHTML = html;
        slot(id).classList.add('old');
    }
};
const clearCounts = () => {
    Object.keys(ALERTS).forEach(id => { slot(id).innerHTML = ''; slot(id).classList.remove('old'); });
    try { sessionStorage.removeItem(SAVED); } catch { /* fine */ }
};

/** '2 red:\n• …\n• …' */
const listText = (n, colour, items) => `${n} ${colour}:\n${items.map(x => `• ${x.text}`).join('\n')}`;
const count = (colour, items) => (items.length
    ? `<span class="count ${colour}" title="${esc(listText(items.length, colour, items))}" aria-label="${esc(listText(items.length, colour, items))}">${items.length}</span>` : '');

async function countAll() {
    showSaved();
    await fs.shareReads(() => Promise.all(Object.entries(ALERTS).map(async ([id, load]) => {
        const el = slot(id);
        try {
            const items = await (await load()).default();
            el.innerHTML = count('red', items.filter(x => x.level === 'red')) + count('yellow', items.filter(x => x.level === 'yellow'));
        } catch (e) {
            console.error(id, e);
            el.innerHTML = `<span class="count error" title="${esc(`Couldn't check: ${e.message}`)}">?</span>`;
        }
        el.classList.remove('old');
    })));
    saveCounts();
}

// ── The folder (this computer) or Dropbox (a tablet or phone) the counts and the backup line are read from ──
const note = document.getElementById('alerts-note');
const backup = backupPanel(document.getElementById('backup'));
const assistant = assistantPanel(document.getElementById('assistant'), ALERTS);
const connected = () => { backup.refresh(); assistant.refresh(); return countAll(); };

async function connect() {
    note.hidden = true;
    if (fs.folder()) return connected(); // signed in to Dropbox on this device
    backup.refresh();
    assistant.refresh();
    if (!fs.isSupported()) return; // a tablet or phone: sign in with Dropbox below first
    const rem = await fs.rememberedFolder().catch(() => null);
    if (fs.folder()) return connected();
    // After Chrome restarts it asks once before the folder can be read again (needs a click).
    note.innerHTML = rem && !rem.moved
        ? `To show the red and yellow counts, allow your folder again: <button type="button" class="primary">Reconnect “${esc(rem.handle.name)}”</button>`
        : fs.folderStuck()
            ? `Chrome didn’t answer about your saved folder. Choose it again (<code>Dropbox\\Apps\\ErikLifeApp</code>): <button type="button" class="primary">Choose folder…</button>`
            : `${rem?.moved ? `${esc(fs.movedMessage(rem.handle))} ` : ''}To show the red and yellow counts, choose your <code>erik-life-app</code> folder: <button type="button" class="primary">Choose folder…</button>`;
    note.hidden = false;
    note.querySelector('button').onclick = async () => {
        if (rem && !rem.moved) { if (!(await fs.reconnect(rem.handle))) return connect(); } // says so if it was moved
        else { try { await fs.pickFolder(); } catch { return; } } // picker cancelled
        connect();
    };
}

// ── Dropbox: on a tablet or phone (no local folders) the sections use your Dropbox: sign in here, or sign out ──
const dropboxEl = document.getElementById('dropbox');
const drawDropbox = () => {
    if (dbx.signedIn()) {
        dropboxEl.innerHTML = `Dropbox: signed in on this device (${dbx.FOLDER_LABEL}). <button type="button">Sign out</button>`;
        dropboxEl.querySelector('button').onclick = async () => { await fs.leaveDropbox(); clearCounts(); drawDropbox(); connect(); };
    } else if (!fs.isSupported()) {
        dropboxEl.innerHTML = 'This device can’t open a folder, so the sections use your Dropbox. <button type="button" class="primary">Sign in with Dropbox</button>';
        dropboxEl.querySelector('button').onclick = () => dbx.signIn().catch(e => { dropboxEl.textContent = e.message; });
    } else {
        dropboxEl.hidden = true;
        return;
    }
    dropboxEl.hidden = false;
};
drawDropbox();
connect();
// Back from a section (the browser may show this page as it was): count again, since something may have changed.
window.addEventListener('pageshow', e => { if (e.persisted && fs.folder()) connected(); });
