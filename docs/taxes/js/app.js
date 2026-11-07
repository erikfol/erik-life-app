// Taxes: the Overview (#overview: where this season's return stands, the information and websites, each year's
// return) and a Documents page per tax year (#documents/<year>, #documents/add). Uses the same folder as Bills Etc (the
// browser remembers it for the whole site); the data lives in inputs/taxes/. Overview in the menu is red or yellow while
// its banner is.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { colourMenus } from '../../shared/js/navcolors.js';
import alerts from './alerts.js';
import { loadData } from './taxes.js';
import * as overview from './views/overview.js';
import * as documents from './views/documents.js';

const viewEl = document.getElementById('view');
let currentHash = null;
const menus = colourMenus(alerts);

const hasUnsavedEdits = () => overview.hasUnsavedEdits() || documents.hasUnsavedEdits();

/** After a year is added or removed: open #goTo. */
function listChanged(goTo) {
    if (location.hash === '#' + goTo) route(true);
    else { currentHash = '#' + goTo; location.hash = goTo; } // hashchange routes; nothing unsaved to ask about
}

async function route(force = false) {
    const hash = location.hash;
    if (!force && hash !== currentHash && hasUnsavedEdits()) {
        if (!confirm('You have unsaved edits. Leave without saving?')) {
            history.replaceState(null, '', currentHash);
            return;
        }
    }
    overview.forget();
    documents.forget();
    if (!fs.folder()) return askForFolder(viewEl, { what: 'tax records', where: 'inputs/taxes/', onConnected: () => route(true) });
    menus.ready();
    try {
        const [page, sub] = hash.slice(1).split('/');
        if (page === 'documents') {
            const data = await loadData();
            const year = sub === 'add' ? 'add' : data.years.includes(sub) ? sub : documents.defaultYear(data.years);
            currentHash = `#documents/${year}`;
            if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
            setActive('#documents');
            if (year === 'add') documents.renderAddYear(viewEl, data, listChanged);
            else await documents.renderDocuments(viewEl, data, year, listChanged);
        } else {
            currentHash = '#overview';
            if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
            setActive('#overview');
            await overview.renderOverview(viewEl);
        }
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}
const setActive = href => document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === href));

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', e => {
    if (hasUnsavedEdits()) { e.preventDefault(); e.returnValue = ''; }
});

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
