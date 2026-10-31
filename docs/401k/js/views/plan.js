// The Plan & investments page: the plan's information, where the money is invested (each fund's share and expense
// ratio, with what they add up to), and the plan's documents (PDFs or photos).
import { esc, money } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import {
    PLAN_PATH, INVESTMENTS_PATH, DOCUMENTS_PATH, DOCUMENTS_DIR, INVESTMENT_COLUMNS, DOCUMENT_COLUMNS, loadPlan, savePlan,
    loadInvestments, saveInvestments, loadDocuments, saveDocuments, loadBalances, ledger, amountOf,
} from '../401k.js';

let checks = []; // each box's hasUnsavedEdits

export const hasUnsavedEdits = () => checks.some(f => f());
export const forget = () => { checks = []; closeFilterMenu(); };

/** Under the investments: what the shares add up to, and the average expense ratio (and about what it costs a year). */
function investmentsNote(rows, balance) {
    const funds = rows.map(r => ({ pct: amountOf(r['% of Balance']), er: amountOf(r['Expense Ratio %']) })).filter(f => Number.isFinite(f.pct));
    if (!funds.length) return '';
    const total = funds.reduce((t, f) => t + f.pct, 0);
    const known = funds.filter(f => Number.isFinite(f.er)), knownPct = known.reduce((t, f) => t + f.pct, 0);
    const avg = knownPct ? known.reduce((t, f) => t + f.pct * f.er, 0) / knownPct : NaN;
    const off = Math.abs(total - 100) > 0.05;
    return `<div class="banner ${off ? 'updated-aging' : 'ok'}" style="margin-bottom:10px">${off ? '' : '✓ '}The shares add up to <strong>${+total.toFixed(2)}%</strong>${off ? ' (should be 100%)' : ''}`
        + (Number.isFinite(avg) ? ` · average expense ratio <strong>${+avg.toFixed(3)}%</strong>${Number.isFinite(balance) ? `, about ${esc(money(balance * avg / 100))} a year on today's balance` : ''}` : '')
        + '</div>';
}

export async function renderPlan(el) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [plan, investments, documents, balances] = await Promise.all([loadPlan(), loadInvestments(), loadDocuments(), loadBalances()]);
    const balance = ledger(balances).at(-1)?.balance;
    el.innerHTML = `
        <h1 class="page">Plan &amp; investments</h1>
        <p class="lead">Information in <code>${esc(PLAN_PATH)}</code>, investments in <code>${esc(INVESTMENTS_PATH)}</code>,
            documents in <code>${esc(DOCUMENTS_PATH)}</code> (the files in <code>${esc(DOCUMENTS_DIR)}/</code>).</p>
        <section>
            <h2>Plan information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Investments <span class="sub">each fund's share of the balance, and what it charges a year</span></h2>
            <div id="inv-note"></div>
            <div id="investments"></div>
        </section>
        <section>
            <h2>Documents <span class="sub">the plan description, fee disclosures, beneficiary forms, tax forms</span></h2>
            <div id="documents"></div>
        </section>`;
    const info = infoBox(el.querySelector('#info'), {
        info: plan.info,
        noun: '401(k)',
        mono: /\bnumber\b/i,
        save: async newInfo => { await savePlan({ ...plan, info: newInfo }); plan.info = newInfo; },
    });
    const noteEl = el.querySelector('#inv-note');
    noteEl.innerHTML = investmentsNote(investments, balance);
    const inv = recordTable(el.querySelector('#investments'), {
        columns: INVESTMENT_COLUMNS,
        rows: investments,
        save: async r => { await saveInvestments(r); noteEl.innerHTML = investmentsNote(r, balance); },
    });
    const docs = recordTable(el.querySelector('#documents'), {
        columns: DOCUMENT_COLUMNS,
        rows: documents,
        filesDir: DOCUMENTS_DIR,
        save: r => saveDocuments(r),
    });
    checks = [() => info.hasUnsavedEdits(), () => inv.hasUnsavedEdits(), () => docs.hasUnsavedEdits()];
}
