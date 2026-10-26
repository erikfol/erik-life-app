// Dinner Planner data, ported from the old Node app (server.js + backup.js). Everything is in inputs/dinner-planner/db.json;
// meals.csv and dinner-history.csv are spreadsheet copies rewritten after every change; backups/ holds start-of-day,
// by-hand and before-restore copies of db.json. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const DIR = 'inputs/dinner-planner';
export const DB_PATH = `${DIR}/db.json`;
export const BACKUP_DIR = `${DIR}/backups`;

const KEEP_DAILY = 60; // newest start-of-day backups kept; by-hand and before-restore ones are never removed
const NAME_RE = /^(daily|manual|before-restore)-[\w-]+\.json$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let db = null; // the whole data file, as loaded

export const data = () => db;

const pad = n => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d = new Date()) => `${localDate(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// ---------- validation ----------

export const cleanStr = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function normalizeMeal(input, existing = {}) {
    const ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
    const tags = Array.isArray(input.tags) ? input.tags : [];
    const now = new Date().toISOString();
    return {
        id: existing.id || crypto.randomUUID(),
        name: cleanStr(input.name, 120),
        tags: [...new Set(tags.map(t => cleanStr(t, 40).toLowerCase()).filter(Boolean))],
        ingredients: ingredients
            .map(i => ({ name: cleanStr(i.name, 80), quantity: cleanStr(i.quantity, 40) }))
            .filter(i => i.name),
        prepMinutes: Number.isFinite(+input.prepMinutes) && +input.prepMinutes > 0 ? Math.round(+input.prepMinutes) : null,
        notes: cleanStr(input.notes, 2000),
        favorite: !!input.favorite,
        // Special meals (e.g. "Free For All") are picked by hand: never auto-suggested, no ingredients needed.
        special: !!input.special,
        source: cleanStr(input.source, 80) || existing.source || '',
        createdAt: existing.createdAt || now,
        updatedAt: now,
    };
}

/** Check a whole data file (from a backup) before it replaces the current one. */
function sanitizeDb(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.meals) || typeof input.plan !== 'object' || !input.plan) {
        throw new Error("That file doesn't look like a Dinner Planner backup.");
    }
    const meals = input.meals.filter(m => m && typeof m === 'object').map(m => ({ ...normalizeMeal(m, m), updatedAt: m.updatedAt || new Date().toISOString() }));
    const ids = new Set(meals.map(m => m.id));
    const plan = {};
    for (const [date, e] of Object.entries(input.plan)) {
        if (!DATE_RE.test(date) || !e || typeof e !== 'object') continue;
        const mealIds = [...new Set(mealsOf(e))].filter(id => ids.has(id));
        const note = cleanStr(e.note, 200);
        if (mealIds.length || note) plan[date] = { mealIds, note, skipped: !!e.skipped };
    }
    const strings = a => (Array.isArray(a) ? a.filter(s => typeof s === 'string') : []);
    return {
        version: Number.isInteger(input.version) ? input.version : 1,
        meals: meals.filter(m => m.name),
        plan,
        dismissed: strings(input.dismissed),
        aiIdeas: Array.isArray(input.aiIdeas) ? input.aiIdeas : [],
        aiRejected: strings(input.aiRejected),
    };
}

/** A calendar day's meals (days saved before version 3 had one mealId). */
export const mealsOf = e => (Array.isArray(e?.mealIds) ? e.mealIds : e?.mealId ? [e.mealId] : []);

/** One-time data upgrades, tracked by db.version so they never run twice. True if anything changed. */
function migrate(d) {
    const version = d.version || 1;
    if (version >= 3) return false;
    if (version < 2 && !d.meals.some(m => m.name.toLowerCase() === 'free for all')) {
        d.meals.push(normalizeMeal({
            name: 'Free For All',
            special: true,
            notes: 'Everyone fends for themselves: leftovers, ramen, sandwiches, whatever is around.',
        }));
    }
    // Version 3: a day can have several meals (e.g. one for the adults, one for the kids).
    for (const e of Object.values(d.plan)) {
        e.mealIds = mealsOf(e);
        delete e.mealId;
    }
    d.version = 3;
    return true;
}

// ---------- loading and saving ----------

/** Read db.json (or start from seed.json the first time). */
export async function load() {
    const text = await readTracked(DB_PATH);
    if (text === null) {
        const seed = await fetch('seed.json', { cache: 'no-cache' }).then(r => r.json());
        db = { meals: seed.meals.map(m => normalizeMeal(m)), plan: {}, dismissed: [], aiIdeas: [], aiRejected: [] };
    } else {
        db = JSON.parse(text);
        db.meals ||= [];
        db.plan ||= {};
        db.dismissed ||= [];
        db.aiIdeas ||= [];
        db.aiRejected ||= [];
    }
    if (migrate(db)) await save();
    return db;
}

async function save() {
    await dailyBackup();
    await writeTracked(DB_PATH, JSON.stringify(db, null, 2));
    await writeSpreadsheets();
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

// ---------- backups and spreadsheets ----------

/** Copy db.json as it is on disk right now (i.e. before the pending change) into backups/. */
async function snapshot(name) {
    const text = await fs.readText(DB_PATH);
    if (text === null) return null;
    await fs.writeText(`${BACKUP_DIR}/${name}`, text);
    return name;
}

/** Before the first change of each day: keep a start-of-day copy, and only the newest KEEP_DAILY of those. */
async function dailyBackup() {
    const name = `daily-${localDate()}.json`;
    if (await fs.exists(`${BACKUP_DIR}/${name}`) || !await snapshot(name)) return;
    const daily = (await fs.listFiles(BACKUP_DIR, '.json')).filter(n => n.startsWith('daily-') && NAME_RE.test(n)).sort().reverse();
    for (const old of daily.slice(KEEP_DAILY)) await fs.removeFile(`${BACKUP_DIR}/${old}`);
}

/** Backups, newest first: { name, size, modified (ISO) }. */
export async function listBackups() {
    const names = (await fs.listFiles(BACKUP_DIR, '.json')).filter(n => NAME_RE.test(n));
    const files = await Promise.all(names.map(async name => {
        const f = await fs.readFile(`${BACKUP_DIR}/${name}`);
        return f && { name, size: f.size, modified: new Date(f.lastModified).toISOString() };
    }));
    return files.filter(Boolean).sort((a, b) => b.modified.localeCompare(a.modified));
}

/** A backup's text, or null if there's no such backup. */
export async function readBackup(name) {
    return NAME_RE.test(name) ? fs.readText(`${BACKUP_DIR}/${name}`) : null;
}

export async function backUpNow() {
    await save(); // flush first so the copy is current
    return snapshot(`manual-${stamp()}.json`);
}

/** Replace everything with a backup ({ name } of one in backups/, or { data } from a file); the current data is backed up first. */
export async function restore({ name, data: source }) {
    if (name) source = JSON.parse(await readBackup(String(name)) ?? 'null');
    if (!source) throw new Error('Backup not found');
    const next = sanitizeDb(source);
    await snapshot(`before-restore-${stamp()}.json`);
    for (const k of Object.keys(db)) delete db[k];
    Object.assign(db, next);
    migrate(db); // older backups may predate the latest data upgrades
    await save();
    return { meals: next.meals.length, days: Object.keys(next.plan).length };
}

function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// BOM so Excel opens the file as UTF-8.
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function eatenStats() {
    const today = localDate();
    const stats = {};
    for (const [date, e] of Object.entries(db.plan).sort(([a], [b]) => a.localeCompare(b))) {
        if (date >= today || e.skipped) continue;
        for (const id of mealsOf(e)) {
            const s = (stats[id] ||= { count: 0, last: '' });
            s.count++;
            s.last = date;
        }
    }
    return stats;
}

export function mealsCsv() {
    const stats = eatenStats();
    const rows = [['Meal', 'Favorite', 'Tags', 'Prep minutes', 'Ingredients', 'Notes', 'Times eaten', 'Last eaten', 'Added']];
    for (const m of [...db.meals].sort((a, b) => a.name.localeCompare(b.name))) {
        rows.push([
            m.name,
            m.favorite ? 'Yes' : '',
            m.tags.join(', '),
            m.prepMinutes ?? '',
            m.ingredients.map(i => (i.quantity ? `${i.name} (${i.quantity})` : i.name)).join('; '),
            m.notes,
            stats[m.id]?.count || 0,
            stats[m.id]?.last || '',
            (m.createdAt || '').slice(0, 10),
        ]);
    }
    return toCsv(rows);
}

export function historyCsv() {
    const today = localDate();
    const names = new Map(db.meals.map(m => [m.id, m.name]));
    const rows = [['Date', 'Day', 'Meal', 'Notes', 'Status']];
    for (const [date, e] of Object.entries(db.plan).sort(([a], [b]) => a.localeCompare(b))) {
        const [y, mo, d] = date.split('-').map(Number);
        const weekday = new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
        const status = e.skipped ? 'Skipped' : date < today ? 'Eaten' : date === today ? 'Today' : 'Planned';
        rows.push([date, weekday, mealsOf(e).map(id => names.get(id)).filter(Boolean).join(' + '), e.note || '', status]);
    }
    return toCsv(rows);
}

async function writeSpreadsheets() {
    for (const [name, text] of [['meals.csv', mealsCsv()], ['dinner-history.csv', historyCsv()]]) {
        try {
            await fs.writeText(`${DIR}/${name}`, text);
        } catch (err) {
            // Most likely the CSV is open in Excel, which locks it. It's rewritten on the next change.
            console.warn(`Could not update ${name}: ${err.message}`);
        }
    }
}

// ---------- changes (each one saves) ----------

export async function addMeal(input) {
    const meal = normalizeMeal(input);
    if (!meal.name) throw new Error('Meal name is required');
    db.meals.push(meal);
    await save();
    return meal;
}

export async function updateMeal(id, input) {
    const idx = db.meals.findIndex(m => m.id === id);
    if (idx === -1) throw new Error('Meal not found');
    const meal = normalizeMeal(input, db.meals[idx]);
    if (!meal.name) throw new Error('Meal name is required');
    db.meals[idx] = meal;
    await save();
    return meal;
}

export async function deleteMeal(id) {
    const idx = db.meals.findIndex(m => m.id === id);
    if (idx === -1) throw new Error('Meal not found');
    const [removed] = db.meals.splice(idx, 1);
    // Keep plan history readable by remembering the name of the deleted meal.
    for (const entry of Object.values(db.plan)) {
        if (entry.mealIds.includes(id)) {
            entry.mealIds = entry.mealIds.filter(x => x !== id);
            entry.note = entry.note || removed.name;
        }
    }
    await save();
}

/** A day on the calendar: { mealIds, note, skipped }; no meals and no note clears it. */
export async function setDay(date, { mealIds = [], note, skipped } = {}) {
    if (!DATE_RE.test(date)) throw new Error('Bad date');
    mealIds = [...new Set(mealIds)].filter(id => db.meals.some(m => m.id === id));
    note = cleanStr(note, 200);
    // skipped: the plan didn't happen, so it shouldn't count as history.
    if (!mealIds.length && !note) delete db.plan[date];
    else db.plan[date] = { mealIds, note, skipped: !!skipped };
    await save();
}

export async function clearDay(date) {
    delete db.plan[date];
    await save();
}

export async function dismissIdea(catalogId) {
    if (typeof catalogId !== 'string' || db.dismissed.includes(catalogId)) return;
    db.dismissed.push(catalogId);
    await save();
}

export async function resetDismissed() {
    db.dismissed = [];
    await save();
}

/** New AI ideas go first, skipping any already among the meals or earlier ideas; the newest 30 are kept. */
export async function addAiIdeas(ideas) {
    const seen = new Set([...db.meals, ...db.aiIdeas].map(m => m.name.toLowerCase()));
    const fresh = ideas.filter(m => !seen.has(m.name.toLowerCase()) && seen.add(m.name.toLowerCase()));
    db.aiIdeas = [...fresh, ...db.aiIdeas].slice(0, 30);
    await save();
}

/** Remove one AI idea (or all of them with no id); reject: "not for us", so the AI stops suggesting it. */
export async function removeAiIdeas(ideaId, reject = false) {
    const removed = ideaId ? db.aiIdeas.filter(i => i.id === ideaId) : db.aiIdeas;
    db.aiIdeas = ideaId ? db.aiIdeas.filter(i => i.id !== ideaId) : [];
    if (reject) db.aiRejected.push(...removed.map(i => i.name));
    await save();
}
