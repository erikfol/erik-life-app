// 401(k): the plan's information and contributions (inputs/401k/401k.json), the balance history (balances.csv: each
// statement's period, starting balance, net transactions, investment returns and current balance), the investments (investments.csv) and the plan's documents (documents.csv,
// with the files in documents/). inputs/ is kept out of git.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const K_DIR = 'inputs/401k';
export const PLAN_PATH = `${K_DIR}/401k.json`;
export const BALANCES_PATH = `${K_DIR}/balances.csv`;
export const INVESTMENTS_PATH = `${K_DIR}/investments.csv`;
export const DOCUMENTS_PATH = `${K_DIR}/documents.csv`;
export const DOCUMENTS_DIR = `${K_DIR}/documents`;

// The information fields the plan starts with (any can be renamed, removed or reordered). What you put in and the
// employer match are in the plan's `contributions` (the Overview's Contributions box).
export const FIELDS = ['Plan Provider', 'Employer', 'Website', 'Account Number', 'Vesting', 'Beneficiaries', 'Notes'];

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

// The period a statement's numbers cover (its "Show these returns"): the years before its date.
export const RETURN_PERIODS = ['1-year', '3-year', '5-year', '10-year'];
export const periodYears = v => (RETURN_PERIODS.includes(v) ? parseInt(v, 10) : NaN);

// Entries can cover overlapping periods, so their amounts aren't added up (no Total line).
export const BALANCE_COLUMNS = [
    { name: 'Date', kind: 'date', default: todayIso },
    { name: 'Show These Returns', kind: 'choice', default: '1-year' },
    { name: 'Starting Balance', kind: 'money', total: false },
    { name: 'Net Transactions', kind: 'money', total: false }, // what went in less what came out (contributions, withdrawals, fees)
    { name: 'Investment Returns', kind: 'money', total: false },
    { name: 'Current Balance', kind: 'money', total: false },
];
export const BALANCE_CHOICES = { 'Show These Returns': { list: RETURN_PERIODS, noun: 'period' } };

export const INVESTMENT_COLUMNS = [
    { name: 'Fund', kind: 'suggest' },
    { name: 'Ticker', kind: 'suggest' },
    { name: '% of Balance', kind: 'number' },
    { name: 'Expense Ratio %', kind: 'number' },
    { name: 'Notes', kind: 'text' },
];

export const DOCUMENT_COLUMNS = [
    { name: 'Date', kind: 'date', default: todayIso },
    { name: 'Document', kind: 'suggest', suggestions: ['Statement', 'Summary Plan Description', 'Fee disclosure', 'Beneficiary form',
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
 * The entries with a date and a current balance, oldest first: [{ row, date ('YYYY-MM-DD'), period ('1-year' … or ''),
 * from (the period's first day, or null), start, net, returns, balance }] (start NaN when not typed; net and returns 0).
 * A blank current balance is worked out from the other three when they're all there. Entries on the same day count
 * from the bottom of the table up (a new entry goes at the top).
 */
export function ledger(rows) {
    return rows.map((row, i) => {
        const start = amountOf(row['Starting Balance']), net = amountOf(row['Net Transactions']), returns = amountOf(row['Investment Returns']);
        const typed = amountOf(row['Current Balance']);
        const balance = Number.isFinite(typed) ? typed : [start, net, returns].every(Number.isFinite) ? start + net + returns : NaN;
        const date = /^\d{4}-\d{2}-\d{2}$/.test(row.Date) ? row.Date : null, years = periodYears(row['Show These Returns']);
        // The same day `years` years before (Feb 29 → Feb 28).
        const from = date && years ? (d => (d.getDate() === +date.slice(8) ? isoOf(d) : isoOf(new Date(d.getFullYear(), d.getMonth(), 0))))(
            new Date(+date.slice(0, 4) - years, +date.slice(5, 7) - 1, +date.slice(8))) : null;
        return { row, i, date, period: years ? row['Show These Returns'] : '', from, start, net: net || 0, returns: returns || 0, balance };
    })
        .filter(p => p.date && Number.isFinite(p.balance))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.i - a.i));
}

/** Entries whose starting balance + net transactions + investment returns isn't their current balance (a typo?). */
export const notAddingUp = pts => pts.filter(p => Number.isFinite(p.start) && Number.isFinite(amountOf(p.row['Current Balance']))
    && Math.abs(p.start + p.net + p.returns - p.balance) > 0.5);

const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Every balance the entries give, oldest first: [{ date, balance, kind: 'current' | 'start', entry }] — each entry's
 * current balance on its date, and its starting balance on the first day of its period. One per day (a current
 * balance wins).
 */
export function balancePoints(pts) {
    const byDate = new Map();
    for (const p of pts) byDate.set(p.date, { date: p.date, balance: p.balance, kind: 'current', entry: p });
    for (const p of pts) {
        if (p.from && Number.isFinite(p.start) && !byDate.has(p.from)) byDate.set(p.from, { date: p.from, balance: p.start, kind: 'start', entry: p });
    }
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * What the history comes to (null without any entries): the latest entry (last), the balance before it (prev: the
 * latest earlier balance point, or null), every balance point, and the latest entry for each period (byPeriod, in
 * RETURN_PERIODS order).
 */
export function summary(pts) {
    if (!pts.length) return null;
    const last = pts.at(-1), points = balancePoints(pts);
    return {
        last, prev: points.filter(b => b.date < last.date).at(-1) || null, points,
        byPeriod: RETURN_PERIODS.map(name => pts.filter(p => p.period === name).at(-1)).filter(Boolean),
    };
}

// The most you can put in each year (the employer's money doesn't count toward it), the extra allowed from the year you
// turn 50 (catchUp), and the larger extra at 60–63 (catchUp6063). From the IRS; add each new year when it's announced.
export const IRS_LIMITS = {
    2025: { base: 23500, catchUp: 7500, catchUp6063: 11250 },
    2026: { base: 24500, catchUp: 8000, catchUp6063: 11250 },
};

/**
 * The limit for `year`, or the latest one known before it (announced: false) when the IRS hasn't said yet. With a birth
 * year, also the catch-up for the age you turn that year (extra: 0 under 50) and your total; without, extra is NaN.
 */
export function irsLimit(year, birthYear = NaN) {
    const years = Object.keys(IRS_LIMITS).map(Number).sort((a, b) => a - b);
    const y = years.filter(x => x <= year).at(-1) ?? years[0];
    const L = IRS_LIMITS[y], age = birthYear > 0 ? year - birthYear : NaN;
    const extra = !Number.isFinite(age) ? NaN : age >= 60 && age <= 63 ? L.catchUp6063 : age >= 50 ? L.catchUp : 0;
    return { ...L, year: y, announced: y === year, age, extra, total: L.base + (extra || 0) };
}

// ── Contributions (the plan's `contributions`): what you put in each paycheck and the employer match ──

export const CONTRIBUTION_TYPES = ['Pre-tax', 'Roth', 'Pre-tax + Roth'];

// How often you're paid, and how many paychecks that makes a year.
export const PAY_EVERY = [
    { id: 'week', label: 'Every week', perYear: 52 },
    { id: '2weeks', label: 'Every other week', perYear: 26 },
    { id: 'twice-month', label: 'Twice a month', perYear: 24 },
    { id: 'month', label: 'Every month', perYear: 12 },
];
export const payEvery = c => PAY_EVERY.find(p => p.id === c?.payEvery) || PAY_EVERY[1];

/** The match as words: '100% of the first 3% of pay, then 50% of the next 2%'; '' without one. */
export const matchText = tiers => tiers.map(([m, u], k) => `${+m}% of ${k ? 'the next' : 'the first'} ${+u}%${k ? '' : ' of pay'}`).join(', then ');

/**
 * What the contribution details work out to (c: the plan's `contributions`; any field can be blank):
 *   pct (your % of pay: typed, or worked out from the amount and gross pay), gross (pay per paycheck before taxes),
 *   mine ($ you put in a paycheck: typed, else pct × gross; mineWorkedOut when it's worked out), every / perYear,
 *   tiers ([[match %, up to % of pay], …]), fullAt (the % of pay that gets the whole match), employerPct / employer (the
 *   employer's % of pay and $ a paycheck at your pct), maxEmployerPct / maxEmployer (the most the match pays).
 */
export function contributionMath(c = {}) {
    const n = v => amountOf(v);
    const gross = n(c.grossPay), typed = n(c.amount), every = payEvery(c);
    const pct = Number.isFinite(n(c.percent)) ? n(c.percent) : gross > 0 && Number.isFinite(typed) ? typed / gross * 100 : NaN;
    const mine = Number.isFinite(typed) ? typed : gross > 0 && Number.isFinite(pct) ? gross * pct / 100 : NaN;
    const tiers = [[n(c.matchPercent), n(c.matchUpTo)], [n(c.match2Percent), n(c.match2UpTo)]].filter(([m, u]) => m > 0 && u > 0);
    // The employer's % of pay when you put in p% (each tier matches its share of the next part of your pay).
    const matchAt = p => tiers.reduce((t, [m, u], k) => {
        const before = tiers.slice(0, k).reduce((s, x) => s + x[1], 0);
        return t + Math.max(0, Math.min(p - before, u)) * m / 100;
    }, 0);
    const fullAt = tiers.reduce((t, [, u]) => t + u, 0);
    const employerPct = tiers.length && Number.isFinite(pct) ? matchAt(pct) : NaN, maxEmployerPct = tiers.length ? matchAt(fullAt) : NaN;
    return {
        pct, gross, mine, mineWorkedOut: !Number.isFinite(typed) && Number.isFinite(mine), every, perYear: every.perYear,
        tiers, fullAt, employerPct, maxEmployerPct,
        employer: gross > 0 ? gross * employerPct / 100 : NaN, maxEmployer: gross > 0 ? gross * maxEmployerPct / 100 : NaN,
    };
}

const dayOf = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };

/**
 * The paydays from `from` (a Date, counted) to Dec 31 of its year: { count, next, estimated }. Worked out from any one
 * payday (c.payday) and how often; twice a month means that day and the one 15 days from it. Without a payday, the
 * count is the year's share of paychecks for the days left (estimated: true, next: null).
 */
export function paydaysLeft(c, from) {
    const t0 = new Date(from); t0.setHours(0, 0, 0, 0);
    const year = t0.getFullYear(), end = new Date(year, 11, 31), every = payEvery(c), d0 = dayOf(c?.payday);
    if (!d0) {
        const days = Math.round((end - t0) / 864e5) + 1, inYear = Math.round((new Date(year + 1, 0, 1) - new Date(year, 0, 1)) / 864e5);
        return { count: Math.round(every.perYear * days / inYear), next: null, estimated: true };
    }
    const out = [];
    if (every.id === 'week' || every.id === '2weeks') {
        const step = every.id === 'week' ? 7 : 14, d = new Date(d0);
        d.setDate(d.getDate() + Math.ceil(Math.round((t0 - d0) / 864e5) / step) * step); // the first payday on or after t0
        for (; d <= end; d.setDate(d.getDate() + step)) out.push(new Date(d));
    } else {
        const day = d0.getDate(), days = every.id === 'month' ? [day] : [day, day <= 15 ? day + 15 : day - 15];
        for (let m = t0.getMonth(); m <= 11; m++) for (const dd of days) {
            const d = new Date(year, m, Math.min(dd, new Date(year, m + 1, 0).getDate()));
            if (d >= t0) out.push(d);
        }
        out.sort((a, b) => a - b);
    }
    return { count: out.length, next: out[0] || null, estimated: false };
}

/** This year's paychecks: { total, soFar (through today), left (after today), estimated (no payday to count from) }. */
export function yearPaychecks(c, now = new Date()) {
    const year = now.getFullYear(), tomorrow = new Date(now); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
    const all = paydaysLeft(c, new Date(year, 0, 1));
    const left = tomorrow.getFullYear() > year ? 0 : paydaysLeft(c, tomorrow).count;
    return { total: all.count, soFar: all.count - left, left, estimated: all.estimated };
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
