// The Home page (docs/index.html): a red and a yellow count on each section's card — how many red and yellow banners
// its pages show right now (point at one to see what they are) — and, on a tablet or phone, Dropbox sign-in. Each
// section's rules are in its own alerts.js, which its pages use for their banners too, so the counts always agree.
import * as dbx from './dropbox.js';
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';

// The sections that have red / yellow banners (the others have none), by their folder.
const ALERTS = {
    'bills-etc': () => import('../../bills-etc/js/alerts.js'),
    health: () => import('../../health/js/alerts.js'),
    house: () => import('../../house/js/alerts.js'),
    pets: () => import('../../pets/js/alerts.js'),
    gifts: () => import('../../gifts/js/alerts.js'),
};

const slot = id => document.querySelector(`.app[href="${id}/"] .alerts`);
const clearCounts = () => Object.keys(ALERTS).forEach(id => { slot(id).innerHTML = ''; });

/** '2 red:\n• …\n• …' */
const listText = (n, colour, items) => `${n} ${colour}:\n${items.map(x => `• ${x.text}`).join('\n')}`;
const count = (colour, items) => (items.length
    ? `<span class="count ${colour}" title="${esc(listText(items.length, colour, items))}" aria-label="${esc(listText(items.length, colour, items))}">${items.length}</span>` : '');

async function countAll() {
    await Promise.all(Object.entries(ALERTS).map(async ([id, load]) => {
        const el = slot(id);
        try {
            const items = await (await load()).default();
            el.innerHTML = count('red', items.filter(x => x.level === 'red')) + count('yellow', items.filter(x => x.level === 'yellow'));
        } catch (e) {
            console.error(id, e);
            el.innerHTML = `<span class="count error" title="${esc(`Couldn't check: ${e.message}`)}">?</span>`;
        }
    }));
}

// ── The folder (this computer) or Dropbox (a tablet or phone) the counts are read from ──
const note = document.getElementById('alerts-note');

async function connect() {
    note.hidden = true;
    if (fs.folder()) return countAll(); // signed in to Dropbox on this device
    if (!fs.isSupported()) return; // a tablet or phone: sign in with Dropbox below first
    const rem = await fs.rememberedFolder().catch(() => null);
    if (fs.folder()) return countAll();
    // After Chrome restarts it asks once before the folder can be read again (needs a click).
    note.innerHTML = rem && !rem.moved
        ? `To show the red and yellow counts, allow your folder again: <button type="button" class="primary">Reconnect “${esc(rem.handle.name)}”</button>`
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
window.addEventListener('pageshow', e => { if (e.persisted && fs.folder()) countAll(); });
