// Pets: one page per pet (#<id>) plus "＋ Add pet" (#new); the menu is built from pets.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/pets/.
import { esc } from '../../shared/js/util.js';
import { startSection } from '../../shared/js/section.js';
import { loadPets } from './pets.js';
import alerts from './alerts.js';
import { renderPet, renderNewPet, hasUnsavedEdits, forget } from './views/pet.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');

function drawNav(list, active) {
    navEl.innerHTML = list.map(x => `<a href="#${esc(x.id)}"${x.id === active ? ' class="active"' : ''}>${esc(x.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add pet</a>`;
}

startSection({
    what: 'Pet records', where: 'inputs/pets/', alerts, hasUnsavedEdits, forget,
    noFolder: () => { navEl.innerHTML = ''; },
    async draw(hash, page) {
        const list = await loadPets();
        const want = hash.slice(1);
        const p = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        page.show('#' + (p ? p.id : 'new'));
        drawNav(list, p ? p.id : 'new');
        if (p) await renderPet(viewEl, list, p, page.go); // page.go: after a pet is added, renamed or removed
        else renderNewPet(viewEl, list, page.go);
    },
});
