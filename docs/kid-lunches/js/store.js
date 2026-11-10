// Kid Lunches data: inputs/kid-lunches/lunches.json holds the kids, what may go in each part of each kid's lunch box, and
// each day's lunches. lunches.csv is a spreadsheet copy (Date, Day, a column per kid) rewritten after every change. The kids'
// names live only in those files (inputs/ is kept out of git), not in this code.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { parseDate } from '../../bills-etc/js/dates.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const DIR = 'inputs/kid-lunches';
export const PATH = `${DIR}/lunches.json`;
export const CSV_PATH = `${DIR}/lunches.csv`;

/** The parts of a lunch: the main entree in its own container, and the lunch box's tray as in the photo (big gray
 *  square and yellow rectangle on the left, circle and small rectangle on the right). */
export const COMPARTMENTS = [
    { id: 'main', name: 'Main entree' },
    { id: 'square', name: 'Gray square', tray: true },
    { id: 'circle', name: 'Circle', tray: true },
    { id: 'yellow', name: 'Yellow', tray: true },
    { id: 'small', name: 'Small', tray: true },
];
const STARTING_ITEMS = { circle: ['Yogurt', 'Apple sauce'] }; // only these go in the circle; a new kid starts with this

/** How much of an item a kid ate, marked after school (lunch.ate). */
export const EATEN = [
    { id: 'yes', mark: '✓', label: 'Ate it', short: 'Ate', text: 'ate' },
    { id: 'some', mark: '½', label: 'Some', short: 'Some', text: 'ate some' },
    { id: 'no', mark: '✗', label: "Didn't eat", short: "Didn't", text: "didn't eat" },
];
export const eatenInfo = id => EATEN.find(e => e.id === id);

const FIXED = ['Date', 'Day'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let db = null; // { version, kids: [names], items: { kid: { compartment: [names] } }, days: { date: { kid: lunch } } }

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

/** A kid's lunch: { square: [items], …, note, ate }, keeping only what's filled in; null when nothing is. `ate` is how
 *  much of each item they ate, { part: { item: 'yes' | 'some' | 'no' } }, for items still in that part. */
function cleanLunch(input) {
    const lunch = {};
    const ate = {};
    for (const c of COMPARTMENTS) {
        const items = uniqueNames(input?.[c.id]);
        if (!items.length) continue;
        lunch[c.id] = items;
        const marks = input?.ate?.[c.id];
        if (!marks || typeof marks !== 'object') continue;
        for (const item of items) {
            const key = Object.keys(marks).find(k => sameName(k, item));
            if (key && eatenInfo(marks[key])) (ate[c.id] ||= {})[item] = marks[key];
        }
    }
    const note = clean(input?.note, 200);
    if (note) lunch.note = note;
    if (!Object.keys(lunch).length) return null;
    if (Object.keys(ate).length) lunch.ate = ate;
    return lunch;
}

/** How much a kid ate of one item in one part of their lunch: an EATEN id, or undefined when it isn't marked. */
export const eatenOf = (lunch, part, item) => lunch?.ate?.[part]?.[item];

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
    // Version 1 had one set of lists for both kids; each kid now starts from a copy of it.
    const shared = COMPARTMENTS.some(c => Array.isArray(input.items?.[c.id])) ? input.items : null;
    const items = Object.fromEntries(kids.map(kid => [kid, boxItems(shared || input.items?.[kid])]));
    return { version: 2, kids, items, days };
}

/** One kid's lists: { compartment: [names] }. */
const boxItems = src => Object.fromEntries(COMPARTMENTS.map(c => [c.id, uniqueNames(src?.[c.id])]));

// ---------- loading and saving ----------

/** Read lunches.json. The first time, start from lunches.csv as it was before the lunch box: Date, Day and a column of
 *  plain-text lunches per kid (each becomes that kid's note). */
export async function load() {
    const text = await readTracked(PATH);
    if (text !== null) {
        db = cleanDb(JSON.parse(text));
        return;
    }
    const old = await fs.readText(CSV_PATH);
    const { columns, rows } = parseCSV(old ?? '');
    const kids = columns.filter(c => !FIXED.includes(c));
    const days = {};
    for (const r of rows) {
        const d = parseDate(r.Date);
        if (d) days[localDate(d)] = Object.fromEntries(kids.map(kid => [kid, { note: r[kid] }]));
    }
    db = cleanDb({ kids, items: STARTING_ITEMS, days }); // the starting lists, copied to each kid
    if (old !== null) await save();
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

/** One kid's lunch as text: "Gray square: Turkey sandwich (ate); Circle: Yogurt (didn't eat); Note: …". */
export function lunchText(lunch) {
    if (!lunch) return '';
    const withEaten = (c, item) => {
        const e = eatenInfo(eatenOf(lunch, c.id, item));
        return e ? `${item} (${e.text})` : item;
    };
    const parts = COMPARTMENTS.filter(c => lunch[c.id]).map(c => `${c.name}: ${lunch[c.id].map(n => withEaten(c, n)).join(', ')}`);
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

/** One day's lunches, { kid: lunch } (what they ate, `ate`, is kept for items still in the lunch); newItems { kid: { compartment: [names] } } typed while building them join that
 *  kid's lists. */
export function setDay(date, lunches, newItems = {}) {
    if (!DATE_RE.test(date)) throw new Error('Bad date');
    return change(() => {
        for (const kid of db.kids) {
            for (const c of COMPARTMENTS) db.items[kid][c.id] = uniqueNames([...db.items[kid][c.id], ...(newItems[kid]?.[c.id] || [])]);
        }
        const day = {};
        for (const kid of db.kids) {
            const lunch = cleanLunch(lunches[kid]);
            if (lunch) day[kid] = lunch;
        }
        if (Object.keys(day).length) db.days[date] = day;
        else delete db.days[date];
    });
}

/** What the kids ate on a day: { kid: { part: { item: 'yes' | 'some' | 'no' } } }, replacing the marks of every kid
 *  given; items not marked are left out. */
export function setEaten(date, ate) {
    if (!db.days[date]) throw new Error('Nothing was packed that day');
    return change(() => {
        const day = db.days[date];
        for (const kid of db.kids) {
            if (!day[kid] || !ate[kid]) continue;
            day[kid] = cleanLunch({ ...day[kid], ate: ate[kid] });
        }
    });
}

/** What may go in each part of each kid's box: { kid: { compartment: [names] } }. Lunches already saved keep their items. */
export function setItems(items) {
    return change(() => {
        for (const kid of db.kids) if (items[kid]) db.items[kid] = boxItems(items[kid]);
    });
}

/** The kids, in order: [{ from: current name or null for a new kid, name }]. Renaming keeps a kid's lunches and box;
 *  leaving a kid out removes them; a new kid's box starts with the starting lists. */
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
        db.items = Object.fromEntries(list.map((k, i) => [names[i], k.from && db.items[k.from] ? db.items[k.from] : boxItems(STARTING_ITEMS)]));
        db.kids = names;
    });
}
