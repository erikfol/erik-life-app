// Income page: your expected take-home, entered per paycheck with how often it comes (config.json `income_sources`; the
// amount a month is kept in `monthly_income_*`, which the Bills page weighs against your bills) and your take-home pay history: every paycheck in the bank data (the same paychecks This Month's Left to spend
// uses), charted, with your notes on why it went up or down. Notes: inputs/income/pay_notes.csv (Date = the paycheck's
// date, Note); a note belongs to the paycheck within a few days of its date.
import { loadConfig, paySources, incomeKey, PAY_EVERY, perMonth, perYear } from '../data.js';
import { allTransactions, saveIncome } from '../bills.js';
import { parsePlan, incomeMerchants, paydays } from '../plan.js';
import { drawLines } from '../charts.js';
import { parseCSV, toCSV } from '../csv.js';
import { readTracked, writeTracked } from '../../../shared/js/fileguard.js';
import { esc, money, toast } from '../util.js';
import { requireFolder } from '../app.js';
import { MON, dLong, isoDate, dateOf, card, axisMoney, setResize, clearResize, yearChips } from './utilcommon.js';

export const NOTES_PATH = 'inputs/income/pay_notes.csv';
const NOTE_COLS = ['Date', 'Note'];
const DAY = 864e5;
const NEAR = 4;       // days: a note belongs to the paycheck this close to its date (deposits this close are one paycheck)
const SPIKE = 1.5;    // a paycheck this many times the usual one (e.g. with a bonus) doesn't stretch the chart
const SAME = 1;       // dollars: paychecks closer than this are the same (they vary by a cent with rounding)

let incomeOpen = false; // monthly income being edited
let notesOpen = false;  // paycheck notes being edited
let chartYears = null;  // year filter, kept while moving between pages
let onlyChanges = false;

const changed = c => c.change != null && Math.abs(c.change) >= SAME;
const pct = (d, base) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d / base * 100).toFixed(1)}%`;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

async function loadNotes() {
    const text = await readTracked(NOTES_PATH);
    return text == null ? [] : parseCSV(text).rows
        .map(r => ({ date: dateOf(String(r.Date ?? '').trim()), text: String(r.Note ?? '').trim() }))
        .filter(n => n.text);
}

/** "▲ $224.80 (+9.5%)" coloured, or "same", or '' for the first paycheck. */
function changeHtml(c) {
    if (c.change == null) return '';
    if (!changed(c)) return `<span class="muted"${Math.abs(c.change) >= 0.005 ? ` title="${c.change > 0 ? 'up' : 'down'} ${esc(money(Math.abs(c.change)))}"` : ''}>same</span>`;
    return `<span class="${c.change > 0 ? 'delta-good' : 'delta-bad'}">${c.change > 0 ? '▲' : '▼'} ${esc(money(Math.abs(c.change)))}</span> <span class="muted">${esc(pct(c.change, c.amount - c.change))}</span>`;
}

/** "2 deposits: $28.15 + $2,561.46" (a reversal shows as − $x). */
const depositsText = c => (c.rows.length > 1
    ? `${c.rows.length} deposits: ${c.rows.map((r, i) => (i ? (r._amt < 0 ? ' − ' : ' + ') : r._amt < 0 ? '−' : '') + money(Math.abs(r._amt))).join('')}` : '');

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        el.innerHTML = '<p class="muted">Loading your income…</p>';
        incomeOpen = notesOpen = false;
        const cfg = (await loadConfig()) || {};
        const rows = await allTransactions();
        const merchant = parsePlan(cfg).merchant || incomeMerchants(rows)[0] || null;
        let notes = [];
        try { notes = await loadNotes(); } catch (e) { toast(`Couldn't read your pay notes: ${e.message}`, 'bad'); }

        // Every paycheck, oldest first, with its change from the one before and its note.
        const checks = (merchant ? paydays(rows, merchant) : []).map((c, i, a) => ({
            ...c, iso: isoDate(c.date), year: c.date.getFullYear(), change: i ? c.amount - a[i - 1].amount : null, notes: [],
        }));
        const orphans = []; // notes with no paycheck near their date (kept as they are)
        for (const n of notes) {
            const near = n.date && checks.reduce((best, c) => {
                const d = Math.abs(c.date - n.date) / DAY;
                return d <= NEAR && (!best || d < best.d) ? { c, d } : best;
            }, null);
            near ? near.c.notes.push(n.text) : orphans.push(n);
        }
        let k = 0;
        for (const c of checks) { c.note = c.notes.join(' · '); c.num = c.note ? ++k : 0; }

        const latest = checks[checks.length - 1] || null;
        const thisYear = new Date().getFullYear();
        const yearAgo = latest && checks.reduce((best, c) => {
            const d = Math.abs((latest.date - c.date) / DAY - 365);
            return c !== latest && d <= 10 && (!best || d < best.d) ? { c, d } : best;
        }, null)?.c;
        const ytd = checks.filter(c => c.year === thisYear);

        el.innerHTML = `
            <h1 class="page">Income</h1>
            <p class="lead">What you expect to take home each month, and every paycheck so far${merchant ? ` (deposits from <strong>${esc(merchant)}</strong>, the same paychecks This Month counts)` : ''}, with your notes on why it went up or down.</p>

            <section>
                <h2>Monthly income <span class="sub">take-home, after taxes</span><span class="spacer"></span><button class="small" id="income-edit">Edit</button></h2>
                <div id="income"></div>
            </section>

            ${!checks.length ? `<section><h2>Take-home pay</h2><p class="muted">No paychecks found in your bank data yet. They're deposits with the category Income${merchant ? ` from ${esc(merchant)}` : ''}; once some are loaded they show here.</p></section>` : `
            <div class="cards">
                ${card('Latest paycheck', money(latest.amount), `${esc(dLong(latest.date))}${latest.rows.length > 1 ? ` · ${latest.rows.length} deposits` : ''}`, '#2980b9')}
                ${yearAgo ? card('Change from a year ago', `${money(latest.amount - yearAgo.amount, true)} (${pct(latest.amount - yearAgo.amount, yearAgo.amount)})`,
                    `<span class="muted">vs ${esc(money(yearAgo.amount))} on ${esc(dLong(yearAgo.date))}</span>`, latest.amount >= yearAgo.amount ? 'var(--green)' : 'var(--red)')
                    : card('Change from a year ago', '—', '<span class="muted">needs a year of paychecks</span>')}
                ${card(`Take-home in ${thisYear}`, money(ytd.reduce((a, c) => a + c.amount, 0)), `<span class="muted">${ytd.length} paycheck${ytd.length === 1 ? '' : 's'} so far</span>`)}
            </div>

            <section>
                <h2>Take-home pay <span class="sub">each paycheck · numbered badges are your notes</span></h2>
                <div class="row year-chips"></div>
                <canvas id="c-pay" style="display:block;width:100%;height:260px"></canvas>
            </section>

            <section class="short-table">
                <h2>Paychecks <span class="sub" id="pay-count"></span><span class="spacer"></span>
                    <label class="check" style="font-size:0.85em;text-transform:none;letter-spacing:0;font-weight:400"><input type="checkbox" id="only-changes"${onlyChanges ? ' checked' : ''}> Only changes and notes</label>
                    <span id="notes-btns"></span></h2>
                <div id="t-pay"></div>
                ${orphans.length ? `<p class="note">Notes with no paycheck near their date (kept in the file): ${orphans.map(n => `${esc(n.date ? dLong(n.date) : 'no date')}: ${esc(n.text)}`).join(' · ')}</p>` : ''}
                <p class="note">Change is from the paycheck before. Add a note to say why it went up or down (a raise, a benefits or 401(k) change, a bonus); noted paychecks get a numbered badge on the chart.</p>
            </section>`}`;
        const $ = s => el.querySelector(s);

        // ── Monthly income: entered per paycheck (amount + how often), worked out a month; read-only until Edit ──
        const sources = paySources(cfg);
        const blank = () => ({ name: '', perPay: '', every: 'biweekly' });
        const incomeRow = s => `
            <div class="pay-row">
                <input type="text" class="k" value="${esc(s.name)}" placeholder="source name" aria-label="Source">
                <input type="number" class="v" step="0.01" min="0" value="${esc(s.perPay)}" placeholder="0.00" aria-label="Per paycheck">
                <select class="e" aria-label="How often">${Object.entries(PAY_EVERY).map(([k, v]) => `<option value="${k}"${k === s.every ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
                <button type="button" class="small danger" data-remove title="Remove">✕</button>
            </div>`;
        const extraNote = list => (list.some(s => PAY_EVERY[s.every].month * 12 !== PAY_EVERY[s.every].year)
            ? `Per month counts the paychecks most months get (2 when it's every 2 weeks). Some months get an extra one, so over a whole year it averages ${esc(money(list.reduce((a, s) => a + perYear(s), 0) / 12))} a month.` : '');
        const latestLine = latest ? `<p class="note">Latest paycheck in your bank data: <strong>${esc(money(latest.amount))}</strong> on ${esc(dLong(latest.date))}.</p>` : '';
        const showIncome = () => {
            const month = sources.reduce((a, s) => a + perMonth(s), 0);
            $('#income-edit').hidden = false;
            $('#income').innerHTML = (!sources.length
                ? '<p class="muted">No income yet. Click <strong>Edit</strong> to add it.</p>'
                : `<div class="table-wrap" style="max-width:640px"><table class="summary-table">
                    <thead><tr><th>Source</th><th class="num">Per paycheck</th><th>How often</th><th class="num">Per month</th></tr></thead>
                    <tbody>${sources.map(s => `<tr><td>${esc(s.name)}</td><td class="amt">${esc(money(s.perPay))}</td><td>${esc(PAY_EVERY[s.every].label)}</td><td class="amt">${esc(money(perMonth(s)))}</td></tr>`).join('')}
                        <tr class="total-row"><td colspan="3"><strong>Total per month</strong></td><td class="amt"><strong>${esc(money(month))}</strong></td></tr></tbody>
                </table></div>
                ${extraNote(sources) ? `<p class="note">${extraNote(sources)}</p>` : ''}`)
                + `${latestLine}<p class="note">Take-home, after taxes. Don't count bonuses or tax refunds. The <a href="#bills">Bills</a> page shows what's left after your bills. This Month's Left to spend counts the paychecks that actually come in instead.</p>`;
        };
        const editIncome = () => {
            incomeOpen = true;
            $('#income-edit').hidden = true;
            $('#income').innerHTML = `<div style="max-width:640px">
                    <div class="pay-row pay-head"><span>Source</span><span>Per paycheck</span><span>How often</span><span></span></div>
                    <div id="income-rows">${(sources.length ? sources : [blank()]).map(incomeRow).join('')}</div>
                    <button type="button" class="small" id="income-add">+ Add income source</button>
                </div>
                <p class="note" id="income-sum"></p>
                ${latestLine}
                <div class="row"><button type="button" class="primary" id="income-save">Save</button><button type="button" id="income-cancel">Cancel</button></div>`;
            const rowsEl = $('#income-rows');
            const read = () => [...rowsEl.querySelectorAll('.pay-row')]
                .map(r => ({ name: r.querySelector('.k').value.trim().replace(/\s+/g, ' '), perPay: Math.abs(parseFloat(r.querySelector('.v').value)) || 0, every: r.querySelector('.e').value }))
                .filter(s => s.name || s.perPay);
            const sum = () => {
                const list = read();
                $('#income-sum').innerHTML = list.length ? `Comes to <strong>${esc(money(list.reduce((a, s) => a + perMonth(s), 0)))}</strong> a month. ${extraNote(list)}` : '';
            };
            rowsEl.addEventListener('input', sum);
            rowsEl.addEventListener('change', sum);
            rowsEl.addEventListener('click', e => { if (e.target.matches('[data-remove]')) { e.target.closest('.pay-row').remove(); sum(); } });
            $('#income-add').onclick = () => { rowsEl.insertAdjacentHTML('beforeend', incomeRow(blank())); rowsEl.lastElementChild.querySelector('.k').focus(); };
            $('#income-cancel').onclick = () => { incomeOpen = false; showIncome(); };
            sum();
            $('#income-save').onclick = async () => {
                const list = read();
                const keys = list.map(s => incomeKey(s.name).toLowerCase());
                const problem = list.some(s => !s.name) ? 'Give each income source a name.'
                    : keys.some((n, i) => keys.indexOf(n) !== i) ? 'Two income sources have the same name.'
                    : '';
                if (problem) { toast(problem, 'bad'); return; }
                try {
                    await saveIncome(list);
                    incomeOpen = false;
                    toast('Saved monthly income', 'ok');
                    await this.render(el);
                } catch (e) {
                    toast(`Save failed: ${e.message}`, 'bad');
                }
            };
            rowsEl.querySelector('.k')?.focus();
        };
        $('#income-edit').onclick = editIncome;
        showIncome();
        if (!checks.length) return;

        // ── Chart + table, both following the year chips ──
        const years = [...new Set(checks.map(c => c.year))];
        const shown = () => checks.filter(c => !chartYears || chartYears.has(c.year));
        const ceil = median(checks.map(c => c.amount)) * SPIKE;

        const drawChart = () => {
            const pts = shown();
            if (!pts.length) return;
            const t0 = pts[0].date, span = pts[pts.length - 1].date - t0;
            drawLines($('#c-pay'), {
                labels: pts.map((c, i) => (i && pts[i - 1].date.getMonth() === c.date.getMonth() ? '' : `${MON[c.date.getMonth()]} ’${String(c.year).slice(2)}`)), // one per month
                xs: pts.map(c => (span ? (c.date - t0) / span : 0.5)),
                series: [{ name: 'Take-home', values: pts.map(c => c.amount), color: '#2b6cb0', width: 2.5, dots: true }],
                fit: true, fmt: axisMoney, tipFmt: money, ceil,
                marks: pts.flatMap((c, i) => (c.num ? [{ index: i, text: String(c.num) }] : [])),
                tipHead: i => dLong(pts[i].date),
                tipExtra: i => {
                    const c = pts[i];
                    return [changed(c) ? `<div>${changeHtml(c)} from the one before</div>` : '',
                        c.rows.length > 1 ? `<div class="muted">${esc(depositsText(c))}</div>` : '',
                        c.note ? `<div><strong>${c.num}.</strong> ${esc(c.note)}</div>` : ''].join('');
                },
            });
        };

        // Notes being typed, by paycheck date, so redrawing the table (filters) keeps them.
        const draft = new Map();
        const noteOf = c => (draft.has(c.iso) ? draft.get(c.iso) : c.note);
        const drawTable = () => {
            const list = shown().filter(c => !onlyChanges || changed(c) || c.note || c.change == null).reverse();
            $('#pay-count').textContent = `newest first · ${list.length} of ${checks.length}`;
            $('#notes-btns').innerHTML = notesOpen
                ? '<button class="small primary" id="notes-save">Save notes</button> <button class="small" id="notes-cancel">Cancel</button>'
                : '<button class="small" id="notes-edit">Edit notes</button>';
            $('#t-pay').innerHTML = `<div class="table-wrap"><table class="summary-table">
                <thead><tr><th>Date</th><th class="num">Take-home</th><th class="num">Change</th><th style="width:50%">Note</th></tr></thead>
                <tbody>${list.map(c => `<tr>
                    <td class="nowrap">${esc(dLong(c.date))}</td>
                    <td class="amt"${c.rows.length > 1 ? ` title="${esc(depositsText(c))}"` : ''}>${esc(money(c.amount))}${c.amount > ceil ? ' <span class="badge badge-warn" title="Much more than your usual paycheck (a bonus?)">extra</span>' : ''}</td>
                    <td class="amt nowrap">${changeHtml(c)}</td>
                    <td>${notesOpen
                        ? `<input type="text" data-iso="${c.iso}" value="${esc(noteOf(c))}" style="width:100%"${changed(c) ? ' placeholder="Why did it change?"' : ''}>`
                        : c.note ? `<span class="note-num">${c.num}</span> ${esc(c.note)}` : ''}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted">No paychecks to show</td></tr>'}</tbody>
            </table></div>`;
            if (notesOpen) {
                $('#notes-save').onclick = saveNotes;
                $('#notes-cancel').onclick = () => { notesOpen = false; draft.clear(); drawTable(); };
            } else {
                $('#notes-edit').onclick = () => { notesOpen = true; drawTable(); $('#t-pay input')?.focus(); };
            }
        };
        $('#t-pay').addEventListener('input', e => { if (e.target.dataset.iso) draft.set(e.target.dataset.iso, e.target.value); });

        const saveNotes = async () => {
            const out = [
                ...orphans.map(n => ({ Date: n.date ? isoDate(n.date) : '', Note: n.text })),
                ...checks.map(c => ({ Date: c.iso, Note: noteOf(c).trim() })).filter(n => n.Note),
            ].sort((a, b) => a.Date.localeCompare(b.Date));
            try {
                await writeTracked(NOTES_PATH, toCSV(NOTE_COLS, out));
                notesOpen = false;
                toast('Saved your notes', 'ok');
                const y = scrollY;
                await this.render(el);
                scrollTo(0, y);
            } catch (e) {
                toast(`Save failed: ${e.message}`, 'bad');
            }
        };

        chartYears = yearChips([...el.querySelectorAll('.year-chips')], years, chartYears, sel => { chartYears = sel; drawChart(); drawTable(); },
            y => y, 'All');
        $('#only-changes').onchange = e => { onlyChanges = e.target.checked; drawTable(); };
        drawChart();
        drawTable();
        setResize(drawChart);
    },

    canLeave(unloading) {
        if (!incomeOpen && !notesOpen) return true;
        if (unloading) return false;
        if (!confirm(notesOpen ? 'You are editing your paycheck notes. Leave without saving?' : 'You are editing your monthly income. Leave without saving?')) return false;
        incomeOpen = notesOpen = false;
        return true;
    },

    destroy() {
        clearResize();
    },
};
