// The Overview page: a banner when the balance is out of date, cards (balance; the latest investment returns and net
// transactions for each period; this year's contributions against the IRS limit and the employer's, estimated from
// Contributions), Contributions (what goes in each paycheck), the balance over time, and the balance history.
import { esc, money } from '../../../bills-etc/js/util.js';
import { drawLines } from '../../../bills-etc/js/charts.js';
import { card, dLong, dateOf, setResize, clearResize } from '../../../bills-etc/js/views/utilcommon.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import {
    BALANCES_PATH, PLAN_PATH, BALANCE_COLUMNS, BALANCE_CHOICES, loadBalances, saveBalances, loadPlan, ledger, summary, notAddingUp, irsLimit,
    contributionMath, yearPaychecks, amountOf,
} from '../401k.js';
import { balanceStatus } from '../alerts.js';
import { contributionsBox } from './contributions.js';

let table = null, contrib = null;

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!contrib?.hasUnsavedEdits();
export const forget = () => { table = null; contrib = null; closeFilterMenu(); clearResize(); };

const signed = v => `<span class="${v >= 0 ? 'delta-good' : 'delta-bad'}">${v >= 0 ? '▲' : '▼'} ${esc(money(Math.abs(v)))}</span>`;
const longDate = iso => dLong(dateOf(iso));

export async function renderOverview(el) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [rows, plan] = await Promise.all([loadBalances(), loadPlan()]);
    const pts = ledger(rows), S = summary(pts), status = balanceStatus(pts);
    const c = plan.contributions || {}, M = contributionMath(c);
    // After a save: draw it all again (the cards and chart follow), where it was.
    const redraw = () => { const y = scrollY; setTimeout(async () => { forget(); await renderOverview(el); scrollTo(0, y); }); };
    el.innerHTML = `
        <h1 class="page">401(k)</h1>
        ${status.level ? `<div class="banner ${status.level === 'red' ? 'updated-stale' : 'updated-aging'}"><strong>${esc(status.text)}</strong>${pts.length ? ` · last entry ${esc(longDate(S.last.date))}` : ''}</div>`
            : pts.length ? `<div class="banner ok">✓ <strong>Balance up to date</strong> · last entry ${esc(longDate(S.last.date))}</div>` : ''}
        <p class="lead">Balances kept in <code>${esc(BALANCES_PATH)}</code>. The plan's information, investments and documents are on <a href="#plan">Plan &amp; investments</a>.</p>
        <div class="cards kpis" id="cards"></div>
        <section>
            <h2>Contributions <span class="sub">what goes in each paycheck · kept in <code>${esc(PLAN_PATH)}</code></span></h2>
            <div id="contrib"></div>
        </section>
        <section>
            <h2>Balance over time <span class="sub">each statement's current balance, and its starting balance at the start of its period</span></h2>
            <canvas id="c-balance" style="display:block;width:100%;height:240px"></canvas>
        </section>
        <section>
            <h2>Balance history <span class="sub">one entry per statement: the numbers from its summary for the period shown</span></h2>
            <div id="balances"></div>
            <div id="balance-check"></div>
        </section>`;

    // ── Cards ──
    const year = new Date().getFullYear(), L = irsLimit(year, amountOf(c.birthYear)), Y = yearPaychecks(c);
    // Your limit: with a birth year, the base plus the catch-up for your age; without, the base (catch-up mentioned).
    const limitText = L.extra > 0 ? `${esc(money(L.total))} (${esc(money(L.base))} + ${esc(money(L.extra))} catch-up)` : esc(money(L.base));
    const limitName = `${L.extra > 0 ? 'your' : 'the'} ${L.announced ? year : `${L.year} (${year}'s not announced yet)`} IRS limit, ${limitText}`;
    const catchUpNote = Number.isFinite(L.extra) ? '' : `<br><span class="muted">${esc(money(L.catchUp))} more allowed from age 50 (${esc(money(L.catchUp6063))} at 60–63): add your birth year under Contributions</span>`;
    const paychecks = `${Y.soFar} paycheck${Y.soFar === 1 ? '' : 's'} so far${Y.estimated ? ' (about: add a payday under Contributions for the exact count)' : ''}`;
    const cards = [];
    if (S) {
        const plus = v => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`;
        cards.push(card('Balance', money(S.last.balance), `<span class="muted">as of ${esc(longDate(S.last.date))}</span>`
            + (S.prev ? `<br>${signed(S.last.balance - S.prev.balance)} <span class="muted">since ${esc(longDate(S.prev.date))}</span>` : '')));
        // The latest statement for each period: the shortest one large, the others under it.
        const [main, ...others] = S.byPeriod;
        if (main) {
            cards.push(card('Investment returns', plus(main.returns),
                `<span class="muted">${esc(main.period)} to ${esc(longDate(main.date))} · net transactions ${esc(plus(main.net))}</span>`
                + others.map(p => `<br>${esc(p.period)}: ${signed(p.returns)} <span class="muted">· net ${esc(plus(p.net))}${p.date !== main.date ? ` · to ${esc(longDate(p.date))}` : ''}</span>`).join(''),
                main.returns >= 0 ? 'var(--green)' : 'var(--red)'));
        }
    } else {
        cards.push(card('Balance', '—', '<span class="muted">add your latest statement under Balance history</span>'));
    }
    // This year's contributions, estimated: what goes in a paycheck × this year's paychecks so far (and in all).
    if (Number.isFinite(M.mine)) {
        const soFar = M.mine * Y.soFar, by = M.mine * Y.total, pct = Math.min(100, (soFar / L.total) * 100);
        cards.push(card(`You put in, ${year}`, `~${money(soFar)}`, `
            <div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
            <span class="muted">estimated: ${esc(money(M.mine))} × ${esc(paychecks)} · of ${limitName}</span>
            <br>By Dec 31 about <strong>${esc(money(by))}</strong> <span class="muted">(${Y.total} paychecks)</span>${by > L.total + 0.005 ? ' <span class="delta-bad">(over the limit)</span>' : ''}${catchUpNote}`));
    } else {
        cards.push(card(`IRS limit, ${year}`, money(L.total), `<span class="muted">what you can put in this year${L.extra > 0 ? `: ${limitText}` : ''}</span>`
            + `<br><span class="muted">Add what you put in each paycheck under Contributions to follow it</span>${catchUpNote}`));
    }
    if (Number.isFinite(M.employer)) {
        cards.push(card(`Employer, ${year}`, `~${money(M.employer * Y.soFar)}`,
            `<span class="muted">estimated: about ${esc(money(M.employer))} × ${esc(paychecks)} · doesn't count toward your limit</span>`
            + `<br>By Dec 31 about <strong>${esc(money(M.employer * Y.total))}</strong>`));
    }
    el.querySelector('#cards').innerHTML = cards.join('');
    contrib = contributionsBox(el.querySelector('#contrib'), { plan, onSaved: redraw });

    // ── Balance over time: every balance the statements give (current balances, and starting balances back in time) ──
    const draw = () => {
        if (!S) return;
        const B = S.points, t = B.map(b => dateOf(b.date).getTime()), span = t.at(-1) - t[0];
        drawLines(el.querySelector('#c-balance'), {
            xs: span > 0 ? t.map(x => (x - t[0]) / span) : null, // spaced by date: statements can be years apart
            labels: B.map(b => { const d = dateOf(b.date); return d.toLocaleString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '"); }),
            series: [{ name: 'Balance', values: B.map(b => b.balance), color: '#2b6cb0', width: 2.5, dots: true }],
            fit: true, fmt: v => `$${Math.round(v).toLocaleString('en-US')}`, tipFmt: money,
            tipHead: i => `${longDate(B[i].date)}${B[i].kind === 'start' ? ` · starting balance of the ${B[i].entry.period} statement to ${longDate(B[i].entry.date)}` : ''}`,
        });
    };
    draw();
    setResize(draw);

    // ── Balance history ──
    table = recordTable(el.querySelector('#balances'), {
        columns: BALANCE_COLUMNS,
        choices: BALANCE_CHOICES,
        rows,
        save: async r => { await saveBalances(r); redraw(); },
    });
    const off = notAddingUp(pts);
    el.querySelector('#balance-check').innerHTML = off.length ? `<div class="banner updated-aging" style="margin-top:10px">⚠ ${off.map(p =>
        `<strong>${esc(longDate(p.date))}</strong> doesn't add up: starting + net transactions + returns = ${esc(money(p.start + p.net + p.returns))}, not ${esc(money(p.balance))}`).join('<br>⚠ ')}</div>` : '';
}
