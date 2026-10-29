// Health: General Health / Dental / Eye / HSA pages (#general, #dental, #eye, #hsa). Uses the same folder as Bills Etc
// (the browser remembers it for the whole site); the records live in inputs/health/. General Health, Dental and Eye also
// have future appointments. A name in the menu is red or yellow while its page has a red or yellow banner.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { SECTIONS } from './records.js';
import alerts from './alerts.js';
import { colourMenus } from '../../shared/js/navcolors.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { setupPhoneCopy } from '../../shared/js/phonecopy.js';
import { renderSection, hasUnsavedEdits, forget } from './views/section.js';

const viewEl = document.getElementById('view');
let currentHash = null;
// Menu links (and tabs / pills) turn red or yellow while that page has a red or yellow banner.
const menus = colourMenus(alerts);

async function route(force = false) {
    const hash = location.hash || '#general';
    if (!force && hash !== currentHash && hasUnsavedEdits()) {
        if (!confirm('You have unsaved edits. Leave without saving?')) {
            history.replaceState(null, '', currentHash);
            return;
        }
    }
    const section = SECTIONS.find(s => '#' + s.id === hash) || SECTIONS[0];
    currentHash = '#' + section.id;
    forget();
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === currentHash));
    if (!fs.folder()) return askForFolder(viewEl, { what: 'Health records', where: 'inputs/health/', onConnected: () => route(true) });
    menus.ready();
    try {
        await renderSection(viewEl, section);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', e => {
    if (hasUnsavedEdits()) { e.preventDefault(); e.returnValue = ''; }
});

setupPhoneCopy(document.getElementById('phone-copy'));

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
