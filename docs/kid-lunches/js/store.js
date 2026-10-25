// Kid Lunches data: inputs/kid-lunches/lunches.csv, one row per day (Date, Day, then a column per kid) so it also opens
// in Excel. The kids are the columns after Date and Day, which keeps their names in the data folder (inputs/ is kept out
// of git) rather than in this code.
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { parseDate } from '../../bills-etc/js/dates.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const DIR = 'inputs/kid-lunches';
export const PATH = `${DIR}/lunches.csv`;

const FIXED = ['Date', 'Day'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let kids = []; // names, in column order
let days = {}; // 'YYYY-MM-DD' → { kid name: lunch }

export const data = () => ({ kids, days });

const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const clean = v => (typeof v === 'string' ? v.trim().slice(0, 300) : '');

/** Read lunches.csv (no file yet = no kids and no lunches). Dates Excel rewrote as 10/26/2026 still read. */
export async function load() {
    const { columns, rows } = parseCSV(await readTracked(PATH) ?? '');
    kids = columns.filter(c => c && !FIXED.includes(c));
    days = {};
    for (const r of rows) {
        const d = parseDate(r.Date);
        if (!d) continue;
        const lunches = Object.fromEntries(kids.map(k => [k, clean(r[k])]).filter(([, v]) => v));
        if (Object.keys(lunches).length) days[localDate(d)] = { ...days[localDate(d)], ...lunches };
    }
}

async function save() {
    const rows = Object.keys(days).sort().map(date => {
        const [y, m, d] = date.split('-').map(Number);
        return { Date: date, Day: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }), ...days[date] };
    });
    try {
        await writeTracked(PATH, '﻿' + toCSV([...FIXED, ...kids], rows)); // BOM so Excel opens it as UTF-8
    } catch (err) {
        if (err.name === 'NoModificationAllowedError') throw new Error('Could not save lunches.csv. If it is open in Excel, close it and try again.');
        throw err;
    }
}

/** Make a change and save it; if the save fails, the change is undone so the page matches the file. */
async function change(fn) {
    const before = structuredClone({ kids, days });
    fn();
    try {
        await save();
    } catch (err) {
        ({ kids, days } = before);
        throw err;
    }
}

/** One day's lunches: { kid name: lunch }; leaving every kid blank clears the day. */
export function setDay(date, lunches) {
    if (!DATE_RE.test(date)) throw new Error('Bad date');
    return change(() => {
        const kept = Object.fromEntries(kids.map(k => [k, clean(lunches[k])]).filter(([, v]) => v));
        if (Object.keys(kept).length) days[date] = kept;
        else delete days[date];
    });
}

/** The kids, in order: [{ from: current name or null for a new kid, name }]. Renaming keeps a kid's lunches; leaving
 *  a kid out removes their lunches. */
export function setKids(list) {
    const names = list.map(k => clean(k.name).slice(0, 40));
    if (names.some(n => !n)) throw new Error('Every kid needs a name');
    const lower = names.map(n => n.toLowerCase());
    if (new Set(lower).size !== names.length) throw new Error('Two kids have the same name');
    if (lower.some(n => FIXED.some(f => f.toLowerCase() === n))) throw new Error(`A kid can't be called ${FIXED.join(' or ')}`);
    return change(() => {
        for (const [date, e] of Object.entries(days)) {
            const next = {};
            list.forEach((k, i) => { if (k.from && e[k.from]) next[names[i]] = e[k.from]; });
            if (Object.keys(next).length) days[date] = next;
            else delete days[date];
        }
        kids = names;
    });
}
