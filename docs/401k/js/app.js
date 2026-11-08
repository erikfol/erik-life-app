// 401(k): the Overview (#overview: balance, contributions against the IRS limit, the balance over time and its
// history) and Plan & investments (#plan). Uses the same folder as Bills Etc (the browser remembers it for the whole
// site); the data lives in inputs/401k/. A name in the menu is red or yellow while its page has a red or yellow banner.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import alerts from './alerts.js';
import { colourMenus } from '../../shared/js/navcolors.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import * as overview from './views/overview.js';
import * as plan from './views/plan.js';

const PAGES = { '#overview': () => overview.renderOverview(viewEl), '#plan': () => plan.renderPlan(viewEl) };
const viewEl = document.getElementById('view');
let currentHash = null;
const menus = colourMenus(alerts);

const hasUnsavedEdits = () => overview.hasUnsavedEdits() || plan.hasUnsavedEdits();

async function route(force = false) {
    const hash = PAGES[location.hash] ? location.hash : '#overview';
    if (!force && hash !== currentHash && hasUnsavedEdits()) {
        if (!confirm('You have unsaved edits. Leave without saving?')) {
            history.replaceState(null, '', currentHash);
            return;
        }
    }
    currentHash = hash;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    overview.forget();
    plan.forget();
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
    if (!fs.folder()) return askForFolder(viewEl, { what: '401(k) records', where: 'inputs/401k/', onConnected: () => route(true) });
    menus.ready();
    try {
        await PAGES[hash]();
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', e => {
    if (hasUnsavedEdits()) { e.preventDefault(); e.returnValue = ''; }
});

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
