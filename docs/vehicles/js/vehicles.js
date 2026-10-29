// Vehicles: the list (with each vehicle's information) in inputs/vehicles/vehicles.json, and one maintenance CSV
// per vehicle next to it. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const VEHICLES_DIR = 'inputs/vehicles';
export const VEHICLES_PATH = `${VEHICLES_DIR}/vehicles.json`;

// What each kind of vehicle tracks and the information fields a new one starts with (any can be renamed or removed).
export const TYPES = {
    car: {
        label: 'Car / truck', meter: 'Mileage',
        fields: ['Year', 'Make', 'Model', 'Trim', 'Engine', 'Transmission', 'Color', 'VIN', 'License Plate',
            'Registration Expires', 'Purchase Date', 'Notes'],
        actions: ['Oil change', 'Tire rotation', 'New tires', 'Brakes', 'Wiper blades', 'Engine air filter',
            'Cabin air filter', 'Battery', 'Inspection', 'Registration', 'Detailing'],
    },
    boat: {
        label: 'Boat', meter: 'Engine Hours',
        fields: ['Year', 'Make', 'Model', 'Style', 'Color', 'Length', 'Beam', 'Hull ID (HIN)', 'Bow Number', 'Engine',
            'Horsepower', 'Fuel', 'Drive', 'Features', 'Trailer', 'Registration Expires', 'Purchase Date', 'Notes'],
        actions: ['Winterize', 'De-winterize', 'Oil change', 'Lower unit oil', 'Impeller', 'Spark plugs', 'Fuel filter',
            'Battery', 'Bottom paint', 'Trailer bearings', 'Registration', 'Cleaning'],
    },
    other: {
        label: 'Other', meter: 'Mileage',
        fields: ['Year', 'Make', 'Model', 'Color', 'Serial Number', 'Registration Expires', 'Purchase Date', 'Notes'],
        actions: [],
    },
};

const blankInfo = (type, known = {}) => TYPES[type].fields.map(label => ({ label, value: known[label] ?? '' }));

// Used until vehicles.json is first saved.
const STARTING_VEHICLES = [
    { id: 'honda-accord', name: '2018 Honda Accord Sport (2.0T)', type: 'car', meter: 'Mileage',
        info: blankInfo('car', { Year: '2018', Make: 'Honda', Model: 'Accord', Trim: 'Sport 2.0T', Engine: '2.0L turbo 4-cylinder' }) },
    { id: 'four-winns', name: '1996 Four Winns 205 Sundowner', type: 'boat', meter: 'Engine Hours',
        info: blankInfo('boat', { Year: '1996', Make: 'Four Winns', Model: '205 Sundowner' }) },
];

/** track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing. */
export async function loadVehicles(track = true) {
    const text = track ? await readTracked(VEHICLES_PATH) : await fs.readText(VEHICLES_PATH);
    if (text === null) return structuredClone(STARTING_VEHICLES);
    const list = JSON.parse(text).vehicles;
    return Array.isArray(list) ? list : structuredClone(STARTING_VEHICLES);
}

export async function saveVehicles(list) {
    await writeTracked(VEHICLES_PATH, JSON.stringify({ vehicles: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/** A new vehicle with a unique id made from its name. */
export function newVehicle(list, name, type) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
    let id = base;
    for (let n = 2; list.some(v => v.id === id); n++) id = `${base}-${n}`;
    return { id, name, type, meter: TYPES[type].meter, info: blankInfo(type) };
}

// What the shared views (places, guides, notes) save with and say; another app (House) passes its own.
export const STORE = {
    save: list => saveVehicles(list),
    guideDir: (v, g) => guideDir(v, g),
    noteDir: (v, n) => noteDir(v, n),
    noPlaces: 'No places yet. Press Edit to add a shop or marina.',
    noNotes: 'No notes yet. Add things you noticed, questions for the marina, ideas…',
};

export const maintenancePath = v => `${VEHICLES_DIR}/${v.id}-maintenance.csv`;
export const photosDir = v => `${VEHICLES_DIR}/photos/${v.id}`;
export const guideDir = (v, g) => `${VEHICLES_DIR}/guides/${v.id}/${g.id}`;
export const noteDir = (v, n) => `${VEHICLES_DIR}/notes/${v.id}/${n.id}`;

/**
 * Maintenance columns; the second one is what the vehicle tracks (Mileage, Engine Hours). `actions`: more Actions to
 * offer first (a car's maintenance schedule items, so what's logged matches them).
 */
export const maintenanceColumns = (v, actions = []) => [
    { name: 'Date', kind: 'date' },
    { name: v.meter || 'Mileage', kind: 'number' },
    { name: 'Action', kind: 'suggest', suggestions: [...actions, ...(TYPES[v.type]?.actions || [])]
        .filter((a, i, all) => a && all.findIndex(b => b?.toLowerCase() === a.toLowerCase()) === i) }, // the first spelling wins
    { name: 'Location', kind: 'suggest', suggestions: (v.places || []).map(p => p.name) }, // where it was done
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
];

/** A CSV's rows with just these columns ([] if there's no file yet). */
async function loadRows(path, cols, track) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return [];
    const names = cols.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

async function saveRows(path, cols, rows) {
    await writeTracked(path, toCSV(cols.map(c => c.name), rows));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

export const loadMaintenance = (v, track = true) => loadRows(maintenancePath(v), maintenanceColumns(v), track);
export const saveMaintenance = (v, rows) => saveRows(maintenancePath(v), maintenanceColumns(v), rows);

// Cars also keep a mileage log (Date, Mileage) whenever it's read off the dash; the latest is the current mileage.
export const hasMileageLog = v => v.type === 'car';
export const mileagePath = v => `${VEHICLES_DIR}/${v.id}-mileage.csv`;
export const MILEAGE_COLUMNS = [{ name: 'Date', kind: 'date' }, { name: 'Mileage', kind: 'number' }];
export const loadMileage = (v, track = true) => loadRows(mileagePath(v), MILEAGE_COLUMNS, track);
export const saveMileage = (v, rows) => saveRows(mileagePath(v), MILEAGE_COLUMNS, rows);

/** The newest dated reading ({ Date, Mileage }), or null. */
export const latestMileage = rows => rows.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.Date || '') && r.Mileage !== '')
    .sort((a, b) => b.Date.localeCompare(a.Date))[0] || null;

const infoValue = (v, label) => (v.info || []).find(f => f.label.trim().toLowerCase() === label.toLowerCase())?.value.trim() || '';
const milesOf = x => Number(String(x ?? '').replace(/,/g, '').trim() || NaN);

/** A day typed into the information ('2018-09-05', 'Sep 05 2018'), or null. */
function parseDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(text);
    return text && !Number.isNaN(d.getTime()) ? d : null;
}

/** When it was bought and at what mileage ({ date, miles }; 0 miles: bought new), or null without a Purchase Date. */
function purchaseOf(v) {
    const date = parseDay(infoValue(v, 'Purchase Date'));
    return date ? { date, miles: milesOf(infoValue(v, 'Purchase Mileage')) || 0 } : null;
}

/** The purchase as a reading ({ day, miles, from: 'bought new, Sep 5, 2018' }), or null without a Purchase Date. */
function purchase(v) {
    const bought = parseDay(infoValue(v, 'Purchase Date'));
    if (!bought) return null;
    const miles = milesOf(infoValue(v, 'Purchase Mileage')) || 0; // 0: bought new
    const day = bought.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return { day: Date.UTC(bought.getFullYear(), bought.getMonth(), bought.getDate()) / 864e5, miles,
        from: miles ? `bought at ${miles.toLocaleString('en-US')} miles, ${day}` : `bought new, ${day}` };
}

/** A dated reading as { day, miles }. */
const point = r => { const [y, m, d] = r.Date.split('-').map(Number); return { day: Date.UTC(y, m - 1, d) / 864e5, miles: milesOf(r.Mileage) }; };

/** Miles a month and a year, on average, from point `a` to point `b`, or null if they're under `minDays` apart. */
function rate(a, b, minDays) {
    const days = b.day - a.day, miles = b.miles - a.miles;
    if (Number.isNaN(miles) || days < minDays) return null;
    const perYear = miles / days * 365.25;
    return { perMonth: Math.round(perYear / 12), perYear: Math.round(perYear) };
}

/**
 * Miles put on a month and a year, on average, from the purchase (the information's Purchase Date, at 0 miles — bought
 * new — or its Purchase Mileage if it has one) to the newest reading: { perMonth, perYear, from: 'bought new, Sep 5,
 * 2018' }, { why } when it can't be worked out, or null with no readings.
 */
export function mileageRate(v, rows) {
    const last = latestMileage(rows);
    if (!last) return null;
    const p = purchase(v);
    if (!p) return { why: 'Needs a Purchase Date in Vehicle information' };
    const r = rate(p, point(last), 28);
    return r ? { ...r, from: p.from } : { why: 'Needs a reading at least a month after the purchase' };
}

/**
 * The mileage log's worked-out columns (shown, never saved): for each reading, the miles a month and a year since the
 * reading before it — the oldest one since the purchase. rows() gives the log as it is now.
 */
export const mileageRateColumns = (v, rows) => {
    const since = r => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.Date || '') || r.Mileage === '') return null;
        const before = latestMileage(rows().filter(x => (x.Date || '') < r.Date));
        const from = before ? point(before) : purchase(v);
        return from && rate(from, point(r), 1);
    };
    return [
        { name: 'Miles per month', kind: 'number', calc: r => since(r)?.perMonth ?? '' },
        { name: 'Miles per year', kind: 'number', calc: r => since(r)?.perYear ?? '' },
    ];
};

// ── Maintenance schedule (cars) ─────────────────────────────────────────────────────────────────────────────────────
// What's due every so many miles and/or months (for the Accord, Honda's Maintenance Minder items, with typical
// intervals). An item counts from the newest Maintenance entry whose Action is its name, or one of its "Also counts"
// names; never logged, it counts from the purchase (by First, where that's filled in, instead of Every).
export const hasSchedule = v => hasMileageLog(v);
export const schedulePath = v => `${VEHICLES_DIR}/${v.id}-schedule.csv`;
/** actions: the Actions in the Maintenance log, offered as Item names. */
export const scheduleColumns = (actions = []) => [
    { name: 'Item', kind: 'suggest', suggestions: actions },
    { name: 'Code', kind: 'suggest' },
    { name: 'Every (miles)', kind: 'number' },
    { name: 'Every (months)', kind: 'number' },
    { name: 'First (miles)', kind: 'number' },
    { name: 'First (months)', kind: 'number' },
    { name: 'Also counts', kind: 'suggest', suggestions: actions },
    { name: 'Notes', kind: 'text' },
];
export const loadSchedule = (v, track = true) => loadRows(schedulePath(v), scheduleColumns(), track);
export const saveSchedule = (v, rows) => saveRows(schedulePath(v), scheduleColumns(), rows);

/** An item turns yellow this many miles, or days, before it's due (and red once it is). */
export const SOON_MILES = 2000, SOON_DAYS = 30;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const plusMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n,
    Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()));

/** The newest dated mileage in the mileage log or the maintenance log: { date (a Date), miles }, or null. */
export function currentReading(v, log, readings) {
    const meter = v.meter || 'Mileage';
    const best = [...readings.map(r => ({ day: r.Date, miles: milesOf(r.Mileage) })), ...log.map(r => ({ day: r.Date, miles: milesOf(r[meter]) }))]
        .filter(r => ISO_DAY.test(r.day || '') && Number.isFinite(r.miles))
        .sort((a, b) => b.day.localeCompare(a.day) || b.miles - a.miles)[0];
    return best ? { date: dayOf(best.day), miles: best.miles } : null;
}

/**
 * Where schedule item `item` stands, from the Maintenance `log` and `now` (currentReading): { last (the entry it counts
 * from, or null), dueMiles (NaN if none), dueDate (or null), level }. level: 'red' once it's due, 'yellow' within
 * SOON_MILES / SOON_DAYS of it, 'ok', or null with nothing to count from (no Every, or a last entry without its mileage).
 */
export function scheduleStatus(v, item, log, now, today = new Date()) {
    const meter = v.meter || 'Mileage';
    const names = [item.Item, ...String(item['Also counts'] || '').split(',')].map(s => s.trim().toLowerCase()).filter(Boolean);
    const last = log.filter(r => ISO_DAY.test(r.Date || '') && names.includes(String(r.Action || '').trim().toLowerCase()))
        .sort((a, b) => b.Date.localeCompare(a.Date) || (milesOf(b[meter]) || 0) - (milesOf(a[meter]) || 0))[0] || null;
    const num = k => { const n = milesOf(item[k]); return n > 0 ? n : NaN; };
    let everyMiles = num('Every (miles)'), everyMonths = num('Every (months)'), base;
    if (last) base = { miles: milesOf(last[meter]), date: dayOf(last.Date) };
    else {
        const p = purchaseOf(v);
        base = { miles: p ? p.miles : 0, date: p ? p.date : null };
        everyMiles = num('First (miles)') || everyMiles;
        everyMonths = num('First (months)') || everyMonths;
    }
    const dueMiles = Number.isFinite(base.miles) && everyMiles > 0 ? base.miles + everyMiles : NaN;
    const dueDate = base.date && everyMonths > 0 ? plusMonths(base.date, everyMonths) : null;
    if (!Number.isFinite(dueMiles) && !dueDate) return { last, dueMiles, dueDate, level: null };
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const byMiles = Number.isFinite(dueMiles) && Number.isFinite(now?.miles);
    const due = (byMiles && now.miles >= dueMiles) || (dueDate && day >= dueDate);
    const soon = (byMiles && now.miles >= dueMiles - SOON_MILES)
        || (dueDate && day >= new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - SOON_DAYS));
    return { last, dueMiles, dueDate, level: due ? 'red' : soon ? 'yellow' : 'ok' };
}

const showDay = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const mi = n => `${Math.round(n).toLocaleString('en-US')} mi`;

/** '81,884 mi or Dec 11, 2026' — when a status (scheduleStatus) is due; '' without either. */
export const dueText = s => [Number.isFinite(s.dueMiles) ? mi(s.dueMiles) : '', s.dueDate ? showDay(s.dueDate) : ''].filter(Boolean).join(' or ');

/** About when the car reaches `miles` at its average rate ('May 2027'), or '' (already there, or no rate). */
function aboutWhen(v, readings, now, miles) {
    const rate = mileageRate(v, readings);
    if (!now || !rate?.perYear || !(miles > now.miles)) return '';
    const d = new Date(now.date.getTime() + (miles - now.miles) / rate.perYear * 365.25 * 864e5);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

/** '81,884 mi (≈ Dec 2026) or Dec 11, 2026': dueText, with about when the car gets to the mileage (if it's still ahead). */
export function nextDueText(v, readings, now, s) {
    const when = Number.isFinite(s.dueMiles) ? aboutWhen(v, readings, now, s.dueMiles) : '';
    return [Number.isFinite(s.dueMiles) ? mi(s.dueMiles) + (when ? ` (≈ ${when})` : '') : '', s.dueDate ? showDay(s.dueDate) : '']
        .filter(Boolean).join(' or ');
}

/** 'Dec 11, 2025 · 74,384 mi' for the entry `item` counts from (with its Action if that's another name); '' if never logged. */
export function lastText(v, s, item) {
    if (!s.last) return '';
    const miles = milesOf(s.last[v.meter || 'Mileage']), action = String(s.last.Action || '').trim();
    return [showDay(dayOf(s.last.Date)), Number.isFinite(miles) ? mi(miles) : ''].filter(Boolean).join(' · ')
        + (action.toLowerCase() !== String(item.Item || '').trim().toLowerCase() ? ` (${action})` : '');
}
