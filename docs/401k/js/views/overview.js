// The Overview page: a banner when the balance is out of date, cards (balance, what went in and the growth since the
// first entry, this year against the IRS limit, the employer's share), the balance over time, and the balance history.
import { esc, money } from '../../../bills-etc/js/util.js';
import { drawLines } from '../../../bills-etc/js/charts.js';
import { card, dLong, dateOf, setResize, clearResize } from '../../../bills-etc/js/views/utilcommon.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { BALANCES_PATH, STATEMENTS_DIR, BALANCE_COLUMNS, loadBalances, saveBalances, ledger, summary, irsLimit } from '../401k.js';
import { balanceStatus } from '../alerts.js';

let table = null;

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits();
export const forget = () => { table = null; closeFilterMenu(); clearResize(); };

const signed = v => `<span class="${v >= 0 ? 'delta-good' : 'delta-bad'}">${v >= 0 ? '▲' : '▼'} ${esc(money(Math.abs(v)))}</span>`;
const longDate = iso => dLong(dateOf(iso));

export async function renderOverview(el) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadBalances();
    const pts = ledger(rows), S = summary(pts), status = balanceStatus(pts);
    el.innerHTML = `
        <h1 class="page">401(k)</h1>
        ${status.level ? `<div class="banner ${status.level === 'red' ? 'updated-stale' : 'updated-aging'}"><strong>${esc(status.text)}</strong>${pts.length ? ` · last entry ${esc(longDate(S.last.date))}` : ''}</div>`
            : pts.length ? `<div class="banner ok">✓ <strong>Balance up to date</strong> · last entry ${esc(longDate(S.last.date))}</div>` : ''}
        <p class="lead">Balances kept in <code>${esc(BALANCES_PATH)}</code>. The plan's information, investments and documents are on <a href="#plan">Plan &amp; investments</a>.</p>
        <div class="cards kpis" id="cards"></div>
        <section>
            <h2>Balance over time <span class="sub">the gap between the lines is growth: gains, losses and fees</span></h2>
            <canvas id="c-balance" style="display:block;width:100%;height:240px"></canvas>
        </section>
        <section>
            <h2>Balance history <span class="sub">one entry per statement or check-in</span></h2>
            <p class="muted" style="margin-top:0">You put in and Employer put in: what went in since the entry before (a statement shows it for its period).
                Growth is worked out: the change in balance that wasn't money put in.</p>
            <div id="balances"></div>
        </section>`;

    // ── Cards ──
    const L = irsLimit(new Date().getFullYear());
    if (S) {
        const since = longDate(S.first.date), year = S.year;
        const left = Math.max(0, L.base - S.ytdMine), pct = Math.min(100, (S.ytdMine / L.base) * 100);
        // At this year's pace: what's in so far, spread over the days to the year's latest entry, for the whole year.
        let pace = '';
        if (S.ytdMine > 0 && S.ytdLast) {
            const d = dateOf(S.ytdLast.date), jan1 = new Date(year, 0, 1);
            const day = Math.round((d - jan1) / 864e5) + 1, daysInYear = Math.round((new Date(year + 1, 0, 1) - jan1) / 864e5);
            if (day >= 30) {
                const p = S.ytdMine / day * daysInYear;
                pace = `<br>At this pace about <strong>${esc(money(p))}</strong> by Dec 31${p > L.base ? ' <span class="delta-bad">(over the limit)</span>' : ''}`;
            }
        }
        el.querySelector('#cards').innerHTML = [
            card('Balance', money(S.last.balance), `<span class="muted">as of ${esc(longDate(S.last.date))}</span>`
                + (S.prev ? `<br>${signed(S.last.balance - S.prev.balance)} <span class="muted">since ${esc(longDate(S.prev.date))}</span>` : '')),
            card(`Put in since ${since}`, money(S.mine + S.employer),
                `<span class="muted">you ${esc(money(S.mine))} · employer ${esc(money(S.employer))}</span>`),
            card(`Growth since ${since}`, money(S.growth),
                `<span class="muted">the change that wasn't money put in: gains, losses and fees</span>`, S.growth >= 0 ? 'var(--green)' : 'var(--red)'),
            card(`You put in, ${year}`, money(S.ytdMine), `
                <div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
                <span class="muted">of the ${L.announced ? year : `${L.year} (${year}'s not announced yet)`} IRS limit, ${esc(money(L.base))} · ${esc(money(left))} to go</span>${pace}
                <br><span class="muted">${esc(money(L.catchUp))} more allowed from age 50 (${esc(money(L.catchUp6063))} at 60–63)</span>`),
            card(`Employer put in, ${year}`, money(S.ytdEmployer),
                `<span class="muted">doesn't count toward your limit</span><br>Growth this year: ${signed(S.ytdGrowth)}`),
        ].join('');
    } else {
        el.querySelector('#cards').innerHTML = card('Balance', '—', '<span class="muted">add your latest statement under Balance history</span>')
            + card(`IRS limit, ${new Date().getFullYear()}`, money(L.base), `<span class="muted">what you can put in this year · ${esc(money(L.catchUp))} more from age 50 (${esc(money(L.catchUp6063))} at 60–63)</span>`);
    }

    // ── Balance over time, and the first balance plus everything put in since (the gap is growth) ──
    const draw = () => {
        if (!pts.length) return;
        let putIn = pts[0].balance;
        const base = pts.map((p, k) => (putIn += k ? p.mine + p.employer : 0));
        drawLines(el.querySelector('#c-balance'), {
            labels: pts.map(p => { const d = dateOf(p.date); return d.toLocaleString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '"); }),
            series: [
                { name: 'Balance', values: pts.map(p => p.balance), color: '#2b6cb0', width: 2.5, dots: true },
                { name: 'First balance + put in', values: base, color: '#8a94a6', width: 2, dash: [6, 4] },
            ],
            fit: true, fmt: v => `$${Math.round(v).toLocaleString('en-US')}`, tipFmt: money,
            tipHead: i => longDate(pts[i].date),
        });
    };
    draw();
    setResize(draw);

    // ── Balance history (Growth worked out from the entries as saved) ──
    const growthOf = new Map(pts.map(p => [p.row, p.growth]));
    const columns = [...BALANCE_COLUMNS];
    columns.splice(columns.findIndex(c => c.name === 'Notes'), 0,
        { name: 'Growth', kind: 'money', calc: r => (Number.isFinite(growthOf.get(r)) ? growthOf.get(r) : '') });
    table = recordTable(el.querySelector('#balances'), {
        columns,
        rows,
        filesDir: STATEMENTS_DIR,
        save: async r => {
            await saveBalances(r);
            const y = scrollY;
            setTimeout(async () => { forget(); await renderOverview(el); scrollTo(0, y); }); // the cards, chart and Growth follow
        },
    });
}
