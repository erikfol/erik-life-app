// Working Career: Profile, Work History, Skills, Education, Achievements, References, Job Search and Resume Builder
// (#profile, #work, …, #resume; see PAGES in career.js). Uses the same folder as Bills Etc (the browser remembers it for
// the whole site); the data lives in inputs/career/.
import { esc } from '../../shared/js/util.js';
import { startSection, markActive } from '../../shared/js/section.js';
import { PAGES, CAREER_DIR } from './career.js';
import { renderPage, hasUnsavedEdits, forget } from './views/page.js';
import { renderResume, hasDraft } from './views/resume.js';

const viewEl = document.getElementById('view');
document.getElementById('nav').innerHTML = PAGES.map(p => `<a href="#${p.id}">${esc(p.label)}</a>`).join('');
const showPage = (hash, page) => {
    const p = PAGES.find(x => '#' + x.id === hash) || PAGES[0];
    page.show('#' + p.id);
    markActive('#' + p.id);
    return p;
};

startSection({
    what: 'Your career information', where: `${CAREER_DIR}/`, hasUnsavedEdits, forget,
    leaveWarning: () => hasUnsavedEdits() || hasDraft(),
    noFolder: showPage,
    async draw(hash, page) {
        const p = showPage(hash, page);
        if (p.id === 'resume') await renderResume(viewEl); // keeps its draft while you visit other pages
        else await renderPage(viewEl, p);
    },
});
