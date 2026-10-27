// Folder connection for the Home-page sections (Health, Vehicles). They use the same folder as Bills Etc: the
// browser remembers it for the whole site, so it's usually already connected.
import * as fs from '../../bills-etc/js/fs.js';
import * as dbx from './dropbox.js';
import { esc, toast } from '../../bills-etc/js/util.js';

export function refreshStatus() {
    const f = document.getElementById('st-folder');
    const root = fs.folder();
    f.textContent = root ? `📁 ${root.name}` : 'No folder';
    f.className = 'pill ' + (root ? 'ok' : 'bad');
}

/**
 * Shown until a folder is connected: reconnect the remembered one, choose one, or (on a tablet or phone, which can't
 * open a folder) sign in with Dropbox. `where` is e.g. 'inputs/health/'.
 */
export async function askForFolder(el, { what, where, onConnected }) {
    const rem = await fs.rememberedFolder().catch(() => null);
    const moved = rem?.moved;
    const local = fs.isSupported();
    el.innerHTML = `
        <section>
            <h2>Connect your folder</h2>
            ${moved ? `<div class="banner bad" style="margin-bottom:12px">${esc(fs.movedMessage(rem.handle))} Choose it again where it is now.</div>` : ''}
            <p>${esc(what)} are saved in <code>${esc(where)}</code> inside your <code>erik-life-app</code> folder
            (the same folder Bills Etc uses). <code>inputs/</code> is never put on GitHub.</p>
            ${local ? '' : `<div class="banner" style="margin-top:12px">This device can’t open a folder. Sign in with Dropbox to use your files from your Dropbox (<code>${esc(dbx.FOLDER_LABEL)}</code>).</div>`}
            <div class="row" style="margin-top:12px">
                ${rem && !moved ? `<button class="primary" id="reconnect">Reconnect “${esc(rem.handle.name)}”</button>` : ''}
                ${local ? `<button ${rem && !moved ? '' : 'class="primary"'} id="choose">Choose folder…</button>` : ''}
                <button ${local ? '' : 'class="primary"'} id="dropbox">Sign in with Dropbox</button>
            </div>
        </section>`;
    el.querySelector('#dropbox').addEventListener('click', () => fs.useDropbox().catch(e => toast(e.message, 'bad')));
    el.querySelector('#reconnect')?.addEventListener('click', async () => {
        if (await fs.reconnect(rem.handle)) { refreshStatus(); onConnected(); }
        else askForFolder(el, { what, where, onConnected }); // says so if the folder turned out to be moved
    });
    el.querySelector('#choose')?.addEventListener('click', async () => {
        try { await fs.pickFolder(); } catch { return; } // picker cancelled
        refreshStatus();
        onConnected();
    });
}
