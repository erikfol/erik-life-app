// Everything the Home page's assistant knows, read once per conversation. Money that the app works out rather than stores
// (card and loan balances, savings, utility charges) comes from the same code the pages use, so the answers agree with
// them. Every value goes through the privacy filter (scrub.js) here, so nothing later can see the originals.
import * as fs from '../../../bills-etc/js/fs.js';
import { parseRecords } from '../../../bills-etc/js/csv.js';
import { parseBillDate } from '../../../bills-etc/js/sheet.js';
import { loadConfig } from '../../../bills-etc/js/data.js';
import { allTransactions, parseBills } from '../../../bills-etc/js/bills.js';
import { loadAccounts, loadPayments, loadActivity, ledger, hasMaintenance, loadFees, minimumOf, nextPaymentDate, estimatePayoff } from '../../../bills-etc/js/loans.js';
import { loadSavings, loadActivity as loadSavingsActivity, loadSettings, loadMoves, savingsLedger } from '../../../bills-etc/js/savings.js';
import { loadElectric } from '../../../bills-etc/js/electric.js';
import { loadWater } from '../../../bills-etc/js/water.js';
import { loadDeliveries } from '../../../bills-etc/js/heating.js';
import { loadPropane } from '../../../bills-etc/js/propane.js';
import { loadTaxes } from '../../../bills-etc/js/taxes.js';
import { scrubRow, scrubTree, scrubText } from './scrub.js';

// The folders under inputs/ read as they are, each as its own source per file. A new section's folder goes here.
const FOLDERS = [
    ['401k', '401(k)'], ['taxes', 'Taxes'], ['health', 'Health'], ['vehicles', 'Vehicles'], ['house', 'House'], ['pets', 'Pets'],
    ['insurance', 'Insurance'], ['dinner-planner', 'Dinner Planner'], ['kid-lunches', 'Kid Lunches'], ['gifts', 'Gifts, birthdays and anniversaries'],
    ['career', 'Working career'], ['electric', 'Electric'], ['heat_home', 'Home heating'], ['forgettable_subs', 'Forgettable subscriptions'],
];
// Read through the app's own code below instead, or an internal copy of what's in another source.
const SKIP = /^inputs\/(electric\/master_electric\.csv|heat_home\/master_heat_home\.csv|dinner-planner\/db\.json)$/;

const iso = d => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
const dollars = n => (Number.isFinite(n) ? `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'unknown');

/** A date in any of the sheets' formats → YYYY-MM-DD, so dates can be compared and grouped; anything else unchanged. */
export function tidyCell(v) {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (/\d/.test(s) && s.length <= 20 && !/^[\d.,$-]+$/.test(s.replace(/^\d{4}-\d{1,2}-\d{1,2}$/, 'x'))) {
        const d = parseBillDate(s);
        if (d) return iso(d);
    }
    return s;
}

/** An object from the app's loaders as a flat row: dates as YYYY-MM-DD, nothing nested or internal. */
function plain(o, skip = []) {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
        if (skip.includes(k) || k.startsWith('_')) continue;
        if (v instanceof Date) out[k] = iso(v);
        else if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : '';
        else if (typeof v === 'boolean') out[k] = v ? 'yes' : 'no';
        else if (Array.isArray(v) || typeof v === 'function') continue;
        else if (v && typeof v === 'object') Object.entries(plain(v)).forEach(([k2, x]) => { out[`${k}.${k2}`] = x; });
        else out[k] = v ?? '';
    }
    return out;
}

function parseTable(text) {
    const firstLine = text.split('\n', 1)[0];
    const count = ch => firstLine.split(ch).length;
    const records = parseRecords(text, count('\t') > count(',') ? '\t' : ',');
    if (!records.length) return [];
    const columns = records[0].map((h, j) => h.trim() || `Column ${j + 1}`);
    return records.slice(1).map(r => Object.fromEntries(columns.map((c, j) => [c, tidyCell(r[j] ?? '')])));
}

function tableSource(id, section, about, rows) {
    const clean = rows.map(scrubRow);
    const columns = [...new Set(clean.flatMap(r => Object.keys(r)))];
    const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
    const dateColumn = columns.find(c => clean.some(r => isDay(r[c]))) || null;
    const days = dateColumn ? clean.map(r => r[dateColumn]).filter(isDay).sort() : [];
    return {
        id, section, about, kind: 'table', rows: clean, columns, dateColumn, from: days[0] || '', to: days.at(-1) || '',
        items: clean.map(row => ({ row, text: Object.values(row).join(' ').toLowerCase() })),
    };
}

/** Each object in a document with its own simple values, as one searchable item (so a value stays with its label). */
function documentItems(node, path = '', out = []) {
    if (Array.isArray(node)) node.forEach((x, i) => documentItems(x, `${path}[${i}]`, out));
    else if (node && typeof node === 'object') {
        const own = {};
        for (const [k, v] of Object.entries(node)) {
            if (v && typeof v === 'object' && !(Array.isArray(v) && v.every(x => typeof x !== 'object'))) documentItems(v, path ? `${path}.${k}` : k, out);
            else own[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        if (Object.values(own).some(v => v !== '' && v != null)) {
            out.push({ row: { path, ...own }, text: Object.entries(own).map(([k, v]) => `${k} ${v}`).join(' ').toLowerCase() });
        }
    }
    return out;
}

function documentSource(id, section, about, data) {
    const tree = scrubTree(data);
    return { id, section, about, kind: 'document', tree, items: documentItems(tree), parts: tree && typeof tree === 'object' ? Object.keys(tree) : [] };
}

async function mapLimit(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (next < items.length) { const k = next++; out[k] = await fn(items[k]); }
    }));
    return out;
}

async function folderSources() {
    const lists = await mapLimit(FOLDERS, 6, async ([folder, label]) => {
        const dir = `inputs/${folder}`;
        const csv = await fs.listFiles(dir, '.csv'), json = await fs.listFiles(dir, '.json');
        const base = name => name.replace(/\.[^.]+$/, '');
        return [...csv, ...json].map(name => ({
            path: `${dir}/${name}`, folder, label, name, title: base(name),
            id: `${folder}/${base(name)}${name.endsWith('.json') && csv.includes(`${base(name)}.csv`) ? '-details' : ''}`, // lunches.csv and lunches.json
        })).filter(f => !SKIP.test(f.path));
    });
    return mapLimit(lists.flat(), 8, async ({ path, folder, label, name, title, id }) => {
        const about = `${label}: ${title.replace(/[-_]/g, ' ')}`;
        try {
            const text = await fs.readText(path);
            return name.endsWith('.json') ? documentSource(id, folder, about, JSON.parse(text)) : tableSource(id, folder, about, parseTable(text));
        } catch (e) {
            return { id, section: folder, about, kind: 'table', rows: [], columns: [], error: e.message };
        }
    });
}

async function accountSources() {
    const accounts = await loadAccounts();
    const all = await Promise.all(accounts.map(async a => {
        const [payments, activity] = await Promise.all([loadPayments(a), loadActivity(a)]);
        return { a, L: ledger(a, payments, activity), fees: hasMaintenance(a) ? await loadFees(a, false) : [] };
    }));
    const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const summary = all.map(({ a, L }) => {
        const payoff = estimatePayoff(a, L, now);
        return plain({
            Account: a.title, Type: a.type, 'Loan kind': a.loanKind, Lender: a.lender, 'Balance now': L.balanceNow,
            'APR %': a.apr, 'APR is an estimate': a.aprEstimate || undefined, 'Credit limit': a.creditLimit, 'Minimum payment': minimumOf(L),
            'Monthly payment': a.planPayment ?? a.payment, 'Escrow per month': a.escrow, 'Next payment': nextPaymentDate(L, now, a),
            'Estimated payoff': payoff.date, 'Months to payoff': payoff.months, Description: a.description,
        });
    });
    const entries = all.flatMap(({ a, L }) => [
        ...L.activity.map(x => plain({ Account: a.title, Date: x.date, Description: x.description, Type: x.type, Amount: x.amount, 'Balance after': x.balance, 'Paid back?': x.paidBack, Notes: x.notes })),
        ...L.payments.map(p => plain({
            Account: a.title, Date: p.date, Description: p.description, Type: 'Payment', Amount: Number.isFinite(p.payment) ? p.payment : p.minPayment,
            'Minimum payment': p.minPayment, 'Balance after': p.after, Status: p.made ? 'Made' : p.date && p.date < t0 ? 'Overdue' : 'Planned',
            Interest: p.interest, Escrow: p.escrow, Principal: p.principal, Notes: p.notes,
        })),
    ]).sort((x, y) => String(y.Date).localeCompare(String(x.Date)));
    const fees = all.flatMap(({ a, fees: list }) => list.map(r => ({ Account: a.title, ...r })).map(({ Invoice, ...r }) => r));
    return {
        summary,
        sources: [
            tableSource('accounts', 'bills-etc/loans', 'Credit cards and loans, one row each, with the balance now worked out as on the Loan/CC page', summary),
            tableSource('account-entries', 'bills-etc/loans', 'Every credit card and loan entry, newest first. Charge, Interest and Fee raise the balance; Credit/refund and Payment lower it. Payment Status is Made, Planned or Overdue; Planned payments have not happened', entries),
            ...(fees.length ? [tableSource('timeshare-fees', 'bills-etc/loans', 'Annual timeshare maintenance fees, tracked separately from the loan balance', fees)] : []),
        ],
    };
}

async function savingsSources() {
    const data = await loadSavings();
    if (!data) return { sources: [] };
    const [activity, settings, moves] = await Promise.all([loadSavingsActivity(), loadSettings(), loadMoves()]);
    // As the Savings page: the account's running balance, less every bucket that isn't one-time money.
    const opening = settings?.opening || { balance: Number.isFinite(data.available?.value) ? data.available.value : 0, date: iso(data.available?.updated || new Date()) };
    const L = savingsLedger(opening, activity);
    const counted = data.buckets.filter(b => b.group !== 'past' && Number.isFinite(b.balance));
    const setAside = counted.reduce((t, b) => t + b.balance, 0);
    const GROUPS = { active: 'Saved each paycheck', setup: 'Still to set up', other: 'Other (not in the paycheck total)', past: 'One-time money (not counted as set aside)' };
    return {
        savings: { balance: L.balance, setAside, cushion: L.balance - setAside },
        sources: [
            tableSource('savings-buckets', 'bills-etc/savings', 'Savings buckets: money set aside inside the one savings account', data.buckets.map(b => plain({ Bucket: b.name, Balance: b.balance, 'Last updated': b.updated, 'Per paycheck': b.perCheck, Group: GROUPS[b.group] || b.group, Notes: b.notes }))),
            tableSource('savings-activity', 'bills-etc/savings', 'Savings account deposits and withdrawals. Amount is always positive; Type says which way', activity.map(r => ({ ...r, 'Balance after': L.after.get(r) ?? '' }))),
            tableSource('savings-transfers', 'bills-etc/savings', 'Log of money moved out of savings', data.transfers.map(t => plain({ Transfer: t.kind, Amount: t.amount, Date: t.date, Confirmed: t.confirmed, Description: t.description }))),
            tableSource('savings-money-to-move', 'bills-etc/savings', 'Money paid from checking for a bucket and still to be moved out of savings (Moved blank = still to move)', moves),
        ],
    };
}

async function checkingSources() {
    const rows = (await allTransactions()).sort((a, b) => b._date - a._date).map(r => plain({
        Date: r._date, Merchant: r['Cleaned Merchant'], Category: r['AI Category'], Amount: r._amt, 'Bank description': r.Description, Type: r['Transaction Type'], Notes: r.Notes,
    }));
    return tableSource('checking', 'bills-etc/this-month', 'Every checking account transaction, newest first. Amount is negative for money out and positive for money in', rows);
}

async function budgetSources() {
    const cfg = await loadConfig();
    if (!cfg) return [];
    const income = Object.fromEntries(Object.entries(cfg).filter(([k, v]) => k.startsWith('monthly_income') && typeof v === 'number'));
    return [
        tableSource('scheduled-bills', 'bills-etc/bills', 'Scheduled bills: day of the month, usual amount, every N months', parseBills(cfg).map(b => plain({ Bill: b.name, Day: b.day, Amount: b.amount, 'Every N months': b.every, Varies: b.varies, Active: b.active, Notes: b.notes, Merchants: b.merchants.join(', ') }))),
        documentSource('budget-settings', 'bills-etc', 'Expected monthly income and the spending plan', { ...income, spending_plan: cfg.spending_plan ?? null }),
    ];
}

async function utilitySources() {
    const loaders = [
        ['electric-bills', 'Electric bills, oldest first. used is kWh. charge is what the period cost; since solar, amount is a running credit balance, not the cost', loadElectric, x => x.bills],
        ['water-bills', 'Water bills by quarter, oldest first. total is the bill; isPaid says if it has been paid', loadWater, x => x.bills],
        ['heating-oil-deliveries', 'Home heating oil deliveries, oldest first. actual is what it cost, price is per gallon, perDay is gallons a day, paidBack is whether the credit card was paid back', loadDeliveries, x => x.deliveries],
        ['propane-fills', 'Oven propane fill-ups, oldest first. total is what it cost', loadPropane, x => x.fills],
        ['property-taxes', 'Property tax bills by half year, oldest first. amount is that bill, annual the year, assessed the valuation', loadTaxes, x => x.bills],
    ];
    return (await Promise.all(loaders.map(async ([id, about, load, pick]) => {
        const data = await load();
        return data ? tableSource(id, 'bills-etc/utilities', about, (pick(data) || []).map(r => plain(r, ['rec']))) : null;
    }))).filter(Boolean);
}

/** Something that couldn't be read is listed as such instead of stopping everything else. */
async function guarded(id, section, work) {
    try { return await work(); } catch (e) { return { sources: [{ id, section, about: id, kind: 'table', rows: [], columns: [], error: e.message }] }; }
}

async function currentAlerts(alertsMap) {
    const lists = await Promise.all(Object.entries(alertsMap).map(async ([section, load]) => {
        try { return (await (await load()).default()).map(x => ({ section, level: x.level, text: scrubText(x.text) })); } catch { return []; }
    }));
    return lists.flat().sort((a, b) => (a.level === b.level ? 0 : a.level === 'red' ? -1 : 1));
}

function factsText(accounts, savings, sources) {
    const lines = [];
    if (accounts?.length) {
        lines.push('Credit cards and loans (balance now):');
        for (const a of accounts) lines.push(`- ${a.Account} (${a.Type}): ${dollars(a['Balance now'])}${a['APR %'] ? `, ${a['APR %']}% APR` : ''}${a['Next payment'] ? `, next payment ${a['Next payment']}` : ''}`);
    }
    if (savings) lines.push(`Savings account: ${dollars(savings.balance)} in the account, ${dollars(savings.setAside)} set aside in buckets, ${dollars(savings.cushion)} left as "Oh sh!t money" (emergency money: the account less all buckets).`);
    const k = sources.get('401k/balances');
    if (k?.dateColumn) {
        const latest = [...k.rows].sort((a, b) => String(b[k.dateColumn]).localeCompare(String(a[k.dateColumn])))[0];
        if (latest) lines.push(`401(k): ${latest['Current Balance']} as of ${latest[k.dateColumn]}.`);
    }
    const c = sources.get('checking');
    if (c?.to) lines.push(`Checking transactions are recorded from ${c.from} to ${c.to}; there is no checking balance in the app.`);
    return lines.join('\n');
}

/** Everything for one conversation: { sources: Map(id → source), facts (text), alerts: [{ section, level, text }] }. */
export async function loadContext(alertsMap) {
    const [folders, accounts, savings, checking, budget, utilities, alerts] = await Promise.all([
        folderSources(),
        guarded('accounts', 'bills-etc/loans', accountSources),
        guarded('savings-buckets', 'bills-etc/savings', savingsSources),
        guarded('checking', 'bills-etc/this-month', async () => ({ sources: [await checkingSources()] })),
        guarded('budget-settings', 'bills-etc', async () => ({ sources: await budgetSources() })),
        guarded('electric-bills', 'bills-etc/utilities', async () => ({ sources: await utilitySources() })),
        currentAlerts(alertsMap),
    ]);
    const list = [...checking.sources, ...accounts.sources, ...savings.sources, ...budget.sources, ...utilities.sources, ...folders];
    const sources = new Map(list.map(s => [s.id, s]));
    return { sources, alerts, facts: factsText(accounts.summary, savings.savings, sources) };
}
