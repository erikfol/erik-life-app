// The lookups Claude can ask the Home page's assistant to run. They all run here, on data sources.js has already been
// through the privacy filter, and they can only read. Adding up is done here too, so totals are exact.
import { parseMoney } from '../../../bills-etc/js/sheet.js';
import { tidyCell } from './sources.js';

const MAX_CHARS = 24000; // the most any one lookup sends back
const MAX_ROWS = 200, DEFAULT_ROWS = 50;
const MAX_HITS = 40, HITS_PER_SOURCE = 15;
const MAX_GROUPS = 150;

const WHERE = {
    type: 'array',
    description: 'Only rows matching all of these. Dates are YYYY-MM-DD: for one month use contains "2026-10".',
    items: {
        type: 'object',
        properties: {
            column: { type: 'string' },
            op: { type: 'string', enum: ['contains', 'not_contains', 'equals', 'not_equals', '>', '>=', '<', '<=', 'is_blank', 'not_blank'] },
            value: { type: 'string', description: 'Not needed for is_blank and not_blank.' },
        },
        required: ['column', 'op'],
    },
};

export const TOOLS = [
    {
        name: 'search',
        description: 'Find rows anywhere in the app that mention some words. Use when you do not know which source holds something. Give a few keywords, not a sentence.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
        name: 'get_rows',
        description: 'Read rows from a table source, optionally filtered and sorted. For the latest entry, sort by its date column, descending, with limit 1.',
        input_schema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'A table id from the list of sources.' },
                where: WHERE,
                columns: { type: 'array', items: { type: 'string' }, description: 'Only these columns (default: all).' },
                sort_by: { type: 'string' },
                descending: { type: 'boolean' },
                limit: { type: 'integer', description: `Default ${DEFAULT_ROWS}, at most ${MAX_ROWS}.` },
                offset: { type: 'integer' },
            },
            required: ['source'],
        },
    },
    {
        name: 'calculate',
        description: 'Exact totals over a table source: sum, average, count, min or max of a column, optionally per value of another column and/or per month or year. Always use this rather than adding numbers yourself.',
        input_schema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'A table id from the list of sources.' },
                operation: { type: 'string', enum: ['sum', 'average', 'count', 'min', 'max'] },
                column: { type: 'string', description: 'The number column. Not needed for count.' },
                where: WHERE,
                group_by: { type: 'string', description: 'Give one result per value of this column.' },
                period: { type: 'string', enum: ['month', 'year'], description: 'Give one result per month or year.' },
                date_column: { type: 'string', description: 'The date column for period (default: the first date column).' },
            },
            required: ['source', 'operation'],
        },
    },
    {
        name: 'read_document',
        description: 'Read a document source (information pages, lists and plans kept as nested data). Without path you get all of it, or, if it is long, its parts and their sizes; then ask for one part, like path "houses[0].areas".',
        input_schema: {
            type: 'object',
            properties: { source: { type: 'string', description: 'A document id from the list of sources.' }, path: { type: 'string' } },
            required: ['source'],
        },
    },
];

/** What to show while a lookup runs. */
export function describeTool({ name, input }) {
    if (name === 'search') return 'Searching your data…';
    if (name === 'calculate') return 'Adding it up…';
    return `Looking at ${String(input?.source ?? 'your data').replace(/[-_/]/g, ' ')}…`;
}

const compact = row => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== '' && v != null));
const toNumber = v => (typeof v === 'number' ? v : parseMoney(v));
const round2 = n => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

function sourceOf(ctx, id, kind) {
    const s = ctx.sources.get(String(id ?? '').trim());
    if (!s) throw new Error(`There is no source "${id}". Use an id from the list of sources.`);
    if (s.error) throw new Error(`${s.id} could not be read: ${s.error}`);
    if (s.kind !== kind) throw new Error(`${s.id} is a ${s.kind}. Use ${s.kind === 'table' ? 'get_rows or calculate' : 'read_document'} for it.`);
    return s;
}

function columnOf(s, name) {
    const want = String(name ?? '').trim().toLowerCase();
    const c = s.columns.find(x => x.toLowerCase() === want);
    if (!c) throw new Error(`${s.id} has no column "${name}". Its columns are: ${s.columns.join(', ')}`);
    return c;
}

function matches(cell, op, value) {
    const text = String(cell ?? '').trim().toLowerCase();
    if (op === 'is_blank') return text === '';
    if (op === 'not_blank') return text !== '';
    const raw = tidyCell(String(value ?? ''));
    const want = String(raw).trim().toLowerCase();
    if (op === 'contains') return text.includes(want);
    if (op === 'not_contains') return !text.includes(want);
    if (text === '') return op === 'not_equals';
    const numbers = !(isDay(text) && isDay(want)) && Number.isFinite(toNumber(cell)) && Number.isFinite(toNumber(raw));
    const [a, b] = numbers ? [toNumber(cell), toNumber(raw)] : [text, want];
    switch (op) {
        case 'equals': return a === b;
        case 'not_equals': return a !== b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        default: throw new Error(`Unknown op "${op}".`);
    }
}

function filtered(s, where) {
    const tests = (Array.isArray(where) ? where : []).map(w => ({ c: columnOf(s, w.column), op: w.op, value: w.value }));
    return s.rows.filter(r => tests.every(t => matches(r[t.c], t.op, t.value)));
}

function compareCells(a, b) {
    const [x, y] = [toNumber(a), toNumber(b)];
    const blank = v => v === '' || v == null;
    if (blank(a) || blank(b)) return blank(a) - blank(b);
    if (!isDay(String(a)) && Number.isFinite(x) && Number.isFinite(y)) return x - y;
    return String(a).localeCompare(String(b));
}

function search(ctx, { query }) {
    const STOP = new Set(['the', 'and', 'for', 'was', 'when', 'what', 'how', 'much', 'did', 'last', 'with', 'from']);
    const words = String(query ?? '').toLowerCase().split(/\s+/).filter(w => w.length > 1 && !STOP.has(w));
    if (!words.length) throw new Error('Give at least one keyword.');
    const hits = [];
    for (const s of ctx.sources.values()) {
        (s.items || []).forEach((item, order) => {
            const score = words.filter(w => item.text.includes(w)).length;
            if (score) hits.push({ s, item, score, order });
        });
    }
    hits.sort((a, b) => b.score - a.score);
    const perSource = new Map(), results = [];
    for (const h of hits) {
        if (results.length >= MAX_HITS) break;
        const n = perSource.get(h.s.id) || 0;
        perSource.set(h.s.id, n + 1);
        if (n < HITS_PER_SOURCE) results.push({ source: h.s.id, words_matched: `${h.score} of ${words.length}`, ...compact(h.item.row) });
    }
    return fit({ total_matches: hits.length, showing: results.length }, 'results', results);
}

/** The result as text, with as many of `list` as fit in MAX_CHARS. */
function fit(head, key, list, extra = () => ({})) {
    const kept = [];
    let size = JSON.stringify(head).length + 200;
    for (const x of list) {
        size += JSON.stringify(x).length + 1;
        if (size > MAX_CHARS) break;
        kept.push(x);
    }
    return JSON.stringify({ ...head, ...(kept.length < list.length ? { cut_short: `only the first ${kept.length} fit`, ...extra(kept.length) } : {}), [key]: kept });
}

function getRows(ctx, input) {
    const s = sourceOf(ctx, input.source, 'table');
    const rows = filtered(s, input.where);
    if (input.sort_by) {
        const c = columnOf(s, input.sort_by), way = input.descending ? -1 : 1;
        rows.sort((a, b) => {
            const blank = v => v === '' || v == null;
            if (blank(a[c]) || blank(b[c])) return blank(a[c]) - blank(b[c]); // blanks last, either way
            return way * compareCells(a[c], b[c]);
        });
    }
    const offset = Math.max(0, Number(input.offset) || 0);
    const limit = Math.min(MAX_ROWS, Math.max(1, Number(input.limit) || DEFAULT_ROWS));
    const columns = Array.isArray(input.columns) && input.columns.length ? input.columns.map(c => columnOf(s, c)) : null;
    const page = rows.slice(offset, offset + limit).map(r => compact(columns ? Object.fromEntries(columns.map(c => [c, r[c]])) : r));
    return fit({ source: s.id, rows_matching: rows.length, showing_from: offset }, 'rows', page, n => ({ next_offset: offset + n }));
}

function calculate(ctx, input) {
    const s = sourceOf(ctx, input.source, 'table');
    const op = input.operation;
    if (!['sum', 'average', 'count', 'min', 'max'].includes(op)) throw new Error(`Unknown operation "${op}".`);
    const col = op === 'count' ? null : columnOf(s, input.column);
    const by = input.group_by ? columnOf(s, input.group_by) : null;
    let dateCol = null;
    if (input.period) {
        dateCol = input.date_column ? columnOf(s, input.date_column) : s.dateColumn;
        if (!dateCol) throw new Error(`${s.id} has no date column to group by.`);
    }
    const cut = input.period === 'year' ? 4 : 7;
    const groups = new Map();
    let skipped = 0;
    for (const r of filtered(s, input.where)) {
        let n = 1;
        if (col) {
            n = toNumber(r[col]);
            if (!Number.isFinite(n)) { skipped++; continue; }
        }
        const key = [dateCol ? (isDay(r[dateCol]) ? r[dateCol].slice(0, cut) : '(no date)') : null, by ? (String(r[by] ?? '').trim() || '(blank)') : null].filter(x => x !== null).join(' · ');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(n);
    }
    const work = list => {
        const total = list.reduce((a, b) => a + b, 0);
        return round2(op === 'count' ? list.length : op === 'sum' ? total : op === 'average' ? total / list.length : op === 'min' ? Math.min(...list) : Math.max(...list));
    };
    const all = [...groups.values()].flat();
    const out = { source: s.id, operation: op, column: col || undefined, rows_used: all.length, rows_without_a_number: skipped || undefined, overall: all.length ? work(all) : null };
    if (!dateCol && !by) return JSON.stringify(out);
    const list = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([group, values]) => ({ group, value: work(values), rows: values.length }));
    return JSON.stringify({ ...out, groups: list.slice(0, MAX_GROUPS), ...(list.length > MAX_GROUPS ? { cut_short: `only the first ${MAX_GROUPS} of ${list.length} groups` } : {}) });
}

function readDocument(ctx, { source, path }) {
    const s = sourceOf(ctx, source, 'document');
    let node = s.tree;
    for (const part of String(path ?? '').match(/[^.[\]]+/g) || []) {
        node = node?.[part];
        if (node === undefined) throw new Error(`${s.id} has nothing at "${path}".`);
    }
    const text = JSON.stringify(node);
    if (text.length <= MAX_CHARS) return text;
    if (node && typeof node === 'object') {
        return JSON.stringify({ too_long_to_show_at_once: true, ask_for_one_part_with_path: Object.entries(node).map(([k, v]) => ({ part: k, characters: JSON.stringify(v).length })) });
    }
    return `${text.slice(0, MAX_CHARS)}…`;
}

const RUN = { search, get_rows: getRows, calculate, read_document: readDocument };

/** The result of one lookup, as text. Throws with a message Claude can act on. */
export function runTool(ctx, name, input) {
    if (!RUN[name]) throw new Error(`Unknown tool "${name}".`);
    return RUN[name](ctx, input || {});
}
