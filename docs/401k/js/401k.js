// 401(k): the plan's information (inputs/401k/401k.json), the balance history (balances.csv: one entry per statement or
// check-in, with what went in since the entry before), the investments (investments.csv) and the plan's documents
// (documents.csv, with the files in documents/). inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const K_DIR = 'inputs/401k';
export const PLAN_PATH = `${K_DIR}/401k.json`;
export const BALANCES_PATH = `${K_DIR}/balances.csv`;
export const INVESTMENTS_PATH = `${K_DIR}/investments.csv`;
export const DOCUMENTS_PATH = `${K_DIR}/documents.csv`;
export const STATEMENTS_DIR = `${K_DIR}/statements`;
export const DOCUMENTS_DIR = `${K_DIR}/documents`;

// The information fields the plan starts with (any can be renamed, removed or reordered).
export const FIELDS = ['Plan Provider', 'Employer', 'Website', 'Account Number', 'Your Contribution', 'Pre-tax or Roth',
    'Employer Match', 'Vesting', 'Beneficiaries', 'Notes'];

/** track: false for read-only use (the Home page's counts), so the save guard keeps the version this page is editing. */
export async function loadPlan(track = true) {
    const text = track ? await readTracked(PLAN_PATH) : await fs.readText(PLAN_PATH);
    const plan = text === null ? {} : JSON.parse(text);
    return { ...plan, info: Array.isArray(plan.info) ? plan.info : FIELDS.map(label => ({ label, value: '' })) };
}

export async function savePlan(plan) {
    await writeTracked(PLAN_PATH, JSON.stringify(plan, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved'));
}

const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

export const BALANCE_COLUMNS = [
    { name: 'Date', kind: 'date', default: todayIso },
    { name: 'Balance', kind: 'money', total: false },
    { name: 'You Put In', kind: 'money' },
    { name: 'Employer Put In', kind: 'money' },
    { name: 'Notes', kind: 'text' },
    { name: 'Statement', kind: 'files', noun: 'statement' },
];

export const INVESTMENT_COLUMNS = [
    { name: 'Fund', kind: 'suggest' },
    { name: 'Ticker', kind: 'suggest' },
    { name: '% of Balance', kind: 'number' },
    { name: 'Expense Ratio %', kind: 'number' },
    { name: 'Notes', kind: 'text' },
];

export const DOCUMENT_COLUMNS = [
    { name: 'Date', kind: 'date', default: todayIso },
    { name: 'Document', kind: 'suggest', suggestions: ['Summary Plan Description', 'Fee disclosure', 'Beneficiary form',
        'Enrollment', 'Contribution change', 'Rollover', '1099-R'] },
    { name: 'Notes', kind: 'text' },
    { name: 'Files', kind: 'files', noun: 'document' },
];

async function loadCsv(path, columns, track) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return [];
    const names = columns.map(c => c.name);
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

async function saveCsv(path, columns, rows) {
    await writeTracked(path, toCSV(columns.map(c => c.name), rows));
    window.dispatchEvent(new Event('data-saved'));
}

export const loadBalances = (track = true) => loadCsv(BALANCES_PATH, BALANCE_COLUMNS, track);
export const saveBalances = rows => saveCsv(BALANCES_PATH, BALANCE_COLUMNS, rows);
export const loadInvestments = () => loadCsv(INVESTMENTS_PATH, INVESTMENT_COLUMNS, true);
export const saveInvestments = rows => saveCsv(INVESTMENTS_PATH, INVESTMENT_COLUMNS, rows);
export const loadDocuments = () => loadCsv(DOCUMENTS_PATH, DOCUMENT_COLUMNS, true);
export const saveDocuments = rows => saveCsv(DOCUMENTS_PATH, DOCUMENT_COLUMNS, rows);

/** '12,345.67', '$12,345.67' → 12345.67; blank or anything else → NaN. */
export const amountOf = v => { const s = String(v ?? '').replace(/[$,\s]/g, ''); return s === '' ? NaN : Number(s); };

/**
 * The entries with a date and a balance, oldest first: [{ row, date ('YYYY-MM-DD'), balance, mine, employer, growth }].
 * growth: the change in balance since the entry before that wasn't money put in (gains, losses and fees); NaN for the
 * first. Entries on the same day count from the bottom of the table up (a new entry goes at the top).
 */
export function ledger(rows) {
    const pts = rows.map((row, i) => ({ row, i, date: /^\d{4}-\d{2}-\d{2}$/.test(row.Date) ? row.Date : null, balance: amountOf(row.Balance),
        mine: amountOf(row['You Put In']) || 0, employer: amountOf(row['Employer Put In']) || 0 }))
        .filter(p => p.date && Number.isFinite(p.balance))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.i - a.i));
    pts.forEach((p, k) => { p.growth = k ? p.balance - pts[k - 1].balance - p.mine - p.employer : NaN; });
    return pts;
}

/**
 * What the history adds up to (null without any entries): the first and latest entries, what went in after the first
 * (you, employer) and the growth since it; and this year's: what you and the employer put in, and the growth.
 */
export function summary(pts, now = new Date()) {
    if (!pts.length) return null;
    const total = (list, f) => list.reduce((t, p) => t + f(p), 0);
    const first = pts[0], last = pts.at(-1), later = pts.slice(1);
    const year = now.getFullYear(), thisYear = pts.filter(p => p.date.startsWith(`${year}-`));
    const mine = total(later, p => p.mine), employer = total(later, p => p.employer);
    return {
        first, last, prev: pts.at(-2) || null, mine, employer, growth: last.balance - first.balance - mine - employer,
        year, ytdMine: total(thisYear, p => p.mine), ytdEmployer: total(thisYear, p => p.employer),
        ytdGrowth: total(thisYear.filter(p => Number.isFinite(p.growth)), p => p.growth), ytdLast: thisYear.at(-1) || null,
    };
}

// The most you can put in each year (the employer's money doesn't count toward it), the extra allowed from the year you
// turn 50 (catchUp), and the larger extra at 60–63 (catchUp6063). From the IRS; add each new year when it's announced.
export const IRS_LIMITS = {
    2025: { base: 23500, catchUp: 7500, catchUp6063: 11250 },
    2026: { base: 24500, catchUp: 8000, catchUp6063: 11250 },
};

/** The limit for `year`, or the latest one known before it (announced: false) when the IRS hasn't said yet. */
export function irsLimit(year) {
    const years = Object.keys(IRS_LIMITS).map(Number).sort((a, b) => a - b);
    const y = years.filter(x => x <= year).at(-1) ?? years[0];
    return { ...IRS_LIMITS[y], year: y, announced: y === year };
}

// The balance should be updated about monthly (a statement comes at least every quarter): yellow after 45 days, red after 100.
export const STALE_DAYS = 45;
export const VERY_STALE_DAYS = 100;

/** Days since the latest entry (null without any). */
export function daysSinceUpdate(pts, now = new Date()) {
    if (!pts.length) return null;
    const [y, m, d] = pts.at(-1).date.split('-').map(Number);
    const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((t0 - new Date(y, m - 1, d)) / 864e5));
}
