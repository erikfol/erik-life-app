// 401(k): the Overview (#overview: balance, contributions against the IRS limit, the balance over time and its
// history) and Plan & investments (#plan). Uses the same folder as Bills Etc (the browser remembers it for the whole
// site); the data lives in inputs/401k/. A name in the menu is red or yellow while its page has a red or yellow banner.
import { startSection, markActive } from '../../shared/js/section.js';
import alerts from './alerts.js';
import * as overview from './views/overview.js';
import * as plan from './views/plan.js';

const viewEl = document.getElementById('view');
const PAGES = { '#overview': () => overview.renderOverview(viewEl), '#plan': () => plan.renderPlan(viewEl) };
const pageOf = hash => (PAGES[hash] ? hash : '#overview');
const showPage = (hash, page) => {
    const h = pageOf(hash);
    page.show(h);
    markActive(h);
    return h;
};

startSection({
    what: '401(k) records', where: 'inputs/401k/', alerts,
    hasUnsavedEdits: () => overview.hasUnsavedEdits() || plan.hasUnsavedEdits(),
    forget: () => { overview.forget(); plan.forget(); },
    noFolder: showPage,
    draw: (hash, page) => PAGES[showPage(hash, page)](),
});
