// House: one page per house (#<id>, its tabs #<id>/financing, /heating etc.; a tab's pills #<id>/heating/mini-split
// etc., its first pill being #<id>/heating; a project's page #<id>/projects/<project id>; the Maintenance tab #<id>/maintenance)
// plus "＋ Add house" (#new); the menu is built from house.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/house/.
import { esc } from '../../shared/js/util.js';
import { startSection } from '../../shared/js/section.js';
import { loadHouses, AREAS, houseProjects } from './house.js';
import alerts from './alerts.js';
import { renderHouse, renderNewHouse, hasUnsavedEdits, forget } from './views/house.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');

function drawNav(list, active) {
    navEl.innerHTML = list.map(x => `<a href="#${esc(x.id)}"${x.id === active ? ' class="active"' : ''}>${esc(x.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add house</a>`;
}

startSection({
    what: 'House records', where: 'inputs/house/', alerts, hasUnsavedEdits, forget,
    noFolder: () => { navEl.innerHTML = ''; },
    async draw(hash, page) {
        const list = await loadHouses();
        const [want, part, sub] = hash.slice(1).split('/');
        const h = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        const tab = h && h.id === want ? AREAS.find(a => a.id === part) : null;
        const pill = tab?.parts ? tab.parts.find(p => p.id === sub) || tab.parts[0] : tab;
        const project = pill?.projects ? houseProjects(h).find(p => p.id === sub) : null;
        page.show('#' + (h ? h.id : 'new') + (tab ? '/' + tab.id : '') + (pill && pill !== tab && pill !== tab.parts[0] ? '/' + pill.id : '')
            + (project ? '/' + project.id : ''));
        drawNav(list, h ? h.id : 'new');
        if (h) await renderHouse(viewEl, list, h, page.go, tab, pill, project); // page.go: after a house is added, renamed or removed
        else renderNewHouse(viewEl, list, page.go);
    },
});
