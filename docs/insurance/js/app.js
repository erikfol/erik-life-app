// Insurance: one page per policy (#<id>) plus "＋ Add policy" (#new); the menu is built from insurance.json.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/insurance/.
import { esc } from '../../shared/js/util.js';
import { startSection } from '../../shared/js/section.js';
import { loadPolicies } from './insurance.js';
import { renderPolicy, renderNewPolicy, hasUnsavedEdits, forget } from './views/policy.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');

function drawNav(list, active) {
    navEl.innerHTML = list.map(x => `<a href="#${esc(x.id)}"${x.id === active ? ' class="active"' : ''}>${esc(x.name)}</a>`).join('')
        + `<a href="#new"${active === 'new' ? ' class="active"' : ''}>＋ Add policy</a>`;
}

startSection({
    what: 'Insurance records', where: 'inputs/insurance/', hasUnsavedEdits, forget,
    noFolder: () => { navEl.innerHTML = ''; },
    async draw(hash, page) {
        const list = await loadPolicies();
        const want = hash.slice(1);
        const p = list.find(x => x.id === want) || (want === 'new' ? null : list[0]);
        page.show('#' + (p ? p.id : 'new'));
        drawNav(list, p ? p.id : 'new');
        if (p) await renderPolicy(viewEl, list, p, page.go); // page.go: after a policy is added, renamed or removed
        else renderNewPolicy(viewEl, list, page.go);
    },
});
