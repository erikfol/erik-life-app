// Kid Lunches data: inputs/kid-lunches/lunches.json holds the kids, what may go in each part of the lunch box, and each
// day's lunches. lunches.csv is a spreadsheet copy (Date, Day, a column per kid) rewritten after every change. The kids'
// names live only in those files (inputs/ is kept out of git), not in this code.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { parseDate } from '../../bills-etc/js/dates.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const DIR = 'inputs/kid-lunches';
export const PATH = `${DIR}/lunches.json`;
export const CSV_PATH = `${DIR}/lunches.csv`;

/** The parts of the lunch box, as in the photo: big gray square and yellow rectangle on the left, circle and small
 *  rectangle on the right. */
export const COMPARTMENTS = [
    { id: 'square', name: 'Gray square' },
    { id: 'circle', name: 'Circle' },
    { id: 'yellow', name: 'Yellow' },
    { id: 'small', name: 'Small' },
];
const STARTING_ITEMS = { circle: ['Yogurt', 'Apple sauce'] }; // only these go in the circle

const FIXED = ['Date', 'Day'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let db = null; // { version, kids: [names], items: { compartment: [names] }, days: { date: { kid: lunch } } }

export const data = () => db;

const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const clean = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

function uniqueNames(list, max = 60) {
    const out = [];
    for (const n of (Array.isArray(list) ? list : []).map(v => clean(v, max))) if (n && !out.some(o => sameName(o, n))) out.push(n);
    return out;
}

/** A kid's lunch: { square: [items], …, note }, keeping only what's filled in; null when nothing is. */
function cleanLunch(input) {
    const lunch = {};
    for (const c of COMPARTMENTS) {
        const items = uniqueNames(input?.[c.id]);
        if (items.length) lunch[c.id] = items;
    }
    const note = clean(input?.note, 200);
    if (note) lunch.note = note;
    return Object.keys(lunch).length ? lunch : null;
}

function cleanDb(input) {
    const kids = uniqueNames(input.kids, 40);
    const days = {};
    for (const [date, e] of Object.entries(input.days || {})) {
        if (!DATE_RE.test(date) || !e || typeof e !== 'object') continue;
        const day = {};
        for (const kid of kids) {
            const lunch = cleanLunch(e[kid]);
            if (lunch) day[kid] = lunch;
        }
        if (Object.keys(day).length) days[date] = day;
    }
    const items = Object.fromEntries(COMPARTMENTS.map(c => [c.id, uniqueNames(input.items?.[c.id])]));
    return { version: 1, kids, items, days };
}

// ---------- loading and saving ----------

/** Read lunches.json. The first time, start from lunches.csv as it was before the lunch box: Date, Day and a column of
 *  plain-text lunches per kid (each becomes that kid's note). */
export async function load() {
    const text = await readTracked(PATH);
    if (text !== null) {
        db = cleanDb(JSON.parse(text));
        return;
    }
    db = cleanDb({ items: STARTING_ITEMS });
    const old = await fs.readText(CSV_PATH);
    if (old === null) return;
    const { columns, rows } = parseCSV(old);
    db.kids = uniqueNames(columns.filter(c => !FIXED.includes(c)), 40);
    for (const r of rows) {
        const d = parseDate(r.Date);
        if (!d) continue;
        for (const kid of db.kids) {
            const lunch = cleanLunch({ note: r[kid] });
            if (lunch) (db.days[localDate(d)] ||= {})[kid] = lunch;
        }
    }
    await save();
}

async function save() {
    await writeTracked(PATH, JSON.stringify(db, null, 2));
    try {
        await fs.writeText(CSV_PATH, '﻿' + spreadsheet()); // BOM so Excel opens it as UTF-8
    } catch (err) {
        // Most likely lunches.csv is open in Excel, which locks it. It's rewritten on the next change.
        console.warn(`Could not update lunches.csv: ${err.message}`);
    }
}

/** One kid's lunch as text: "Gray square: Turkey sandwich; Circle: Yogurt; Note: …". */
export function lunchText(lunch) {
    if (!lunch) return '';
    const parts = COMPARTMENTS.filter(c => lunch[c.id]).map(c => `${c.name}: ${lunch[c.id].join(', ')}`);
    if (lunch.note) parts.push(`Note: ${lunch.note}`);
    return parts.join('; ');
}

function spreadsheet() {
    const rows = Object.keys(db.days).sort().map(date => {
        const [y, m, d] = date.split('-').map(Number);
        const row = { Date: date, Day: new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' }) };
        for (const kid of db.kids) row[kid] = lunchText(db.days[date][kid]);
        return row;
    });
    return toCSV([...FIXED, ...db.kids], rows);
}

/** Make a change and save it; if the save fails, the change is undone so the page matches the file. */
async function change(fn) {
    const before = structuredClone(db);
    fn();
    try {
        await save();
    } catch (err) {
        db = before;
        throw err;
    }
}

// ---------- changes (each one saves) ----------

/** One day's lunches, { kid: lunch }; newItems { compartment: [names] } typed while building them join those lists. */
export function setDay(date, lunches, newItems = {}) {
    if (!DATE_RE.test(date)) throw new Error('Bad date');
    return change(() => {
        for (const c of COMPARTMENTS) db.items[c.id] = uniqueNames([...db.items[c.id], ...(newItems[c.id] || [])]);
        const day = {};
        for (const kid of db.kids) {
            const lunch = cleanLunch(lunches[kid]);
            if (lunch) day[kid] = lunch;
        }
        if (Object.keys(day).length) db.days[date] = day;
        else delete db.days[date];
    });
}

/** What may go in each part of the box: { compartment: [names] }. Lunches already saved keep their items. */
export function setItems(items) {
    return change(() => {
        for (const c of COMPARTMENTS) db.items[c.id] = uniqueNames(items[c.id]);
    });
}

/** The kids, in order: [{ from: current name or null for a new kid, name }]. Renaming keeps a kid's lunches; leaving
 *  a kid out removes their lunches. */
export function setKids(list) {
    const names = list.map(k => clean(k.name, 40));
    if (names.some(n => !n)) throw new Error('Every kid needs a name');
    if (uniqueNames(names).length !== names.length) throw new Error('Two kids have the same name');
    if (names.some(n => FIXED.some(f => sameName(f, n)))) throw new Error(`A kid can't be called ${FIXED.join(' or ')}`);
    return change(() => {
        for (const [date, e] of Object.entries(db.days)) {
            const next = {};
            list.forEach((k, i) => { if (k.from && e[k.from]) next[names[i]] = e[k.from]; });
            if (Object.keys(next).length) db.days[date] = next;
            else delete db.days[date];
        }
        db.kids = names;
    });
}
