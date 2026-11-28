// Forgettable Subs page: subscriptions that are easy to forget about, in one table that's read-only (sort and filter on
// every column) until Edit, then every cell can be changed and rows added or removed. Saved in its own CSV.
import { tableRows, tableCSV } from '../../../shared/js/csv.js';
import { esc } from '../../../shared/js/util.js';
import { requireFolder } from '../app.js';
import { readTracked, writeTracked } from '../../../shared/js/fileguard.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';

export const SUBS_PATH = 'inputs/forgettable_subs/forgettable_subs.csv';

const COLUMNS = [
    { name: 'Date Started', kind: 'date' },
    { name: 'Date Ending', kind: 'end' }, // blank = still going
    { name: 'Company', kind: 'suggest' },
    { name: 'Description', kind: 'text' },
    { name: 'URL', kind: 'link' },
    { name: 'Initial Cost', kind: 'money' },
    { name: 'Renew Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];
const NAMES = COLUMNS.map(c => c.name);

let table = null;

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading…</p>';
        const text = await readTracked(SUBS_PATH);
        const rows = text === null ? [] : tableRows(text, NAMES);
        el.innerHTML = `
            <h1 class="page">Forgettable Subs</h1>
            <p class="lead">Saved in <code>${esc(SUBS_PATH)}</code> in your folder.</p>
            <section id="subs"></section>`;
        table = recordTable(el.querySelector('#subs'), {
            columns: COLUMNS,
            columnsId: 'bills-etc/forgettable-subs',
            rows,
            save: rows => writeTracked(SUBS_PATH, tableCSV(NAMES, rows)),
        });
    },

    canLeave(unloading) {
        if (!table?.hasUnsavedEdits()) return true;
        if (unloading) return false;
        return confirm('You have unsaved edits. Leave without saving?');
    },

    destroy() {
        table = null;
        closeFilterMenu();
    },
};
