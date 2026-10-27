// Gifts, Bday, Anniversary: one page per person (#<id>), the Christmas lists (#christmas/<year>, #christmas/add) and
// "＋ Add person" (#new); the menu is built from gifts.json. Uses the same folder as Bills Etc (the browser remembers
// it for the whole site); the data lives in inputs/gifts/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { loadData, comingChristmas } from './gifts.js';
import * as person from './views/person.js';
import * as xmas from './views/christmas.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
let currentHash = null;

const hasUnsavedEdits = () => person.hasUnsavedEdits() || xmas.hasUnsavedEdits();

function drawNav(people, active) {
    const link = (id, label) => `<a href="#${esc(id)}"${id === active ? ' class="active"' : ''}>${esc(label)}</a>`;
    navEl.innerHTML = people.map(p => link(p.id, p.name)).join('') + link('christmas', 'Christmas') + link('new', '＋ Add person');
}

/** After a person or year is added, renamed or removed: re-read gifts.json and open #goTo. */
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
    person.forget();
    xmas.forget();
    if (!fs.folder()) {
        navEl.innerHTML = '';
        return askForFolder(viewEl, { what: 'Gifts, birthdays and anniversaries', where: 'inputs/gifts/', onConnected: () => route(true) });
    }
    try {
        const data = await loadData();
        const [want, sub] = hash.slice(1).split('/');
        const p = data.people.find(x => x.id === want);
        const page = p ? p.id : want === 'new' ? 'new' : want === 'christmas' || !data.people.length ? 'christmas' : data.people[0].id;
        let year = null;
        if (page === 'christmas') year = data.christmasYears.includes(sub) ? sub : sub === 'add' ? 'add' : xmas.defaultYear(data.christmasYears, comingChristmas()) || 'add';
        currentHash = '#' + (year ? `christmas/${year}` : page);
        if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
        drawNav(data.people, page);
        const target = data.people.find(x => x.id === page);
        if (target) await person.renderPerson(viewEl, data, target, listChanged);
        else if (page === 'new') person.renderNewPerson(viewEl, data, listChanged);
        else if (year === 'add') xmas.renderAddYear(viewEl, data, listChanged);
        else await xmas.renderChristmas(viewEl, data, year, listChanged);
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
