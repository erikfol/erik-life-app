// Bills Etc's files: where they are and how they're read.
import * as fs from '../../shared/js/fs.js';
import { parseCSV, toCSV } from '../../shared/js/csv.js';
import { normalizeDateCell, parseDate } from '../../shared/js/dates.js';
import { amountOf } from '../../shared/js/util.js';

export const PATHS = {
    pastMonths: 'inputs/past_months',
    currentMonth: 'inputs/current_month',
    master: 'output_master_data/all_time_finances.csv',
    processed: 'output_master_data/processed_current_month.csv',
    cache: 'output_master_data/categorized_cache.csv',
    config: 'config.json',
};

export const MASTER_COLS = ['Transaction Type', 'Date', 'Description', 'Amount',
    'Reference No.', 'Credits', 'Debits', 'Cleaned Merchant', 'AI Category', 'Notes'];
export const CACHE_COLS = ['Date', 'Description', 'Amount', 'AI Category', 'Cleaned Merchant'];

const SENSITIVE = ['account', 'routing', 'balance', 'card number', 'ssn', 'address'];

export async function readTable(path) {
    const text = await fs.readText(path);
    return text == null ? null : parseCSV(text);
}

export async function writeTable(path, table) {
    await fs.writeText(path, toCSV(table.columns, table.rows));
}

/** Read a raw bank export: drop sensitive columns and normalize dates to DD-Mmm-YY. */
export async function readBankCsv(path) {
    const table = await readTable(path);
    const dropped = table.columns.filter(c => SENSITIVE.some(s => c.toLowerCase().includes(s)));
    const columns = table.columns.filter(c => !dropped.includes(c));
    const rows = table.rows.map(r => {
        const o = Object.fromEntries(columns.map(c => [c, r[c]]));
        if ('Date' in o) o.Date = normalizeDateCell(o.Date);
        return o;
    });
    return { columns, rows, dropped };
}

/** Dedup key: date → DD-Mmm-YY, amount → 2dp, description trimmed of whitespace/quotes. */
export function rowKey(date, desc, amount) {
    const d = parseDate(date);
    const dateStr = d ? normalizeDateCell(date) : String(date ?? '').trim();
    const a = amountOf(amount);
    const amtStr = Number.isFinite(a) ? a.toFixed(2) : String(amount ?? '').trim();
    const descStr = String(desc ?? '').trim().replace(/^"+|"+$/g, '');
    return `${dateStr}\u0001${descStr}\u0001${amtStr}`;
}

export const keyOf = r => rowKey(r.Date, r.Description, r.Amount);

export async function loadConfig() {
    const text = await fs.readText(PATHS.config);
    if (text == null) return null;
    return JSON.parse(text);
}

/** Income, fixed expenses and variable categories from config.json; keys starting with _ are notes and are ignored. */
export function parseConfig(cfg) {
    const isNum = v => typeof v === 'number' && Number.isFinite(v);
    const income = Object.entries(cfg)
        .filter(([k, v]) => k.startsWith('monthly_income') && isNum(v))
        .reduce((a, [, v]) => a + v, 0);
    const fixed = Object.fromEntries(Object.entries(cfg.fixed_expenses || {})
        .filter(([k, v]) => !k.startsWith('_') && isNum(v)));
    const variableCats = (cfg.variable_categories || []).filter(c => typeof c === 'string' && !c.startsWith('_'));
    return { income, fixed, variableCats };
}

/** Monthly income sources ([name, amount a month]) from the `monthly_income_<name>` keys (kept in step by the Income page). */
export const incomeSources = cfg => Object.entries(cfg || {})
    .filter(([k, v]) => k.startsWith('monthly_income') && typeof v === 'number')
    .map(([k, v]) => [k.replace(/^monthly_income_?/, '').replace(/_/g, ' '), v]);

export const incomeKey = name => 'monthly_income_' + name.trim().replace(/\s+/g, '_');

/** A copy of cfg with its income keys replaced by `list` ([name, amount]), where the first one was, followed by `extra`'s
 * keys (key order and `_` notes kept). */
export function withIncomes(cfg, list, extra = {}) {
    const out = {};
    let written = false;
    const write = () => {
        for (const [name, v] of list) out[incomeKey(name)] = v;
        Object.assign(out, extra);
        written = true;
    };
    for (const [k, v] of Object.entries(cfg)) {
        if (k in extra) continue;
        if (k.startsWith('monthly_income') && typeof v === 'number') { if (!written) write(); continue; }
        out[k] = v;
    }
    if (!written) write();
    return out;
}

/** How often a source pays: `month` = paychecks in most months (what "per month" counts), `year` = paychecks a year. */
export const PAY_EVERY = {
    weekly: { label: 'Every week', month: 4, year: 52 },
    biweekly: { label: 'Every 2 weeks', month: 2, year: 26 },
    semimonthly: { label: 'Twice a month', month: 2, year: 24 },
    monthly: { label: 'Once a month', month: 1, year: 12 },
};

/** Income sources as entered on the Income page, [{ name, perPay, every }]: config.json `income_sources`, or before that
 * existed, one payment a month from each `monthly_income_*`. */
export function paySources(cfg) {
    if (!Array.isArray(cfg?.income_sources)) return incomeSources(cfg).map(([name, v]) => ({ name, perPay: v, every: 'monthly' }));
    return cfg.income_sources.filter(s => s && typeof s.name === 'string' && s.name.trim())
        .map(s => ({ name: s.name.trim(), perPay: Number.isFinite(+s.per_pay) ? +s.per_pay : 0, every: PAY_EVERY[s.every] ? s.every : 'monthly' }));
}
export const perMonth = s => s.perPay * PAY_EVERY[s.every].month;
export const perYear = s => s.perPay * PAY_EVERY[s.every].year;

export const DEFAULT_CONFIG = {
    _readme: 'Bills Etc settings, changed on its Config, Income and Bills pages. Keys starting with _ are notes and are ignored.',
    _income_note: 'Your typical monthly take-home pay (after taxes). Do not count bonuses or tax refunds here.',
    monthly_income_tt: 0,
    fixed_expenses: {
        _note: 'Bills that hit every month for the same (or nearly the same) amount.',
    },
    variable_categories: [
        '_note: These categories are day-scaled from your partial month data to project the full month.',
        'Groceries', 'Dining Out', 'Entertainment', 'Shopping', 'Transport', 'Gas', 'Miscellaneous', 'Utilities',
    ],
    _projection_note: 'Projection formula (GUI): projected_variable = spent_so_far + days_left * (w * spent_so_far / days_elapsed + (1 - w) * historical_avg / days_in_month), w = days_elapsed / days_in_month (no history: pace alone). Fixed expenses are added on top regardless of partial data.',
};
