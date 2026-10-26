// Working Career: Profile, Work History, Skills, Education, Achievements, References, Job Search and Resume Builder
// (#profile, #work, …, #resume; see PAGES in career.js). Uses the same folder as Bills Etc (the browser remembers it for
// the whole site); the data lives in inputs/career/.
import * as fs from '../../bills-etc/js/fs.js';
import { esc } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import { PAGES, CAREER_DIR } from './career.js';
import { renderPage, hasUnsavedEdits, forget } from './views/page.js';
import { renderResume, hasDraft } from './views/resume.js';

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
let currentHash = null;

navEl.innerHTML = PAGES.map(p => `<a href="#${p.id}">${esc(p.label)}</a>`).join('');

async function route(force = false) {
    const hash = location.hash || '#' + PAGES[0].id;
    if (!force && hash !== currentHash && hasUnsavedEdits()) {
        if (!confirm('You have unsaved edits. Leave without saving?')) {
            history.replaceState(null, '', currentHash);
            return;
        }
    }
    const page = PAGES.find(p => '#' + p.id === hash) || PAGES[0];
    currentHash = '#' + page.id;
    if (location.hash !== currentHash) history.replaceState(null, '', currentHash);
    forget();
    navEl.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === currentHash));
    if (!fs.folder()) return askForFolder(viewEl, { what: 'Your career information', where: `${CAREER_DIR}/`, onConnected: () => route(true) });
    try {
        if (page.id === 'resume') await renderResume(viewEl); // keeps its draft while you visit other pages
        else await renderPage(viewEl, page);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
    }
}

window.addEventListener('hashchange', () => route());
window.addEventListener('beforeunload', e => {
    if (hasUnsavedEdits() || hasDraft()) { e.preventDefault(); e.returnValue = ''; }
});

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    route();
})();
