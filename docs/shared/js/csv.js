// Minimal RFC 4180 CSV reader/writer. All cells stay strings so files round-trip unchanged.

/** Raw records (arrays of strings). `delim` is ',' for CSV or a tab for tab-separated exports. */
export function parseRecords(text, delim = ',') {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const records = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else if (c === '"' && field === '') inQuotes = true; // a quote mid-value (3/4") is just a character
        else if (c === delim) { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); records.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }
    return records.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

export function parseCSV(text) {
    const nonEmpty = parseRecords(text);
    if (!nonEmpty.length) return { columns: [], rows: [] };
    const columns = nonEmpty[0].map(h => h.trim());
    const rows = nonEmpty.slice(1).map(r => Object.fromEntries(columns.map((c, j) => [c, r[j] ?? ''])));
    return { columns, rows };
}

function escapeCell(v) {
    v = v == null ? '' : String(v);
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

export function toCSV(columns, rows) {
    const lines = [columns.map(escapeCell).join(',')];
    for (const r of rows) lines.push(columns.map(c => escapeCell(r[c])).join(','));
    return lines.join('\n') + '\n';
}

/**
 * A table's rows from its CSV text: each of `names` (blank when the file lacks it), then every other column the file
 * has (one added on the page with ⚙ Columns, or by hand), so saving with tableCSV keeps them.
 *   was:  { name: its old column name } reads a renamed column's old one (which then isn't kept as a column of its own)
 *   trim: trim every value
 */
export function tableRows(text, names, { was = {}, trim = false } = {}) {
    const { columns, rows } = parseCSV(text);
    const old = new Set(Object.values(was));
    const extra = columns.filter(c => c && !names.includes(c) && !old.has(c));
    const clean = v => (trim ? String(v ?? '').trim() : v ?? '');
    return rows.map(r => Object.fromEntries([
        ...names.map(c => [c, clean(r[c] ?? (was[c] ? r[was[c]] : undefined))]),
        ...extra.map(c => [c, clean(r[c])]),
    ]));
}

/** A table's CSV text: `names` first, then every other column its rows have (see tableRows). Keys starting with _ are a page's own, never saved. */
export function tableCSV(names, rows) {
    const extra = [];
    for (const r of rows) {
        for (const [k, v] of Object.entries(r)) {
            if (typeof v === 'string' && !k.startsWith('_') && !names.includes(k) && !extra.includes(k)) extra.push(k);
        }
    }
    return toCSV([...names, ...extra], rows);
}
