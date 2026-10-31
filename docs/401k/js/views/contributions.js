// The Overview's Contributions box: what you put in (% of pay, pre-tax or Roth, $ a paycheck), how often you're paid,
// the employer match, auto-increase and birth year (for the catch-up) — and what that adds up to: each paycheck, a year,
// this year against the IRS limit, and the match. Kept in 401k.json's `contributions`.
import { esc, money, toast } from '../../../bills-etc/js/util.js';
import { dLong } from '../../../bills-etc/js/views/utilcommon.js';
import {
    CONTRIBUTION_TYPES, PAY_EVERY, contributionMath, matchText, paydaysLeft, irsLimit, loadPlan, savePlan, amountOf,
} from '../401k.js';

const NUMBERS = ['percent', 'rothPercent', 'grossPay', 'amount', 'matchPercent', 'matchUpTo', 'match2Percent', 'match2UpTo', 'birthYear'];
const TEXTS = ['type', 'payEvery', 'payday', 'autoIncrease', 'notes'];

const dayOf = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
const pctOf = v => `${+v.toFixed(2)}%`;
const blank = '<span class="muted">—</span>';

/** "What it adds up to" for contributions `c`, with this year's total so far from the balance history (S: summary()). */
export function contributionTips(c, S, now = new Date()) {
    const M = contributionMath(c), year = now.getFullYear(), L = irsLimit(year, amountOf(c.birthYear));
    const limitName = L.extra > 0 ? `your ${year} limit, ${money(L.total)} (${money(L.base)} + ${money(L.extra)} catch-up)` : `the ${year} limit, ${money(L.base)}`;
    // The paychecks still to be counted this year: after the year's latest balance entry (its total is what's in so far).
    const after = S?.ytdLast ? dayOf(S.ytdLast.date) : null;
    if (after) after.setDate(after.getDate() + 1);
    const P = paydaysLeft(c, after || new Date(year, 0, 1)), ytd = S?.ytdMine || 0;
    const tips = [];
    if (Number.isFinite(M.mine)) {
        tips.push(`<strong>Each paycheck:</strong> you ${esc(money(M.mine))}${Number.isFinite(M.employer)
            ? ` + employer about ${esc(money(M.employer))} = <strong>${esc(money(M.mine + M.employer))}</strong> going in` : ''}.`);
        tips.push(`<strong>A year</strong> (${M.perYear} paychecks): you about ${esc(money(M.mine * M.perYear))}${Number.isFinite(M.employer)
            ? `, employer about ${esc(money(M.employer * M.perYear))}` : ''}.`);
        const by = ytd + M.mine * P.count;
        tips.push(`<strong>By Dec 31:</strong> about ${esc(money(by))} of ${esc(limitName)}: ${esc(money(ytd))} so far${S?.ytdLast ? ` (to ${esc(dLong(dayOf(S.ytdLast.date)))})` : ''}`
            + ` + ${P.count} more paycheck${P.count === 1 ? '' : 's'}${P.estimated ? ' (estimated: add a payday for the exact count)' : ''}`
            + `${by > L.total + 0.005 ? ' · <span class="delta-bad">more than the limit</span>' : ''}.`);
    }
    // What it takes to put in the whole limit: over a year, and (when one paycheck could cover it) by this Dec 31.
    const ofPay = v => (M.gross > 0 ? ` (${(v / M.gross * 100).toFixed(1)}% of pay)` : '');
    const perYear = L.total / M.perYear, room = L.total - ytd, need = P.count ? room / P.count : NaN;
    tips.push(`To put in all of ${esc(limitName)}: about <strong>${esc(money(perYear))}</strong> a paycheck over a whole year${ofPay(perYear)}`
        + (room > 0 && P.count > 0 && !(need > M.gross) ? `; to get there by Dec 31, about ${esc(money(need))} for each of the ${P.count} paychecks left${ofPay(need)}.` : '.'));
    if (M.tiers.length) {
        const most = `${pctOf(M.maxEmployerPct)} of pay${Number.isFinite(M.maxEmployer) ? ` (about ${esc(money(M.maxEmployer * M.perYear))} a year)` : ''}`;
        tips.push(`<strong>The match</strong> pays the most, ${most}, when you put in ${pctOf(M.fullAt)} or more`
            + (!Number.isFinite(M.pct) ? '.' : M.pct >= M.fullAt - 1e-9 ? `: ✓ at ${pctOf(M.pct)} you get all of it.`
                : `: at ${pctOf(M.pct)} you get ${pctOf(M.employerPct)} of pay${Number.isFinite(M.maxEmployer) ? `, about ${esc(money((M.maxEmployer - M.employer) * M.perYear))} a year less than the most` : ''}.`));
    }
    if (!L.announced) tips.push(`<span class="muted">The IRS hasn't announced ${year}'s limits yet: these use ${L.year}'s.</span>`);
    return tips;
}

/**
 * Draw the box into `el`. plan: from loadPlan() (its `contributions` is changed in place on save); S: the balance
 * history's summary() or null; onSaved(): after a save. Returns { hasUnsavedEdits() }.
 */
export function contributionsBox(el, { plan, S, onSaved }) {
    let start = null; // the form's values when editing started

    const show = () => {
        start = null;
        const c = plan.contributions || {}, M = contributionMath(c);
        const roth = amountOf(c.rothPercent);
        const type = c.type === 'Pre-tax + Roth' && Number.isFinite(roth) && Number.isFinite(M.pct)
            ? `Pre-tax ${pctOf(M.pct - roth)} + Roth ${pctOf(roth)}` : c.type || '';
        const age = irsLimit(new Date().getFullYear(), amountOf(c.birthYear)).age;
        const items = [
            ['Contribution', Number.isFinite(M.pct) ? `${pctOf(M.pct)} of pay${Number.isFinite(amountOf(c.percent)) ? '' : ' (worked out)'}` : ''],
            ['Pre-tax or Roth', type],
            ['Paid', c.payEvery ? `${M.every.label} (${M.perYear} paychecks a year)` : ''],
            ['A payday', c.payday ? dLong(dayOf(c.payday)) : ''],
            ['Pay per paycheck (before taxes)', M.gross > 0 ? money(M.gross) : ''],
            ['You put in per paycheck', Number.isFinite(M.mine) ? `${money(M.mine)}${M.mineWorkedOut ? ` (${pctOf(M.pct)} of ${money(M.gross)})` : ''}` : ''],
            ['Employer match', matchText(M.tiers)],
            ['Employer puts in per paycheck', Number.isFinite(M.employer) ? `about ${money(M.employer)}` : ''],
            ['Auto-increase', c.autoIncrease || ''],
            ['Birth year', c.birthYear ? `${c.birthYear}${Number.isFinite(age) ? ` (${age} this year)` : ''}` : ''],
        ];
        const tips = Object.keys(c).length ? contributionTips(c, S) : [];
        el.innerHTML = `
            <div class="row table-tools"><button type="button" class="small" data-edit>✎ Edit</button>
                <span class="muted edit-hint">Your contribution, how you're paid and the employer match: the amounts are worked out from them.</span></div>
            <dl class="info-grid">${items.map(([label, value]) => `<div class="info-item"><dt>${esc(label)}</dt><dd>${value ? esc(value) : blank}</dd></div>`).join('')}
                ${c.notes ? `<div class="info-item wide"><dt>Notes</dt><dd>${esc(c.notes)}</dd></div>` : ''}</dl>
            ${tips.length ? `<h3 class="chart-title" style="margin-top:16px">What it adds up to</h3><ul class="insight-list">${tips.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}`;
        el.querySelector('[data-edit]').onclick = edit;
    };

    const read = form => {
        const out = {};
        for (const k of NUMBERS) { const v = amountOf(form[k].value); if (Number.isFinite(v)) out[k] = v; }
        for (const k of TEXTS) { const v = form[k].value.trim(); if (v) out[k] = v; }
        if (out.type !== 'Pre-tax + Roth') delete out.rothPercent;
        return out;
    };

    const edit = () => {
        const c = plan.contributions || {};
        const v = k => esc(c[k] ?? '');
        const num = (name, label, placeholder = '', step = '0.01') => `<label class="field">${label}<input type="number" step="${step}" min="0" name="${name}" value="${v(name)}" placeholder="${placeholder}"></label>`;
        const amt = (name, label, placeholder) => `<label class="field">${label}<input type="text" inputmode="decimal" name="${name}" value="${v(name)}" placeholder="${placeholder}"></label>`;
        el.innerHTML = `
            <form class="add-bill" style="margin-top:0">
                <div class="add-grid">
                    ${num('percent', 'Contribution (% of pay)', 'e.g. 6')}
                    <label class="field">Pre-tax or Roth<select name="type"><option value="">—</option>${CONTRIBUTION_TYPES.map(t => `<option${c.type === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
                    <span data-roth>${num('rothPercent', 'Roth part (% of pay)', 'the rest is pre-tax')}</span>
                </div>
                <div class="add-grid">
                    <label class="field">How often you're paid<select name="payEvery">${PAY_EVERY.map(p => `<option value="${p.id}"${(c.payEvery || '2weeks') === p.id ? ' selected' : ''}>${esc(p.label)} (${p.perYear} a year)</option>`).join('')}</select></label>
                    <label class="field">A payday (any one)<input type="date" name="payday" value="${v('payday')}"></label>
                    ${amt('grossPay', 'Pay per paycheck, before taxes ($)', 'to work out the $ amounts')}
                    ${amt('amount', 'You put in per paycheck ($)', 'blank: worked out from % × pay')}
                </div>
                <div class="add-grid">
                    ${num('matchPercent', 'Employer matches (%)', 'e.g. 100')}
                    ${num('matchUpTo', '… of the first (% of pay)', 'e.g. 3')}
                    ${num('match2Percent', 'then (%)', 'optional, e.g. 50')}
                    ${num('match2UpTo', '… of the next (% of pay)', 'e.g. 2')}
                </div>
                <div class="add-grid">
                    <label class="field">Auto-increase<input type="text" name="autoIncrease" value="${v('autoIncrease')}" placeholder="e.g. +1% each January, up to 10%"></label>
                    ${num('birthYear', 'Birth year', 'for the catch-up from age 50', '1')}
                </div>
                <label class="field">Notes<textarea name="notes" rows="2">${v('notes')}</textarea></label>
                <div class="row" style="margin-top:12px"><button class="primary">Save</button><button type="button" data-cancel>Cancel</button></div>
            </form>`;
        const form = el.querySelector('form');
        const roth = () => { el.querySelector('[data-roth]').hidden = form.type.value !== 'Pre-tax + Roth'; };
        form.type.onchange = roth;
        roth();
        start = JSON.stringify(read(form));
        el.querySelector('[data-cancel]').onclick = show;
        form.onsubmit = async e => {
            e.preventDefault();
            const next = read(form);
            if (next.type === 'Pre-tax + Roth' && next.rothPercent > (next.percent ?? Infinity)) return toast('The Roth part can\'t be more than the contribution', 'bad');
            try {
                const latest = await loadPlan(); // re-read, so the plan information saved elsewhere stays
                latest.contributions = next;
                await savePlan(latest);
                plan.contributions = next;
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            toast('Saved contributions', 'ok');
            show();
            onSaved?.();
        };
        form.percent.focus();
    };

    show();
    return { hasUnsavedEdits: () => start !== null && JSON.stringify(read(el.querySelector('form'))) !== start };
}
