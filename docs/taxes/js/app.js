// Taxes: the Overview (#overview: where this season's return stands, the information and websites, each year's
// return) and a Documents page per tax year (#documents/<year>, #documents/add). Uses the same folder as Bills Etc (the
// browser remembers it for the whole site); the data lives in inputs/taxes/. Overview in the menu is red or yellow while
// its banner is.
import { startSection, markActive } from '../../shared/js/section.js';
import alerts from './alerts.js';
import { loadData } from './taxes.js';
import * as overview from './views/overview.js';
import * as documents from './views/documents.js';

const viewEl = document.getElementById('view');

startSection({
    what: 'tax records', where: 'inputs/taxes/', alerts,
    hasUnsavedEdits: () => overview.hasUnsavedEdits() || documents.hasUnsavedEdits(),
    forget: () => { overview.forget(); documents.forget(); },
    async draw(hash, page) {
        const [name, sub] = hash.slice(1).split('/');
        if (name === 'documents') {
            const data = await loadData();
            const year = sub === 'add' ? 'add' : data.years.includes(sub) ? sub : documents.defaultYear(data.years);
            page.show(`#documents/${year}`);
            markActive('#documents');
            if (year === 'add') documents.renderAddYear(viewEl, data, page.go); // page.go: after a year is added or removed
            else await documents.renderDocuments(viewEl, data, year, page.go);
        } else {
            page.show('#overview');
            markActive('#overview');
            await overview.renderOverview(viewEl);
        }
    },
});
