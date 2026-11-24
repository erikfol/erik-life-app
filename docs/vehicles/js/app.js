// Vehicles: one page per vehicle (#<id>, its Guides and Notes tabs #<id>/guides, #<id>/notes) plus "＋ Add vehicle" (#new); the menu is
// built from vehicles.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/vehicles/.
import { esc } from '../../shared/js/util.js';
import { startSection } from '../../shared/js/section.js';
import { loadVehicles } from './vehicles.js';
import alerts from './alerts.js';
import { renderVehicle, renderNewVehicle, hasUnsavedEdits, forget } from './views/vehicle.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');

function drawNav(list, active) {
    navEl.innerHTML = list.map(x => `<a href="#${esc(x.id)}"${x.id === active ? ' class="active"' : ''}>${esc(x.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add vehicle</a>`;
}

startSection({
    what: 'Vehicle records', where: 'inputs/vehicles/', alerts, hasUnsavedEdits, forget,
    noFolder: () => { navEl.innerHTML = ''; },
    async draw(hash, page) {
        const list = await loadVehicles();
        const [want, part] = hash.slice(1).split('/');
        const v = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        const sub = v && v.id === want && ['guides', 'notes'].includes(part) ? part : '';
        page.show('#' + (v ? v.id : 'new') + (sub ? '/' + sub : ''));
        drawNav(list, v ? v.id : 'new');
        if (v) await renderVehicle(viewEl, list, v, page.go, sub); // page.go: after a vehicle is added, renamed or removed
        else renderNewVehicle(viewEl, list, page.go);
    },
});
