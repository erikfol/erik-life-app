// Taxes: each year's return (returns.csv: when it was filed and by whom, the refund or what was owed, the preparer's
// fee, when the refund came in, and the return itself in returns/), the information and websites (taxes.json), and for
// each tax year the documents to gather (<year>-documents.csv, their files in documents/<year>/) and the things to
// remember for that return (<year>-notes.csv, receipts in notes/<year>/). inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const T_DIR = 'inputs/taxes';
export const DATA_PATH = `${T_DIR}/taxes.json`;
export const RETURNS_PATH = `${T_DIR}/returns.csv`;
export const RETURNS_DIR = `${T_DIR}/returns`;
export const documentsPath = y => `${T_DIR}/${y}-documents.csv`;
export const documentsDir = y => `${T_DIR}/documents/${y}`;
export const notesPath = y => `${T_DIR}/${y}-notes.csv`;
export const notesDir = y => `${T_DIR}/notes/${y}`;

const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const dateOf = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim()); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
export const longDate = d => `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
/** '12,345.67', '$12,345.67' → 12345.67; blank or anything else → NaN. */
export const amountOf = v => { const s = String(v ?? '').replace(/[$,\s]/g, ''); return s === '' ? NaN : Number(s); };

// The information fields it starts with (any can be renamed, removed or reordered), and the websites (each with an
// optional sign-in hint) on the information's heading.
export const FIELDS = ['Filing Status', 'Tax Preparer', 'Preparer Phone', 'State', 'Dependents', 'Notes'];
export const DEFAULT_LINKS = [
    { linkText: 'IRS online account', url: 'https://www.irs.gov/payments/your-online-account', hint: '' },
    { linkText: "Where's My Refund", url: 'https://www.irs.gov/wheres-my-refund', hint: '' },
];

/**
 * The tax year whose documents you're gathering: last year's from January to April (its return is due in April), this
 * year's from May on (things to remember for it come up all year).
 */
export const workingYear = (now = new Date()) => String(now.getMonth() <= 3 ? now.getFullYear() - 1 : now.getFullYear());

/** taxes.json: { info: [{label, value}], links: [{linkText, url, hint}], years: ['2026', …] (the Documents pages, oldest first) }. */
export async function loadData(track = true) {
    const text = track ? await readTracked(DATA_PATH) : await fs.readText(DATA_PATH);
    const d = text === null ? {} : JSON.parse(text);
    return {
        ...d,
        info: Array.isArray(d.info) ? d.info : FIELDS.map(label => ({ label, value: '' })),
        links: Array.isArray(d.links) ? d.links : DEFAULT_LINKS,
        years: Array.isArray(d.years) && d.years.length ? d.years.map(String) : [workingYear()],
    };
}

export async function saveData(data) {
    await writeTracked(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
}

// ── Tax returns: one row a tax year ──────────────────────────────────────────

/** Not filed / Waiting for refund / Done, from what's filled in. */
export function returnStatus(r) {
    if (!dateOf(r['Filed On'])) return 'Not filed';
    return amountOf(r.Refund) > 0 && !dateOf(r['Refund Received']) ? 'Waiting for refund' : 'Done';
}
export const RETURN_COLUMNS = [
    { name: 'Tax Year', kind: 'suggest', default: () => String(new Date().getFullYear() - 1) },
    { name: 'Status', kind: 'text', calc: returnStatus, badge: v => (v === 'Done' ? 'due-ok' : 'due-yellow') },
    { name: 'Filed On', kind: 'date' },
    { name: 'Prepared By', kind: 'suggest', suggestions: ['H&R Block', 'TurboTax', 'FreeTaxUSA', 'A tax preparer', 'Myself'] },
    { name: 'Refund', kind: 'money' },
    { name: 'Amount Owed', kind: 'money' },
    { name: 'Prep Fee', kind: 'money' },
    { name: 'Refund Received', kind: 'date' },
    { name: 'Notes', kind: 'text' },
    { name: 'Return', kind: 'files', noun: 'return' },
];

// ── Each tax year: documents to gather, and things to remember ───────────────

export const DOC_STATUSES = ['Waiting', 'Received', 'Not needed'];
export const DOCUMENT_COLUMNS = [
    { name: 'Document', kind: 'suggest', suggestions: ['W-2', '1098 Mortgage interest', '1099-INT Interest', '1099-DIV Dividends', '1099-B Investments',
        '1099-R Retirement', '1099-SA HSA withdrawals', '5498-SA HSA contributions', '1099-G', '1099-NEC', '1095-C Health coverage',
        'Property tax bills', 'Child care statement', 'Charitable donation receipts', "Last year's return"] },
    { name: 'From', kind: 'suggest' },
    { name: 'Expected By', kind: 'suggest', suggestions: ['Jan 31', 'Feb 15', 'Mar 15', 'May 31'] },
    { name: 'Status', kind: 'choice', default: 'Waiting', badge: v => (v === 'Received' ? 'due-ok' : v === 'Waiting' ? 'due-yellow' : '') },
    { name: 'Notes', kind: 'text' },
    { name: 'Files', kind: 'files', noun: 'document' },
];
export const DOCUMENT_CHOICES = { Status: { list: DOC_STATUSES, noun: 'status' } };
/** The list a tax year starts with when there's no earlier year to copy. */
export const DEFAULT_DOCUMENTS = [
    ['W-2', 'Employer', 'Jan 31', 'Wages and what was withheld'],
    ['1098 Mortgage interest', 'Mortgage lender', 'Jan 31', ''],
    ['1099-INT Interest', 'Bank', 'Jan 31', 'Savings interest'],
    ['1099-SA HSA withdrawals', 'HSA provider', 'Jan 31', ''],
    ['5498-SA HSA contributions', 'HSA provider', 'May 31', 'Comes after the deadline; not needed to file'],
    ['1095-C Health coverage', 'Employer', '', 'Keep with the return; not needed to file'],
    ['Property tax bills', 'Town', '', 'What was paid in the year'],
    ['Child care statement', 'Daycare', '', "Provider's name, address, tax ID and what was paid"],
    ['Charitable donation receipts', '', '', ''],
    ["Last year's return", '', '', "Last year's numbers, e.g. the AGI"],
].map(([Document, From, expected, Notes]) => ({ Document, From, 'Expected By': expected, Status: 'Waiting', Notes, Files: '' }));
/** A new tax year's list from the year before's: the same documents, all Waiting again (Not needed stays), no files. */
export const nextYearDocuments = rows => rows.map(r => ({ ...r, Status: r.Status === 'Not needed' ? 'Not needed' : 'Waiting', Files: '' }));

export const NOTE_COLUMNS = [
    { name: 'Date', kind: 'date', default: todayIso },
    { name: 'What', kind: 'suggest', suggestions: ['Donation', 'Medical expense', 'Energy improvement', 'Child care', 'Life change', 'Question for the preparer'] },
    { name: 'Description', kind: 'text' },
    { name: 'Amount', kind: 'money' },
    { name: 'Receipts', kind: 'files', noun: 'receipt' },
];

/** missing: what a file that isn't there yet gives. */
async function loadCsv(path, columns, track, missing = []) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return missing;
    const names = columns.filter(c => !c.calc).map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}
async function saveCsv(path, columns, rows) {
    await writeTracked(path, toCSV(columns.filter(c => !c.calc).map(c => c.name), rows));
}
export const loadReturns = (track = true) => loadCsv(RETURNS_PATH, RETURN_COLUMNS, track);
export const saveReturns = rows => saveCsv(RETURNS_PATH, RETURN_COLUMNS, rows);
/** A year's documents; null when its list hasn't been saved yet. */
export const loadDocuments = (y, track = true) => loadCsv(documentsPath(y), DOCUMENT_COLUMNS, track, null);
export const saveDocuments = (y, rows) => saveCsv(documentsPath(y), DOCUMENT_COLUMNS, rows);
export const loadNotes = (y, track = true) => loadCsv(notesPath(y), NOTE_COLUMNS, track);
export const saveNotes = (y, rows) => saveCsv(notesPath(y), NOTE_COLUMNS, rows);

/** How far a documents list is: { received, needed (all but Not needed), waiting: [rows] }. */
export function docsProgress(rows) {
    const needed = (rows || []).filter(r => r.Status !== 'Not needed');
    const waiting = needed.filter(r => r.Status !== 'Received');
    return { received: needed.length - waiting.length, needed: needed.length, waiting };
}

// ── The filing deadline and where this season's return stands ───────────────

/**
 * Tax year `y`'s filing deadline: April 15 of the next year, moved to the next business day past a weekend or DC's
 * Emancipation Day (April 16, kept on the Friday before or the Monday after when it falls on a weekend). With an
 * extension: October 15, moved past a weekend.
 */
export function dueDate(y, extension = false) {
    const Y = +y + 1, weekend = d => d.getDay() === 0 || d.getDay() === 6;
    if (extension) { let d = new Date(Y, 9, 15); while (weekend(d)) d = new Date(Y, 9, d.getDate() + 1); return d; }
    const em = new Date(Y, 3, 16), holiday = em.getDay() === 6 ? new Date(Y, 3, 15) : em.getDay() === 0 ? new Date(Y, 3, 17) : em;
    let d = new Date(Y, 3, 15);
    while (weekend(d) || d.getTime() === holiday.getTime()) d = new Date(Y, 3, d.getDate() + 1);
    return d;
}
/** A return with "extension" in its Notes is due in October. */
export const hasExtension = r => /\bextension\b/i.test(r?.Notes || '');
/** Days after filing a refund is expected by (most e-filed refunds come within 21 days). */
export const REFUND_DAYS = 21;

/**
 * Where this season's return stands: last year's (the tax year before this one). The Overview's banner, the menu colour
 * and the Home page's count. { level: 'red' | 'yellow' | 'ok' | null (no count), year, row, due, days, text }.
 *   Filed: ok, or yellow REFUND_DAYS after filing while a refund hasn't come in (no Refund Received).
 *   Not filed: January no count, from February 1 yellow, from April 1 red, and past the deadline red (with an extension:
 *   yellow 45 days before October's deadline, red 14). Not in Tax returns at all after the deadline: yellow, add it.
 */
export function seasonStatus(returns, now = new Date()) {
    const t0 = startOfDay(now), year = String(t0.getFullYear() - 1);
    const row = returns.find(r => String(r['Tax Year']).trim() === year) || null;
    const ext = hasExtension(row), due = dueDate(year, ext), days = Math.round((due - t0) / DAY);
    const base = { year, row, due, days, extension: ext };
    const filed = row && dateOf(row['Filed On']);
    if (filed) {
        const since = Math.round((t0 - filed) / DAY);
        if (returnStatus(row) === 'Waiting for refund' && since >= REFUND_DAYS) {
            return { ...base, level: 'yellow', kind: 'refund', text: `${year} refund not received yet: filed ${longDate(filed)}, ${since} days ago` };
        }
        return { ...base, level: 'ok', kind: 'filed', text: `${year} return filed ${longDate(filed)}` };
    }
    if (!row && days < 0) return { ...base, level: 'yellow', kind: 'missing', text: `Add your ${year} return to Tax returns (it was due ${longDate(due)})` };
    if (days < 0) return { ...base, level: 'red', kind: 'late', text: `${year} return past due: it was due ${longDate(due)}` };
    const level = ext ? (days <= 14 ? 'red' : days <= 45 ? 'yellow' : null)
        : t0 >= new Date(t0.getFullYear(), 3, 1) ? 'red' : t0.getMonth() >= 1 ? 'yellow' : null;
    return { ...base, level, kind: 'due', text: `${year} return not filed yet: due ${longDate(due)}${ext ? ' (extension)' : ''}, ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}` };
}
