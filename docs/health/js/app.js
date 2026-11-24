// Health: General Health / Dental / Eye / HSA pages (#general, #dental, #eye, #hsa). Uses the same folder as Bills Etc
// (the browser remembers it for the whole site); the records live in inputs/health/. General Health, Dental and Eye also
// have future appointments. A name in the menu is red or yellow while its page has a red or yellow banner.
import { startSection, markActive } from '../../shared/js/section.js';
import { SECTIONS } from './records.js';
import alerts from './alerts.js';
import { renderSection, hasUnsavedEdits, forget } from './views/section.js';

const viewEl = document.getElementById('view');
const sectionOf = hash => SECTIONS.find(s => '#' + s.id === hash) || SECTIONS[0];

startSection({
    what: 'Health records', where: 'inputs/health/', alerts, hasUnsavedEdits, forget,
    noFolder: hash => markActive('#' + sectionOf(hash).id),
    async draw(hash, page) {
        const section = sectionOf(hash);
        page.show('#' + section.id);
        markActive('#' + section.id);
        await renderSection(viewEl, section);
    },
});
