// A Working Career page: the Profile (an information box, like a pet's) or one or more record tables (Work History,
// Skills, Education…), each read-only with sort and filter until ✎ Edit.
import { esc } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { PROFILE_PATH, TABLES, tablePath, loadTable, saveTable, loadProfile, saveProfile } from '../career.js';

let checks = []; // one "has unsaved edits?" per table or box on the page

export const hasUnsavedEdits = () => checks.some(f => f());
export const forget = () => { checks = []; closeFilterMenu(); };

export async function renderPage(el, page) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    if (page.id === 'profile') return renderProfile(el, page);
    const tables = page.tables;
    const rows = await Promise.all(tables.map(([id]) => loadTable(id)));
    const files = tables.map(([id]) => `<code>${esc(tablePath(id))}</code>`).join(' and ');
    el.innerHTML = `
        <h1 class="page">${esc(page.label)}</h1>
        <p class="lead">${page.lead ? `${esc(page.lead)} ` : ''}Saved in ${files} in your folder.</p>
        ${tables.map(([id, title]) => (title ? `<section><h2>${esc(title)}</h2><div data-table="${id}"></div></section>`
            : `<section data-table="${id}"></section>`)).join('')}`;
    tables.forEach(([id], i) => {
        const table = recordTable(el.querySelector(`[data-table="${id}"]`), {
            columns: TABLES[id].columns,
            rows: rows[i],
            save: r => saveTable(id, r),
        });
        checks.push(() => table.hasUnsavedEdits());
    });
}

async function renderProfile(el, page) {
    const info = await loadProfile();
    el.innerHTML = `
        <h1 class="page">${esc(page.label)}</h1>
        <p class="lead">${esc(page.lead)} Saved in <code>${esc(PROFILE_PATH)}</code> in your folder.</p>
        <section><h2>Contact &amp; summary</h2><div id="profile"></div></section>`;
    const box = infoBox(el.querySelector('#profile'), { info, save: saveProfile });
    checks.push(() => box.hasUnsavedEdits());
}
