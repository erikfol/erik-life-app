// Gifts, Bday, Anniversary: one page per person (#<id>), the Christmas lists (#christmas/<year>, #christmas/add) and
// "＋ Add person" (#new); the menu is built from gifts.json. Uses the same folder as Bills Etc (the browser remembers
// it for the whole site); the data lives in inputs/gifts/.
import { esc } from '../../shared/js/util.js';
import { startSection } from '../../shared/js/section.js';
import { loadData, comingChristmas } from './gifts.js';
import alerts from './alerts.js';
import * as person from './views/person.js';
import * as xmas from './views/christmas.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');

function drawNav(people, active) {
    const link = (id, label) => `<a href="#${esc(id)}"${id === active ? ' class="active"' : ''}>${esc(label)}</a>`;
    navEl.innerHTML = people.map(p => link(p.id, p.name)).join('') + link('christmas', 'Christmas') + link('new', '＋ Add person');
}

startSection({
    what: 'Gifts, birthdays and anniversaries', where: 'inputs/gifts/', alerts,
    hasUnsavedEdits: () => person.hasUnsavedEdits() || xmas.hasUnsavedEdits(),
    forget: () => { person.forget(); xmas.forget(); },
    noFolder: () => { navEl.innerHTML = ''; },
    async draw(hash, page) {
        const data = await loadData();
        const [want, sub] = hash.slice(1).split('/');
        const p = data.people.find(x => x.id === want);
        const id = p ? p.id : want === 'new' ? 'new' : want === 'christmas' || !data.people.length ? 'christmas' : data.people[0].id;
        let year = null;
        if (id === 'christmas') year = data.christmasYears.includes(sub) ? sub : sub === 'add' ? 'add' : xmas.defaultYear(data.christmasYears, comingChristmas()) || 'add';
        page.show('#' + (year ? `christmas/${year}` : id));
        drawNav(data.people, id);
        // page.go: after a person or year is added, renamed or removed
        const target = data.people.find(x => x.id === id);
        if (target) await person.renderPerson(viewEl, data, target, page.go);
        else if (id === 'new') person.renderNewPerson(viewEl, data, page.go);
        else if (year === 'add') xmas.renderAddYear(viewEl, data, page.go);
        else await xmas.renderChristmas(viewEl, data, year, page.go);
    },
});
