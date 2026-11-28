// Each record table's own columns, changed with its ⚙ Columns button (shared/js/recordtable.js): their order, the
// names shown, the ones taken off the table, and ones added on the page. Kept in inputs/table_columns.json:
//   { tables: { [table id]: { columns: [{ name, label?, hidden?, added?, kind? }] } } }
// name is the column's name in the table's file (it never changes: features like totals and alerts read it); label is
// the name shown, when it's been renamed. A column taken off (hidden) keeps what's typed in it in the file, so putting
// it back brings it all back. A table repeated on several pages (each pet's Records) has one id, so one set of columns.
import * as fs from './fs.js';

export const COLUMNS_PATH = 'inputs/table_columns.json';

/** The kinds a column added on the page can be (recordTable column kinds), as offered in ⚙ Columns. */
export const ADDED_KINDS = {
    text: 'Text',
    suggest: 'Short text (offers what was typed before)',
    number: 'Number',
    money: 'Money (with a Total)',
    date: 'Date',
    link: 'Web link',
};

/** How ⚙ Columns describes the page's own columns (their kind can't change: the page counts on it). */
export const KIND_NAMES = {
    date: 'Date', end: 'End date (blank = ongoing)', number: 'Number', money: 'Money', choice: 'Dropdown',
    suggest: 'Short text', text: 'Text', link: 'Web link', files: 'Files',
};

let reading = null; // one read shared by the tables a page draws at the same time

/** Every table's saved columns: { [table id]: { columns } } ({} before any are saved). */
export function loadLayouts() {
    reading ??= fs.readText(COLUMNS_PATH)
        .then(text => (text ? JSON.parse(text).tables || {} : {}))
        .finally(() => { reading = null; });
    return reading;
}

/** Save one table's columns (re-reading the file first, so other tables' columns saved since stay). */
export async function saveLayout(id, layout) {
    const text = await fs.readText(COLUMNS_PATH);
    const data = text ? JSON.parse(text) : {};
    data.tables = { ...data.tables, [id]: layout };
    await fs.writeText(COLUMNS_PATH, JSON.stringify(data, null, 2) + '\n');
}

/**
 * The table's columns as saved: the page's own columns (`base`) in the saved order, with their shown names, the ones
 * taken off marked `hidden`, and the ones added on the page (`added`). A column of the page's that the saved order
 * doesn't have (new since) goes after the column before it on the page.
 */
export function arrange(base, layout) {
    const own = new Map(base.map(c => [c.name, c]));
    const out = [];
    for (const s of layout?.columns || []) {
        const c = own.get(s.name);
        if (c) {
            out.push({ ...c, label: s.label || c.label, hidden: !!s.hidden });
            own.delete(s.name);
        } else if (s.added && s.name && !out.some(x => x.name === s.name)) {
            out.push({ name: s.name, kind: ADDED_KINDS[s.kind] ? s.kind : 'text', label: s.label, hidden: !!s.hidden, added: true });
        }
    }
    base.forEach((c, i) => {
        if (!own.has(c.name)) return;
        const before = i ? out.findIndex(x => x.name === base[i - 1].name) : -1;
        out.splice(before + 1, 0, c);
    });
    return out;
}
