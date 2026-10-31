// House: the list (each house's information, service companies, and per area its information) in
// inputs/house/house.json, plus one records CSV per house and area next to it (and a maintenance CSV for areas with
// a Maintenance table). An area is one page: a tab, or one part (pill) of a tab. inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const HOUSE_DIR = 'inputs/house';
export const HOUSE_PATH = `${HOUSE_DIR}/house.json`;

// The Overview's information fields a new house starts with (any can be renamed or removed).
// (Purchase, mortgage, value and taxes are on the Financing tab.)
export const FIELDS = ['Address', 'Year Built', 'Style', 'Bedrooms', 'Bathrooms', 'Square Footage', 'Lot Size', 'Stories',
    'Basement', 'Garage', 'Notes'];

// The tabs after the Overview. Each is a page with its own information (starting fields below), photos and records
// table — or, with `parts`, a row of pills (like Utilities → Electric's Bills / Mini-Splits), each part such a page.
// Parts keep their data under their own id, so part and tab ids must all differ.
// actions: offered in the records table's Action column (anything else can be typed).
// improvements: the page also has a Future improvements section (views/improvements.js).
// maintenance: the page also has a Maintenance table; the Maintenance tab's schedule items for it (their Area is the
// page's name) show their due banners at the top.
// maintenanceNote: a line shown at the top of the Maintenance section.
// boxes: several information boxes instead of one [{ key, label, fields, link? }], each kept under house.areas[<id>][key];
// link: { text, href } shown on the box's heading (e.g. where its payments are kept).
// gallery: { label, noun } for the photos section (default Photos). records: false = no records table.
// A tab or part with `table` (its columns) is just that one table, kept in <house>-<its id>.csv. The tab with
// `projects` is the Projects list and pages (views/projects.js); the tab with `schedule` is the Maintenance tab (the
// maintenance schedule and a log for the rest of the house, views/schedule.js).
const UPDATE_LOCATIONS = ['Whole house', 'Kitchen', 'Living room', 'Dining room', 'Bedroom', 'Bathroom', 'Basement', 'Garage',
    'Attic', 'Outside', 'Yard'];
const UPDATE_COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Update', kind: 'text' },
    { name: 'Location', kind: 'suggest', suggestions: UPDATE_LOCATIONS },
    { name: 'Additional Notes', kind: 'text' },
    { name: 'Invoices', kind: 'files', noun: 'invoice' },
];
const FUTURE_UPDATE_COLUMNS = [
    { name: 'Planned Date', kind: 'date' },
    { name: 'Update', kind: 'text' },
    { name: 'Location', kind: 'suggest', suggestions: UPDATE_LOCATIONS },
    { name: 'Project', kind: 'choice', projects: true }, // a project's title (Projects tab), linked to its page
    { name: 'Notes', kind: 'text' },
];
export const AREAS = [
    { id: 'financing', label: 'Financing', records: false, gallery: { label: 'Documents & photos', noun: 'image' },
        boxes: [
            { key: 'info', label: 'Mortgage', fields: ['Purchase Date', 'House Cost', 'Down Payment', 'Loan Amount', 'Rate', 'Term',
                'Monthly Principal & Interest', 'Escrow Monthly', 'Monthly Payment', 'Lender / Servicer', 'Notes'] },
            { key: 'closing', label: 'Closing', fields: ['Closed On', 'Cash to Close', 'Closing Costs', 'Down Payment', 'Deposit',
                'Seller Credit', 'Notes'] },
            { key: 'taxes', label: 'Value & Taxes', fields: ['Assessed Value', 'Property Tax', 'Notes'] },
        ] },
    { id: 'updates', label: 'Updates', parts: [
        { id: 'updates-done', label: 'Updates Done', icon: '✅', table: UPDATE_COLUMNS },
        { id: 'future-updates', label: 'Future Updates', icon: '🗓️', table: FUTURE_UPDATE_COLUMNS },
    ] },
    { id: 'projects', label: 'Projects', projects: true },
    { id: 'heating', label: 'Heating/Cooling', parts: [
        { id: 'oil-furnace', label: 'Oil furnace', icon: '🔥',
            fields: ['Heating System', 'Fuel', 'Boiler / Furnace Make', 'Model', 'Installed', 'Oil Tank Size', 'Thermostats', 'Notes'],
            actions: ['Boiler / furnace service', 'Oil filter', 'Nozzle', 'Chimney cleaning', 'Thermostat', 'Repair'],
            maintenance: true,
            maintenanceNote: 'Must be cleaned every year by professional' },
        { id: 'mini-split', label: 'Mini-split', icon: '❄️',
            fields: ['Cooling System', 'Mini-split Units', 'Installed', 'Filter Size', 'Notes'],
            actions: ['Mini-split cleaning', 'Filter change', 'Repair'],
            maintenance: true,
            maintenanceNote: 'Must be cleaned every year by professional' },
        { id: 'water-heater', label: 'Water heater', icon: '🚿',
            fields: ['Hot Water', 'Water Heater Tank', 'Installed', 'Notes'],
            actions: ['Flush tank', 'Element / thermostat', 'Anode rod', 'Replace', 'Repair'],
            maintenance: true, improvements: true,
            maintenanceNote: 'Must be drained every year, can be done DIY' },
    ] },
    { id: 'septic', label: 'Septic',
        fields: ['Tank Size', 'Tank Material', 'Tank Location', 'Leach Field Location', 'Installed', 'Pump Every', 'Notes'],
        actions: ['Pumped', 'Inspection', 'Effluent filter cleaned', 'Baffle repair', 'Riser / cover', 'Repair'],
        maintenance: true,
        maintenanceNote: 'Must be pumped every 7 years by a professional' },
    { id: 'solar', label: 'Solar',
        boxes: [
            { key: 'info', label: 'Solar system', fields: ['Panels', 'Watts per Panel', 'System Size', 'Est. Annual Production',
                'Est. Grid Usage', 'Grid Usage (2024 actual)', 'Est. Coverage (w/ mini-splits)', 'Installed', 'Installer', 'Warranty', 'Notes'] },
            { key: 'loan', label: 'Solar loan', fields: ['Term', 'Rate', 'Borrowed', 'Tax Credit (est.)', 'Balance (est.)', 'Lender', 'Notes'],
                link: { text: 'Payments in Bills Etc', href: '../bills-etc/#loans/loans' } },
        ],
        actions: ['Panel cleaning', 'Inspection', 'Inverter', 'Monitoring', 'Repair'],
        maintenance: true },
    { id: 'maintenance', label: 'Maintenance', schedule: true },
];

/** Updates → Future Updates, whose Project column links a planned update to a project. */
export const FUTURE_UPDATES = AREAS.find(t => t.id === 'updates').parts.find(p => p.id === 'future-updates');

// The Projects tab's projects, kept on the house in house.json as areas.projects.items:
// [{ id, title, status, text (plan & notes), materials: [{ Brand, Item, Quantity, 'Size / Spec', Price (each), Source, Link, Notes }],
//    specs: [{ label, value }] }];
// each project's photos and sketches in its own folder.
export const houseProjects = h => h.areas?.projects?.items ?? [];
export const projectDir = (h, p) => `${HOUSE_DIR}/projects/${h.id}-${p.id}`;
export const PROJECT_SPECS = ['Dimensions', 'Notes']; // a new project's starting Measurements & specs fields
export const MATERIAL_COLUMNS = [
    { name: 'Brand', kind: 'suggest' },
    { name: 'Item', kind: 'text' },
    { name: 'Quantity', kind: 'suggest' },
    { name: 'Size / Spec', kind: 'suggest' },
    { name: 'Price', kind: 'money' },
    { name: 'Source', kind: 'suggest' },
    { name: 'Link', kind: 'link' },
    { name: 'Notes', kind: 'text' },
];

/** A material's quantity as a number ('3', '2 bags', '1.5', '3/4', '1 1/2'); blank or no number counts as 1. */
export function quantityOf(v) {
    const m = /^\s*(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+)|\/(\d+))?/.exec(String(v ?? '').replace(/,/g, ''));
    if (!m) return 1;
    if (m[4]) return +m[4] ? +m[1] / +m[4] : +m[1];
    return +m[1] + (m[2] && +m[3] ? +m[2] / +m[3] : 0);
}

/** What a material costs: its price times its quantity, or '' when it has no price. */
export const materialCost = r => {
    const price = String(r.Price ?? '').trim();
    return price === '' || Number.isNaN(Number(price)) ? '' : Number(price) * quantityOf(r.Quantity);
};

// Offered in a future improvement's (and a project's) Status (anything else can be typed). 'Done' ones are shown crossed out.
export const IMPROVEMENT_STATUSES = ['Idea', 'Researching', 'Getting quotes', 'Planned', 'In progress', 'Done'];

/** An area's future improvements on house `h`: [{ id, title, status, cost, text }]. */
export const areaImprovements = (h, a) => h.areas?.[a.id]?.improvements ?? [];

const blank = fields => fields.map(label => ({ label, value: '' }));

/** An area's information boxes: its `boxes`, or one box of its `fields`. */
export const areaBoxes = a => a.boxes || [{ key: 'info', label: `${a.label} information`, fields: a.fields }];

/** One information box of an area on house `h` (its starting fields until saved). */
export const areaInfo = (h, a, box = areaBoxes(a)[0]) => h.areas?.[a.id]?.[box.key] ?? blank(box.fields);

// Used until house.json is first saved.
const STARTING_HOUSES = [{ id: 'home', name: 'Home', info: blank(FIELDS) }];

/** track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing. */
export async function loadHouses(track = true) {
    const text = track ? await readTracked(HOUSE_PATH) : await fs.readText(HOUSE_PATH);
    if (text === null) return structuredClone(STARTING_HOUSES);
    const list = JSON.parse(text).houses;
    return Array.isArray(list) ? list : structuredClone(STARTING_HOUSES);
}

export async function saveHouses(list) {
    await writeTracked(HOUSE_PATH, JSON.stringify({ houses: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/** A new house with a unique id made from its name. */
export function newHouse(list, name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'house';
    let id = base;
    for (let n = 2; list.some(h => h.id === id); n++) id = `${base}-${n}`;
    return { id, name, info: blank(FIELDS) };
}

/** 'Year Built' 1985 (or a date with a year in it) → '41 years'; null if there's no year or it's in the future. */
export function houseAge(value, today = new Date()) {
    const m = /\b(1[6-9]\d\d|20\d\d)\b/.exec(String(value ?? ''));
    if (!m) return null;
    const years = today.getFullYear() - +m[1];
    return years < 0 ? null : years === 0 ? 'under a year' : `${years} year${years === 1 ? '' : 's'}`;
}

/** Photos of the house (Overview) or of one area. */
export const photosDir = (h, a = null) => `${HOUSE_DIR}/photos/${h.id}${a ? '-' + a.id : ''}`;
export const recordsPath = (h, a) => `${HOUSE_DIR}/${h.id}-${a.id}-records.csv`;

// For the Vehicles service-places view.
export const STORE = {
    save: list => saveHouses(list),
    noPlaces: 'No companies yet. Press Edit to add a plumber, electrician, oil company…',
};

const doneBy = h => ['Me', ...(h.places || []).map(p => p.name)];

export const recordColumns = (h, a) => [
    { name: 'Date', kind: 'date' },
    { name: 'Action', kind: 'suggest', suggestions: a.actions },
    { name: 'Done By', kind: 'suggest', suggestions: doneBy(h) },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
    { name: 'Invoices', kind: 'files', noun: 'invoice' },
];
/** Where a table's invoices are kept: key 'oil-furnace-maintenance', 'septic-records', 'updates-done', 'maintenance' (the Maintenance tab's log)… */
export const invoicesDir = (h, key) => `${HOUSE_DIR}/invoices/${h.id}-${key}`;

export const maintenancePath = (h, a) => `${HOUSE_DIR}/${h.id}-${a.id}-maintenance.csv`;

/** A Maintenance table's columns. actions: offered first in Action (the schedule's items for that page). */
export const maintenanceColumns = (h, actions = []) => [
    { name: 'Date', kind: 'date' },
    { name: 'Action', kind: 'suggest', suggestions: actions },
    { name: 'Done By', kind: 'suggest', suggestions: doneBy(h) },
    { name: 'Description', kind: 'text' },
    { name: 'Cost', kind: 'money' },
    { name: 'Additional Notes', kind: 'text' },
    { name: 'Invoices', kind: 'files', noun: 'invoice' },
];

async function readRows(path, cols, track) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return [];
    const names = cols.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

async function writeRows(path, cols, rows) {
    await writeTracked(path, toCSV(cols.map(c => c.name), rows));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

export const loadRecords = (h, a, track = true) => readRows(recordsPath(h, a), recordColumns(h, a), track);
export const saveRecords = (h, a, rows) => writeRows(recordsPath(h, a), recordColumns(h, a), rows);
export const tablePath = (h, t) => `${HOUSE_DIR}/${h.id}-${t.id}.csv`;
export const loadTable = (h, t, track = true) => readRows(tablePath(h, t), t.table, track);
export const saveTable = (h, t, rows) => writeRows(tablePath(h, t), t.table, rows);
export const loadMaintenance = (h, a, track = true) => readRows(maintenancePath(h, a), maintenanceColumns(h), track);
export const saveMaintenance = (h, a, rows) => writeRows(maintenancePath(h, a), maintenanceColumns(h), rows);

/** Pages with a Maintenance table (each shows the due banners of its schedule items). */
export const MAINTENANCE_PAGES = AREAS.flatMap(t => t.parts || [t]).filter(a => a.maintenance);
/** The link to page `a` (a tab, or a pill of one; a tab's first pill is the tab's own link) of house `h`. */
export const pageHref = (h, a) => {
    const tab = AREAS.find(t => t === a || t.parts?.includes(a));
    return `#${h.id}/${tab.id}${tab.parts && tab.parts[0] !== a ? '/' + a.id : ''}`;
};

// ── Maintenance schedule ────────────────────────────────────────────────────────────────────────────────────────────
// What's due every so many months, or by a month of the year (yearly, or every Every (months) ÷ 12 years) — the
// furnace, mini-split, water heater and septic jobs and the rest of the house (safety, outside, laundry…). An item
// counts from the newest entry in any of the house's Maintenance tables whose Action is its name (or one of its "Also
// counts" names). Never logged, it counts from Count from (a month like 2020-05), else the purchase (Financing) — or,
// for a Due by item without Count from, this year's due date. An item whose Area is a page with a Maintenance table
// (Oil furnace, Septic…) shows its banner on that page; the rest on the Maintenance tab.
export const schedulePath = h => `${HOUSE_DIR}/${h.id}-schedule.csv`;
/** The Maintenance tab's own log, for work that isn't on one of the system pages. */
export const houseLogPath = h => `${HOUSE_DIR}/${h.id}-maintenance.csv`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SCHEDULE_AREAS = ['Safety', 'Exterior', 'Interior', 'Plumbing', 'Electrical', 'Laundry', 'Kitchen', 'Garage', 'Yard'];
/** actions: Actions already logged, offered as Item names. */
export const scheduleColumns = (actions = []) => [
    { name: 'Item', kind: 'suggest', suggestions: actions },
    { name: 'Area', kind: 'suggest', suggestions: [...MAINTENANCE_PAGES.map(a => a.label), ...SCHEDULE_AREAS] },
    { name: 'Every (months)', kind: 'number' },
    { name: 'Due by (month)', kind: 'suggest', suggestions: MONTHS },
    { name: 'Count from', kind: 'suggest' },
    { name: 'Also counts', kind: 'suggest', suggestions: actions },
    { name: 'Notes', kind: 'text' },
];
export const loadSchedule = (h, track = true) => readRows(schedulePath(h), scheduleColumns(), track);
export const saveSchedule = (h, rows) => writeRows(schedulePath(h), scheduleColumns(), rows);
export const loadHouseLog = (h, track = true) => readRows(houseLogPath(h), maintenanceColumns(h), track);
export const saveHouseLog = (h, rows) => writeRows(houseLogPath(h), maintenanceColumns(h), rows);

/** The system page a schedule item belongs to (its Area is the page's name), or null for the Maintenance tab. */
export const pageOfItem = item => MAINTENANCE_PAGES.find(a => a.label.toLowerCase() === String(item.Area || '').trim().toLowerCase()) || null;

/** Every maintenance entry of the house, from each system page's table and the Maintenance tab's log: [{ row, page }]. */
export async function allMaintenance(h, track = false) {
    const logs = await Promise.all([...MAINTENANCE_PAGES.map(a => loadMaintenance(h, a, track)), loadHouseLog(h, track)]);
    return logs.flatMap((rows, i) => rows.map(row => ({ row, page: MAINTENANCE_PAGES[i] || null })));
}

/** An item turns yellow this many days before it's due (and red once it is). */
export const SOON_DAYS = 30;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const plusMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n,
    Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate()));
/** 'Nov', 'November' or '11' → 11; 0 if blank or not a month. */
const monthOf = x => {
    const s = String(x ?? '').trim().toLowerCase(), n = Number(s);
    return n >= 1 && n <= 12 && Number.isInteger(n) ? n : MONTHS.findIndex(m => s.length >= 3 && m.toLowerCase().startsWith(s)) + 1;
};
/** '2020-05', '2020-05-14' or 'May 2020' → a Date (the 1st when there's no day); null if it can't be read. */
const fromDate = x => {
    const s = String(x ?? '').trim(), m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
    const d = s ? new Date(s) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
};
/** When the house was bought: Financing's Purchase Date (or Closed On), or null. */
const purchasedOn = h => {
    const box = [...(h.areas?.financing?.info || []), ...(h.areas?.financing?.closing || [])];
    return fromDate(box.find(f => /^(purchase date|closed on)$/i.test(f.label.trim()) && f.value)?.value);
};

/**
 * Where schedule item `item` stands, from `entries` (allMaintenance): { last ({ row, page } it counts from, or null),
 * dueDate (or null), level: 'red' once it's due, 'yellow' within SOON_DAYS, 'ok', or null with nothing to count from }.
 */
export function scheduleStatus(h, item, entries, today = new Date()) {
    const names = [item.Item, ...String(item['Also counts'] || '').split(',')].map(s => s.trim().toLowerCase()).filter(Boolean);
    const last = entries.filter(e => ISO_DAY.test(e.row.Date || '') && names.includes(String(e.row.Action || '').trim().toLowerCase()))
        .sort((a, b) => b.row.Date.localeCompare(a.row.Date))[0] || null;
    const every = Number(String(item['Every (months)'] || '').replace(/,/g, '')) || 0;
    const byMonth = monthOf(item['Due by (month)']);
    const base = last ? dayOf(last.row.Date) : fromDate(item['Count from']) || (byMonth ? null : purchasedOn(h));
    const dueDate = byMonth
        ? new Date((base ? base.getFullYear() + Math.max(1, Math.round((every || 12) / 12)) : today.getFullYear()), byMonth - 1, 1)
        : base && every > 0 ? plusMonths(base, every) : null;
    if (!dueDate) return { last, dueDate, level: null };
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const soon = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate() - SOON_DAYS);
    return { last, dueDate, level: day >= dueDate ? 'red' : day >= soon ? 'yellow' : 'ok' };
}

const showDay = d => d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const dueText = s => (s.dueDate ? showDay(s.dueDate) : '');
/** 'Oct 29, 2026 (Oil furnace · Furnace cleaning)': when the entry an item counts from was, where, and its Action if another name. */
export function lastText(s, item) {
    if (!s.last) return '';
    const action = String(s.last.row.Action || '').trim();
    const where = [s.last.page ? s.last.page.label : '', action.toLowerCase() !== String(item.Item || '').trim().toLowerCase() ? action : ''].filter(Boolean);
    return showDay(dayOf(s.last.row.Date)) + (where.length ? ` (${where.join(' · ')})` : '');
}
/** One item's banner: { level ('red' / 'yellow' / 'ok'), title, detail } (plain text), or null if it has no due date. */
export function itemBanner(item, s) {
    if (!s.level) return null;
    const when = dueText(s), last = s.last ? `Last done ${showDay(dayOf(s.last.row.Date))}` : 'Nothing logged yet';
    if (s.level === 'red') return { level: 'red', title: `${item.Item} is due.`, detail: `${last} (due ${when}). Log it with “${item.Item}” as the Action once it's done.` };
    if (s.level === 'yellow') return { level: 'yellow', title: `${item.Item} is due by ${when}.`, detail: `${last}.` };
    return { level: 'ok', title: s.last ? `${item.Item} done ${showDay(dayOf(s.last.row.Date))}.` : `${item.Item} is due by ${when}.`, detail: s.last ? `Next due ${when}.` : `${last}.` };
}
