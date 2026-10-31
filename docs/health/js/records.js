// Health records: one CSV per section in inputs/health/ of the connected folder (kept out of git like all of inputs/).
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const HEALTH_DIR = 'inputs/health';
export const LOCATIONS_PATH = `${HEALTH_DIR}/locations.json`;
export const INFO_PATH = `${HEALTH_DIR}/info.json`; // the General information box of each section that has one
const DEFAULT_LOCATIONS = ['Head', 'Lips', 'Stomach', 'Arm', 'Leg', 'Penis'];

// Future appointments (General Health, Dental, Eye), like a pet's: Pets' columns, with Health's "Additional Notes".
const APPOINTMENT_COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Time', kind: 'suggest' },
    { name: 'Location', kind: 'suggest' }, // where it is (offers the ones used before), not General Health's body locations
    { name: 'Description', kind: 'text' },
    { name: 'Additional Notes', kind: 'text' },
];

// The Records of General Health, Dental and Eye: each visit, where (the office: offers the ones used before, not
// General Health's body locations), what it cost, what was paid out of pocket, and what you still owe and whether
// that's paid (green Paid, red Not paid; see owedRecords).
const RECORD_COLUMNS = [
    { name: 'Date', kind: 'date' },
    { name: 'Description', kind: 'text' },
    { name: 'Location', kind: 'suggest' },
    { name: 'Total Cost', kind: 'money' },
    { name: 'Out of Pocket', kind: 'money' },
    { name: 'I Owe', kind: 'money' },
    { name: 'Paid?', kind: 'choice', badge: v => (v === 'Paid' ? 'paid' : v === 'Not paid' ? 'not-paid' : '') },
    { name: 'Additional Notes', kind: 'text' },
    { name: 'Invoices', kind: 'files', noun: 'invoice' },
];
/** The Records' Paid? dropdown (for the record table's choices). */
export const PAID_CHOICES = { 'Paid?': { list: ['Paid', 'Not paid'], noun: 'status' } };

/**
 * What a section's Records still owe: { rows (each with an I Owe amount not marked Paid), total }. Its pages show
 * a red banner for them, and the Home page counts it (alerts.js).
 */
export function owedRecords(rows) {
    const owe = r => parseFloat(String(r['I Owe'] ?? '').replace(/[$,\s]/g, ''));
    const owed = rows.filter(r => owe(r) > 0 && r['Paid?'] !== 'Paid');
    return { rows: owed, total: owed.reduce((t, r) => t + owe(r), 0), owe };
}

// Column kinds are the shared record table's (shared/js/recordtable.js). `info`: the General information fields a
// section starts with (any can be renamed or removed). `notes`: a second table after Records ({ label, path, columns }).
export const SECTIONS = [
    { id: 'general', label: 'General Health', path: `${HEALTH_DIR}/general_records.csv`,
        info: ['Doctor', 'Practice', 'Phone', 'Address', 'Website', 'Blood Type', 'Allergies', 'Medications', 'Notes'], columns: RECORD_COLUMNS,
        // General Health's first table (it was its Records): notes by body location (the Location list in locations.json)
        notes: { label: 'Personal Notes', path: `${HEALTH_DIR}/general_health.csv`, columns: [
            { name: 'Date', kind: 'date' },
            { name: 'Location', kind: 'choice' },
            { name: 'Description', kind: 'text' },
            { name: 'Additional Notes', kind: 'text' },
            { name: 'Invoices', kind: 'files', noun: 'invoice' },
        ] },
        appointments: { path: `${HEALTH_DIR}/general_appointments.csv`, columns: APPOINTMENT_COLUMNS } },
    { id: 'dental', label: 'Dental', path: `${HEALTH_DIR}/dental.csv`,
        info: ['Dentist', 'Office', 'Phone', 'Address', 'Website', 'Notes'], columns: RECORD_COLUMNS,
        appointments: { path: `${HEALTH_DIR}/dental_appointments.csv`, columns: APPOINTMENT_COLUMNS } },
    { id: 'eye', label: 'Eye', path: `${HEALTH_DIR}/eye.csv`,
        info: ['Eye Doctor', 'Office', 'Phone', 'Address', 'Website', 'Prescription', 'Notes'], columns: RECORD_COLUMNS,
        appointments: { path: `${HEALTH_DIR}/eye_appointments.csv`, columns: APPOINTMENT_COLUMNS } },
    // Several accounts (FLORES, WealthCare…), each with its own entries file; see loadAccounts.
    { id: 'hsa', label: 'Health Savings Account (HSA)', accounts: `${HEALTH_DIR}/hsa.json`, balance: accountBalance, columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Type', kind: 'suggest', suggestions: ['Deposit', 'Charge'] }, // or anything typed in
        { name: 'Description', kind: 'text' },
        { name: 'Amount', kind: 'money' },
        { name: 'Additional Notes', kind: 'text' },
        { name: 'Invoices', kind: 'files', noun: 'invoice' },
    ] },
];
/** Where a section's invoices are kept (an HSA account's in its own folder). */
export const invoicesDir = (section, account = null) => `${HEALTH_DIR}/invoices/${section.id}${account ? '-' + account.id : ''}`;

/** A section's `notes` table (General Health's Personal Notes) as a table of its own, with its own invoices folder. */
export const notesSection = section => ({ ...section, ...section.notes, filesDir: `${HEALTH_DIR}/invoices/${section.id}-notes` });

const names = section => section.columns.map(c => c.name);

/**
 * The HSA's total balance: a Deposit adds its Amount and a Charge takes it away (the Type decides, so a charge typed
 * as -50 still counts as 50 out). Entries of any other Type could be either, so they aren't counted.
 * Returns { balance, deposits, charges, other } — other: how many entries with an amount were left out.
 */
function accountBalance(rows) {
    const t = { balance: 0, deposits: 0, charges: 0, other: 0 };
    for (const r of rows) {
        const s = String(r.Amount ?? '').replace(/[$,]/g, '').trim();
        const n = s === '' ? NaN : Math.abs(Number(s));
        if (Number.isNaN(n)) continue;
        const type = (r.Type || '').trim().toLowerCase();
        if (type === 'deposit') t.deposits += n;
        else if (type === 'charge') t.charges += n;
        else t.other++;
    }
    t.balance = t.deposits - t.charges;
    return t;
}

/**
 * Rows of a section's file ([] when it doesn't exist yet); columns the file lacks read as blank.
 * track: false for read-only use (the phone copy), so the save guard keeps the version this page is editing.
 */
export async function loadRecords(section, track = true) {
    const text = track ? await readTracked(section.path) : await fs.readText(section.path);
    if (text === null) return [];
    return parseCSV(text).rows.map(r => Object.fromEntries(names(section).map(c => [c, r[c] ?? ''])));
}

export async function saveRecords(section, rows) {
    await writeTracked(section.path, toCSV(names(section), rows));
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

/**
 * A section's accounts (the HSA's): [{ id, title, accountNumber, hint, linkText, url, file }] — who holds it, its number, a sign-in hint, its
 * website, and the CSV in inputs/health/ its entries are kept in. Kept in inputs/ like the records, never in the code
 * (the site is public).
 */
export async function loadAccounts(section, track = true) {
    const text = track ? await readTracked(section.accounts) : await fs.readText(section.accounts);
    if (text === null) return [];
    const data = JSON.parse(text);
    if (Array.isArray(data.accounts)) return data.accounts;
    // the first version held one account, with its entries in hsa.csv
    return data.title || data.url ? [{ id: slug(data.title) || 'account', file: 'hsa.csv', ...data }] : [];
}

export async function saveAccounts(section, list) {
    await writeTracked(section.accounts, JSON.stringify({ accounts: list }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved'));
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A new account called `title`, with an id and an entries file of its own ('WealthCare' → hsa-wealthcare.csv). */
export function newAccount(section, list, title) {
    const base = slug(title) || 'account';
    let id = base;
    for (let n = 2; list.some(a => a.id === id); n++) id = `${base}-${n}`;
    return { id, title, file: `${section.id}-${id}.csv` };
}

/** A section's future appointments as a table of their own (loadRecords / saveRecords take it like a section). */
export const appointmentsSection = section => ({ ...section, ...section.appointments });

/** The section as one account's table: same columns, that account's file. */
export const accountSection = (section, account) => ({ ...section, path: `${HEALTH_DIR}/${account.file}` });

/**
 * Every section's General information: { sections: { section id: [{ label, value }] }, links: { section id: [{ linkText,
 * url, hint }] } }. A section not saved yet starts with its `info` fields, blank. links: websites next to the box's
 * heading with their sign-in hints, like a Loan/CC card's (kept in inputs/, never in the code: the site is public); a
 * section saved when it had one link holds { linkText, url, hint }, read as a list of one.
 * track: false for read-only use (the phone copy).
 */
export async function loadInfo(track = true) {
    const text = track ? await readTracked(INFO_PATH) : await fs.readText(INFO_PATH);
    const saved = text === null ? {} : JSON.parse(text);
    const sections = saved.sections || {};
    return {
        sections: Object.fromEntries(SECTIONS.filter(s => s.info).map(s => [s.id,
            Array.isArray(sections[s.id]) ? sections[s.id] : s.info.map(label => ({ label, value: '' }))])),
        links: Object.fromEntries(Object.entries(saved.links || {}).map(([id, l]) => [id, Array.isArray(l) ? l : [l]])),
    };
}

export async function saveInfo(data) {
    await writeTracked(INFO_PATH, JSON.stringify({ sections: data.sections, links: data.links }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
}

export async function loadLocations() {
    const text = await readTracked(LOCATIONS_PATH);
    if (text === null) return [...DEFAULT_LOCATIONS];
    const list = JSON.parse(text).locations;
    return Array.isArray(list) ? list : [...DEFAULT_LOCATIONS];
}

export async function saveLocations(list) {
    await writeTracked(LOCATIONS_PATH, JSON.stringify({ locations: list }, null, 2) + '\n');
}
