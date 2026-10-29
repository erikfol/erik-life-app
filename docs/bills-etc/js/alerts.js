// Everything due, or flagged yellow/red, in Bills Etc, in one list: Setup's "Things to update" (views/updates.js) shows
// it and the Home page counts it. Each check follows the same rule as the banner on its own page. The rules of pages
// that load app.js (Savings, Loan/CC, Electric, This Month) live here and those pages import them: importing app.js
// would start the Bills Etc app on the Home page, so nothing here may.
import * as fs from './fs.js';
import { PATHS } from './data.js';
import { loadSavings, loadActivity as loadSavingsActivity, loadSettings } from './savings.js';
import { loadElectric } from './electric.js';
import { loadWater, nextQuarter } from './water.js';
import { loadDeliveries } from './heating.js';
import { loadPropane } from './propane.js';
import { loadTaxes } from './taxes.js';
import { loadAccounts, loadPayments, loadActivity, ledger, owesBack, isCard } from './loans.js';
import { parseBillDate } from './sheet.js';
import { esc, money, sum } from './util.js';
import { dLong, addMonths, today } from './views/utilcommon.js';
import { portalLink as waterPortal } from './views/water.js';
import { portalLink as taxPortal, taxDetailsOn } from './views/taxes.js';

const DAY = 864e5;
const days = n => `${n} day${n === 1 ? '' : 's'}`;
/** Levels, worst first; the names match the .banner.updated-* colours. The Home page counts stale as red, the rest yellow. */
export const LEVELS = ['stale', 'old', 'aging'];

// ── Rules the pages share ────────────────────────────────────────────────────

/** Savings: paid every other week. */
export const PAYCHECK_EVERY = 14;
/** Savings: deposits a bucket is behind, one for every two weeks since its last update. */
export const depositsDue = b => (b.group === 'active' && b.perCheck > 0 && b.updated ? Math.max(0, Math.floor((today() - b.updated) / DAY / PAYCHECK_EVERY)) : 0);
/**
 * Savings: how long since the account activity was last brought up to date — the newest of its last entry, the day
 * it was marked checked (settings.activityChecked) and the starting balance's date: { lastEntry, checked, days }.
 * Like a credit card's: yellow from STALE_DAYS, red from VERY_STALE_DAYS.
 */
export function savingsActivityAge(rows, settings, t0) {
    const iso = x => (/^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x : null);
    const lastEntry = rows.map(r => iso(r.Date)).filter(Boolean).sort().at(-1) || null;
    const checked = iso(settings?.activityChecked), opened = iso(settings?.opening?.date);
    const last = [lastEntry, checked, opened].filter(Boolean).sort().at(-1);
    const day = x => { const [y, m, d] = x.split('-').map(Number); return new Date(y, m - 1, d); };
    return { lastEntry: lastEntry && day(lastEntry), checked: checked && day(checked), days: last ? Math.floor((t0 - day(last)) / DAY) : Infinity };
}

// The electric company's customer portal, where statements are downloaded.
const ELECTRIC_PORTAL = 'https://myaccount.libertyenergyandwater.com/portal/#/login?LUNH';
export const electricPortal = `<a class="ext-link" href="${ELECTRIC_PORTAL}" target="_blank" rel="noopener">Liberty account ↗</a>`;
/**
 * When this month's bill details should show up in the Liberty account: ~11 days after the next service period
 * ends (period ending the 17th → around the 28th), which is after the statement's due date.
 */
export const electricDetailsOn = last => {
    const periodEnds = addMonths(last.end, 1);
    return new Date(periodEnds.getFullYear(), periodEnds.getMonth(), periodEnds.getDate() + 11);
};

/** Loan/CC: what a payment that isn't made yet will take: the planned payment, or else the minimum. */
export const amountDue = p => (Number.isFinite(p.payment) ? p.payment : p.minPayment);
/** Loan/CC: days without a new activity entry (or a "checked") before a card gets flagged (yellow), and before it turns red. */
export const STALE_DAYS = 20, VERY_STALE_DAYS = 40;
/**
 * Cards whose newest activity entry, or the last time you marked them checked (with neither, the opening date),
 * is STALE_DAYS or more ago, so you know to look at the statement. all: [{ account, rawActivity }].
 */
export function staleCards(all, t0) {
    return all.map(({ account, rawActivity }) => {
        const dates = rawActivity.map(a => a.date).filter(Boolean);
        const lastEntry = dates.length ? new Date(Math.max(...dates)) : null;
        const checked = parseBillDate(account.activityChecked);
        const last = [lastEntry, checked].filter(Boolean).sort((a, b) => b - a)[0] || parseBillDate(account.openingDate);
        return { account, lastEntry, checked, days: last ? Math.floor((t0 - last) / DAY) : Infinity };
    }).filter(x => x.days >= STALE_DAYS).sort((a, b) => b.days - a.days);
}
/** Loan/CC: activity still to pay back, as {account, a}. */
export const notPaidBack = all => all.flatMap(({ account, rawActivity }) => rawActivity.filter(owesBack).map(a => ({ account, a })));

/** This Month: when this month's bank export was added on Setup (edits in Finance Table don't count); null without one. */
export async function lastBankUpdate() {
    const [bankFile] = await fs.listFiles(PATHS.currentMonth);
    return (bankFile && await fs.modifiedAt(`${PATHS.currentMonth}/${bankFile}`)) || await fs.modifiedAt(PATHS.processed);
}
/** This Month's "Last updated" banner: { age (days), level }: fresh 0–3 days old (green), aging 4–10, old 11–20, stale 21+. */
export function updatedLevel(updated) {
    const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const age = Math.max(0, Math.round((day(new Date()) - day(updated)) / DAY));
    return { age, level: age <= 3 ? 'fresh' : age <= 10 ? 'aging' : age <= 20 ? 'old' : 'stale' };
}

// ── The list ─────────────────────────────────────────────────────────────────

async function savingsItems(t0) {
    const data = await loadSavings();
    if (!data) return [];
    const out = [], where = 'Savings', href = '#savings';
    // Paycheck deposits behind: yellow 1–2, orange 3–4, red 5+ (as the Savings status banner)
    const behind = data.buckets.map(b => ({ b, n: depositsDue(b) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    if (behind.length) {
        const most = behind[0].n;
        out.push({ level: most <= 2 ? 'aging' : most <= 4 ? 'old' : 'stale', where, href,
            text: `<strong>${most} paycheck deposit${most === 1 ? '' : 's'} behind</strong> · ${behind.map(x => `${esc(x.b.name)} ${x.n}×`).join(', ')}` });
    }
    // Account activity not updated in 20+ (yellow) or 40+ days (red), as the Savings banner
    const [activity, settings] = await Promise.all([loadSavingsActivity(), loadSettings()]);
    const a = savingsActivityAge(activity, settings, t0);
    if (a.days >= STALE_DAYS) {
        out.push({ level: a.days >= VERY_STALE_DAYS ? 'stale' : 'aging', where, href,
            text: `<strong>Account activity not updated</strong> · ${a.lastEntry ? `last entry ${esc(dLong(a.lastEntry))}` : 'no entries yet'}${a.checked ? `, checked ${esc(dLong(a.checked))}` : ''}${Number.isFinite(a.days) ? ` (${days(a.days)})` : ''}` });
    }
    return out;
}

async function monthItems() {
    const updated = await lastBankUpdate();
    if (!updated) return [];
    const { age, level } = updatedLevel(updated);
    return level === 'fresh' ? [] : [{ level, where: 'This Month', href: '#month',
        text: `<strong>Bank data last added ${age === 1 ? 'yesterday' : `${days(age)} ago`}</strong> (${esc(dLong(updated))}) · add a new bank export` }];
}

async function electricItems(t0) {
    const bills = (await loadElectric())?.bills;
    if (!bills?.length) return [];
    const last = bills.at(-1), lastDue = last.due || last.end;
    const nextDue = addMonths(lastDue, 1), detailsOn = electricDetailsOn(last);
    const where = 'Electric', href = '#utilities/electric';
    if (t0 >= nextDue) return [{ level: 'aging', where, href, text: `<strong>New statement to add</strong> · the next one was due around ${esc(dLong(nextDue))} ${electricPortal}` }];
    if (detailsOn < nextDue && t0 >= detailsOn) return [{ level: 'aging', where, href, text: `<strong>This month's bill details should be available</strong> (since ${esc(dLong(detailsOn))}) ${electricPortal}` }];
    return [];
}

async function waterItems(t0) {
    const bills = (await loadWater())?.bills;
    if (!bills?.length) return [];
    const out = [], where = 'Water', href = '#utilities/water';
    const last = bills.at(-1), lastDue = last.due || last.end;
    const nextDue = addMonths(lastDue, 3), detailsOn = addMonths(nextDue, -1);
    const nq = last.q ? nextQuarter(last) : null;
    const nqText = nq ? `Q${nq.q} ${nq.year}` : 'next quarter';
    if (t0 >= nextDue) out.push({ level: 'aging', where, href, text: `<strong>New statement to add (${esc(nqText)})</strong> · it was due around ${esc(dLong(nextDue))} ${waterPortal}` });
    else if (t0 >= detailsOn) out.push({ level: 'aging', where, href, text: `<strong>${esc(nqText)} details should be available</strong> (since ${esc(dLong(detailsOn))}) ${waterPortal}` });
    for (const b of bills.filter(x => !x.isPaid)) {
        out.push({ level: 'stale', where, href, text: `<strong>Not paid yet: Q${b.q} ${b.year}</strong> · ${esc(money(b.total))}${b.due ? `, due ${esc(dLong(b.due))}` : ''}` });
    }
    return out;
}

async function heatingItems() {
    const deliveries = (await loadDeliveries())?.deliveries;
    if (!deliveries?.length) return [];
    return deliveries.filter(d => !d.isPaidBack).map(d => ({ level: 'stale', where: 'Home Heating', href: '#utilities/heating',
        text: `<strong>Not paid back yet: ${esc(dLong(d.date))} delivery</strong> · ${esc(money(d.actual))} (${esc(d.paidBack || 'blank')})` }));
}

async function propaneItems(t0) {
    const fills = (await loadPropane())?.fills;
    if (!fills?.length) return [];
    const gaps = fills.map(f => f.days).filter(d => d > 0);
    if (!gaps.length) return [];
    const nextFill = new Date(fills.at(-1).date.getTime() + Math.round(sum(gaps) / gaps.length) * DAY);
    const detailsOn = addMonths(nextFill, -1);
    return t0 >= detailsOn ? [{ level: 'aging', where: 'Propane', href: '#utilities/propane',
        text: `<strong>Next fill-up expected around ${esc(dLong(nextFill))}</strong> · time to check the tank and get the details` }] : [];
}

async function taxItems(t0) {
    const bills = (await loadTaxes())?.bills;
    if (!bills?.length) return [];
    const last = bills.at(-1), lastBilled = last.billed || last.due;
    if (!lastBilled) return [];
    const next = last.half === 1 ? `${last.year} 2nd half` : `${last.year + 1} 1st half`;
    const expected = addMonths(lastBilled, 6), detailsOn = taxDetailsOn(last);
    const where = 'Property Taxes', href = '#utilities/taxes';
    if (t0 >= expected) return [{ level: 'aging', where, href, text: `<strong>New bill to add (${esc(next)})</strong> · it was billed around ${esc(dLong(expected))} ${taxPortal}` }];
    if (t0 >= detailsOn) return [{ level: 'aging', where, href, text: `<strong>${esc(next)} details should be available</strong> (since ${esc(dLong(detailsOn))}) ${taxPortal}` }];
    return [];
}

async function loanCardItems(t0) {
    const all = await Promise.all((await loadAccounts()).map(async a => {
        const rawPayments = await loadPayments(a), rawActivity = await loadActivity(a);
        return { account: a, rawActivity, payments: ledger(a, rawPayments, rawActivity).payments };
    }));
    const out = [];
    const tab = a => (isCard(a) ? { where: 'Credit Cards', href: '#loans/cards' } : { where: 'Loans', href: '#loans/loans' });
    // Payments not made: past due (red) and due in the next two weeks (yellow), as on the Credit Cards and Loans tabs
    for (const { account, payments } of all) {
        for (const p of payments.filter(x => !x.made && x.date && x.date - t0 <= 14 * DAY)) {
            const late = p.date < t0;
            out.push({ level: late ? 'stale' : 'aging', ...tab(account),
                text: `<strong>${esc(account.title)}: ${late ? 'payment not made' : 'payment coming up'}</strong> · ${esc(money(amountDue(p)))}${Number.isFinite(p.payment) ? '' : ' minimum'} ${late ? 'was due' : 'due'} ${esc(dLong(p.date))}` });
        }
    }
    // Card activity not updated (the Credit Cards tab only)
    for (const x of staleCards(all.filter(x => isCard(x.account)), t0)) {
        out.push({ level: x.days >= VERY_STALE_DAYS ? 'stale' : 'aging', ...tab(x.account), checkId: x.account.id,
            text: `<strong>${esc(x.account.title)}: activity not updated</strong> · ${x.lastEntry ? `last entry ${esc(dLong(x.lastEntry))}` : 'no activity yet'}${x.checked ? `, checked ${esc(dLong(x.checked))}` : ''}${Number.isFinite(x.days) ? ` (${days(x.days)})` : ''}` });
    }
    // Activity not paid back yet (red, as Home Heating's)
    for (const { account, a } of notPaidBack(all)) {
        out.push({ level: 'stale', ...tab(account),
            text: `<strong>${esc(account.title)}: not paid back yet</strong> · ${a.date ? esc(dLong(a.date)) : 'no date'} ${esc(a.description || a.type)} ${esc(money(a.amount))}${a.paidBack === 'Not yet' ? '' : ` (${esc(a.paidBack)})`}` });
    }
    return out;
}

const SOURCES = [
    ['Savings', savingsItems], ['This Month', monthItems], ['Electric', electricItems], ['Water', waterItems],
    ['Home Heating', heatingItems], ['Propane', propaneItems], ['Property Taxes', taxItems], ['Loan/CC', loanCardItems],
];

/**
 * Everything to look at, worst first: [{ level ('stale' | 'old' | 'aging'), where, href, text (HTML), checkId? }].
 * A source that can't be read is its own 'old' item instead of hiding the rest.
 */
export async function dueItems(t0 = today()) {
    const results = await Promise.all(SOURCES.map(([name, fn]) => fn(t0).catch(e => [{ level: 'old', where: name, text: `<strong>Couldn't check</strong> · ${esc(e.message)}` }])));
    return results.flat().sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
}

/** For the Home page and the menu colours: [{ level: 'red' | 'yellow', text (without the links), href }]. */
export default async function alerts() {
    const plain = html => {
        const d = document.createElement('div');
        d.innerHTML = html;
        d.querySelectorAll('a').forEach(a => a.remove());
        return d.textContent.replace(/\s+/g, ' ').trim();
    };
    return (await dueItems()).map(x => ({ level: x.level === 'stale' ? 'red' : 'yellow', text: `${x.where}: ${plain(x.text)}`, href: x.href }));
}
