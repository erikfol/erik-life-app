// Setup's calendar (top of the page): one month at a time, the days your bills come out and how much, and your paydays.
// The numbers come from ../calendar.js; click a day for the details.
import { loadConfig } from '../data.js';
import { allTransactions, addMonths, STATUS } from '../bills.js';
import { calendarMonth } from '../calendar.js';
import { yearMonth, longMonthLabel, MONTH_NAMES } from '../dates.js';
import { esc, money } from '../util.js';
import { dShort } from './utilcommon.js';

const AHEAD = 12;     // months you can look ahead
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let shownYm = null;   // month picked, kept while moving between pages
let pickedDay = null; // day picked for details, in shownYm

/** $1.2k / $85, for the small day totals on a phone. */
const short = v => (v >= 1000 ? `$${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(v)}`);
const weekday = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const BILL_ICON = { paid: '✓ ', late: '! ', missed: '✕ ', unknown: '? ' };
const BILL_TIP = {
    paid: 'paid', due: 'to come out', late: 'late: due date passed and no payment in your bank data',
    missed: 'missed: never paid', unknown: 'due date passed; bank data isn\'t loaded that far yet',
};

/** One line in a day square. */
function itemHtml(it) {
    if (it.kind === 'pay') {
        const tip = `${it.received ? 'Paycheck' : 'Expected paycheck'} ${money(it.amount)}`;
        return `<span class="cal-item pay${it.received ? '' : ' expected'}" title="${esc(tip)}"><span class="n">💵 Payday</span><span class="a">+${esc(money(it.amount))}</span></span>`;
    }
    const approx = it.state !== 'paid' && it.bill.varies ? '≈ ' : '';
    const tip = `${it.bill.name}: ${approx}${money(it.amount)}, ${BILL_TIP[it.state]}`;
    return `<span class="cal-item bill ${it.state}" title="${esc(tip)}"><span class="n">${esc(it.bill.name)}</span><span class="a">${BILL_ICON[it.state] || ''}${approx}−${esc(money(it.amount))}</span></span>`;
}

/** "to Rocket Mortgage": the merchant a payment went to, when it isn't just the bill's name. */
const toWhom = it => {
    const m = String(it.row['Cleaned Merchant'] ?? '').trim();
    return m && m.toLowerCase() !== it.bill.name.toLowerCase() ? `to ${m}` : '';
};

/** Details of one item for the day panel: [what, status badge, amount, more]. */
function detailRow(it, cal) {
    if (it.kind === 'pay') {
        const P = cal.pay;
        const more = it.received
            ? [`from ${P.merchant}`, it.rows.length > 1 ? `${it.rows.length} deposits: ${it.rows.map(r => money(r._amt)).join(' + ')}` : ''].filter(Boolean).join(' · ')
            : `every ${P.every} days after your ${P.latest ? dShort(P.latest.date) : ''} paycheck; ${P.plan.paycheck != null ? 'your paycheck amount on This Month' : 'the same as your latest one'}`;
        return { what: '💵 Paycheck', badge: it.received ? '<span class="badge badge-ok">Received</span>' : '<span class="badge badge-neutral">Expected</span>',
            amount: `<span class="income-amt">+${esc(money(it.amount))}</span>`, more: esc(more) };
    }
    const x = it.x, b = it.bill;
    let badge, more;
    if (it.state === 'paid') {
        const forOther = yearMonth(x.dueOn) !== cal.ym ? `${MONTH_NAMES[x.dueOn.getMonth()]}'s bill` : '';
        badge = x.status === 'late-paid' ? '<span class="badge badge-warn">Paid late</span>' : '<span class="badge badge-ok">Paid</span>';
        more = [`due ${dShort(x.dueOn)}`, forOther, x.status === 'late-paid' ? `${x.lateDays} days late` : '',
            x.changed ? `usually ${money(x.expected)}` : '', toWhom(it)].filter(Boolean).join(' · ');
    } else {
        badge = `<span class="badge ${STATUS[it.state][0]}">${STATUS[it.state][1]}</span>`;
        more = [b.varies ? 'usual amount; it changes month to month' : 'usual amount',
            it.state === 'late' || it.state === 'unknown' ? (cal.dataThrough ? `bank data through ${dShort(cal.dataThrough)}` : 'no bank data loaded') : '',
            it.state === 'missed' ? 'no payment found' : ''].filter(Boolean).join(' · ');
    }
    return { what: esc(b.name), badge, amount: `${it.state !== 'paid' && b.varies ? '≈ ' : ''}−${esc(money(it.amount))}`, more: esc(more) };
}

export default async function renderCalendar(el) {
    el.innerHTML = '<p class="muted">Loading your calendar…</p>';
    let cfg, rows;
    try {
        cfg = (await loadConfig()) || {};
        rows = await allTransactions();
    } catch (e) {
        el.innerHTML = `<div class="banner bad">Couldn't load the calendar: ${esc(e.message)}</div>`;
        return;
    }
    const today = new Date();
    const thisYm = yearMonth(today);
    const firstYm = rows.length ? rows.reduce((a, r) => (r._ym < a ? r._ym : a), rows[0]._ym) : thisYm;
    const yms = [];
    for (let ym = firstYm < thisYm ? firstYm : thisYm; ym <= addMonths(thisYm, AHEAD); ym = addMonths(ym, 1)) yms.push(ym);
    if (!yms.includes(shownYm)) { shownYm = thisYm; pickedDay = null; }

    el.innerHTML = `
        <div class="row cal-head">
            <div class="month-nav">
                <button id="cal-prev" title="Previous month" aria-label="Previous month">◀</button>
                <select id="cal-month" aria-label="Month">${yms.map(m => `<option value="${m}">${longMonthLabel(m)}</option>`).join('')}</select>
                <button id="cal-next" title="Next month" aria-label="Next month">▶</button>
            </div>
            <button class="small" id="cal-today">This month</button>
            <span class="spacer"></span>
            <div class="cal-sums" id="cal-sums"></div>
        </div>
        <div id="cal-msg"></div>
        <div class="cal" id="cal-grid"></div>
        <div id="cal-day"></div>
        <p class="note">Paid bills sit on the day they came out of your account, for what they actually were; bills still to come sit on their due date for their usual amount (≈ = it changes month to month).
            Bills come from the <a href="#bills">Bills</a> page. Paydays are your paychecks, then expected ones on your pay rhythm (the same ones <a href="#month">This Month</a> counts; see <a href="#income">Income</a>). Click a day for details.</p>`;
    const $ = s => el.querySelector(s);

    const draw = () => {
        let cal;
        try { cal = calendarMonth({ cfg, rows, ym: shownYm, today }); } catch (e) {
            console.error(e);
            $('#cal-grid').innerHTML = '';
            $('#cal-msg').innerHTML = `<div class="banner bad">Couldn't work out ${esc(longMonthLabel(shownYm))}: ${esc(e.message)}</div>`;
            return;
        }
        const i = yms.indexOf(shownYm);
        $('#cal-month').value = shownYm;
        $('#cal-prev').disabled = i <= 0;
        $('#cal-next').disabled = i >= yms.length - 1;
        $('#cal-today').hidden = shownYm === thisYm;

        const T = cal.totals;
        $('#cal-sums').innerHTML = `
            <span class="cal-sum"><span class="lbl">Paydays</span> <strong class="income-amt">+${esc(money(T.pay))}</strong>
                <span class="muted">${T.receivedCount ? `${T.receivedCount} received` : ''}${T.receivedCount && T.expectedCount ? ' · ' : ''}${T.expectedCount ? `${T.expectedCount} expected` : ''}${!T.receivedCount && !T.expectedCount ? 'none' : ''}</span></span>
            <span class="cal-sum"><span class="lbl">Bills</span> <strong class="out-amt">−${esc(money(T.bills))}</strong>
                <span class="muted">${T.paidCount} paid${T.toComeCount ? ` · ${T.toComeCount} not paid yet (${esc(money(T.toCome))})` : ''}</span>${T.late ? ` <span class="badge badge-over">${T.late} late</span>` : ''}${T.missed ? ` <span class="badge badge-over">${T.missed} missed</span>` : ''}</span>
            <span class="cal-sum"><span class="lbl">Paydays − bills</span> <strong style="color:${T.net >= 0 ? 'var(--green)' : 'var(--red)'}">${esc(money(T.net, true))}</strong></span>`;
        $('#cal-msg').innerHTML = cal.hasBills ? '' : '<div class="banner">No scheduled bills yet. Add them on the <a href="#bills">Bills</a> page to see them here.</div>';

        const y = +shownYm.slice(0, 4), m = +shownYm.slice(5, 7) - 1;
        const days = new Date(y, m + 1, 0).getDate();
        const lead = new Date(y, m, 1).getDay();
        const cells = [];
        for (let k = 0; k < lead; k++) cells.push('<div class="cal-day blank"></div>');
        for (let d = 1; d <= days; d++) {
            const list = cal.byDay.get(d) || [];
            const date = new Date(y, m, d);
            const isToday = shownYm === thisYm && d === today.getDate();
            const inSum = list.filter(x => x.kind === 'pay').reduce((a, x) => a + x.amount, 0);
            const outSum = list.filter(x => x.kind === 'bill' && x.state !== 'missed').reduce((a, x) => a + x.amount, 0);
            const flagged = list.some(x => x.state === 'late' || x.state === 'missed');
            cells.push(`<div class="cal-day${isToday ? ' today' : ''}${date.getDay() % 6 ? '' : ' weekend'}${list.length ? ' has' : ''}${d === pickedDay ? ' picked' : ''}${date < new Date(today.getFullYear(), today.getMonth(), today.getDate()) ? ' past' : ''}"
                data-day="${d}" tabindex="0" role="button" aria-label="${esc(weekday(date))}${list.length ? `: ${list.length} item${list.length === 1 ? '' : 's'}` : ''}">
                <span class="cal-num">${d}${isToday ? ' <span class="cal-today-tag">Today</span>' : ''}</span>
                <span class="cal-items">${list.map(itemHtml).join('')}</span>
                <span class="cal-compact">${inSum ? `<span class="income-amt">+${short(inSum)}</span>` : ''}${outSum ? `<span class="out-amt">−${short(outSum)}</span>` : ''}${flagged ? '<span class="cal-flag">!</span>' : ''}</span>
            </div>`);
        }
        while (cells.length % 7) cells.push('<div class="cal-day blank"></div>');
        $('#cal-grid').innerHTML = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('') + cells.join('');
        drawDay(cal);
    };

    /** The panel under the calendar for the picked day. */
    const drawDay = cal => {
        const box = $('#cal-day');
        const list = pickedDay ? cal.byDay.get(pickedDay) || [] : [];
        if (!pickedDay) { box.innerHTML = ''; return; }
        const date = new Date(+shownYm.slice(0, 4), +shownYm.slice(5, 7) - 1, pickedDay);
        const rowsHtml = list.map(it => detailRow(it, cal)).map(r => `<tr>
            <td><strong>${r.what}</strong>${r.more ? `<div class="muted" style="font-size:0.85em">${r.more}</div>` : ''}</td>
            <td>${r.badge}</td><td class="amt nowrap">${r.amount}</td></tr>`).join('');
        const inSum = list.filter(x => x.kind === 'pay').reduce((a, x) => a + x.amount, 0);
        const outSum = list.filter(x => x.kind === 'bill' && x.state !== 'missed').reduce((a, x) => a + x.amount, 0);
        box.innerHTML = `<div class="cal-detail">
            <div class="row"><strong>${esc(weekday(date))}</strong><span class="spacer"></span><button class="small" id="cal-close" aria-label="Close">✕</button></div>
            ${list.length ? `<div class="table-wrap"><table class="summary-table"><tbody>${rowsHtml}</tbody>
                ${list.length > 1 ? `<tfoot><tr class="total-row"><td colspan="2"><strong>This day</strong></td><td class="amt nowrap"><strong>${[inSum ? `+${esc(money(inSum))}` : '', outSum ? `−${esc(money(outSum))}` : ''].filter(Boolean).join(' ')}</strong></td></tr></tfoot>` : ''}
                </table></div>` : '<p class="muted" style="margin-top:6px">No bills or paydays on this day.</p>'}
        </div>`;
        $('#cal-close').onclick = () => { pickedDay = null; draw(); };
    };

    const show = ym => { if (ym !== shownYm) pickedDay = null; shownYm = ym; draw(); };
    $('#cal-month').onchange = e => show(e.target.value);
    $('#cal-prev').onclick = () => show(yms[yms.indexOf(shownYm) - 1]);
    $('#cal-next').onclick = () => show(yms[yms.indexOf(shownYm) + 1]);
    $('#cal-today').onclick = () => show(thisYm);
    const pick = e => {
        const cell = e.target.closest('.cal-day[data-day]');
        if (!cell) return;
        const d = +cell.dataset.day;
        pickedDay = pickedDay === d ? null : d;
        draw();
        if (e.type === 'keydown') $(`.cal-day[data-day="${d}"]`)?.focus();
        else if (pickedDay) $('#cal-day').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    $('#cal-grid').addEventListener('click', pick);
    $('#cal-grid').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
    draw();
}
