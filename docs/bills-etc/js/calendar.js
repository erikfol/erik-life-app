// Setup's calendar: for one month, the days your scheduled bills come out and your paydays, with the month's totals.
// A bill that has been paid sits on the day it left your account, for what it actually was; one not paid yet sits on its
// due date for its usual amount. Paydays are your real paychecks, then expected ones on your pay rhythm (the same
// paychecks This Month's Left to spend counts).
import { parseBills, billMatcher, paymentsByMonth, paymentMonth, billMonth, firstPaid } from './bills.js';
import { payRhythm, monthChecks } from './plan.js';
import { round2 } from '../../shared/js/util.js';

const sumOf = list => round2(list.reduce((a, x) => a + x.amount, 0));
const TO_COME = ['due', 'late', 'unknown']; // not paid yet, still expected to come out

/**
 * Month `ym` ('YYYY-MM'). `rows`: master + current month, parsed (allTransactions).
 * Returns { ym, items, byDay: Map(day of month → items), pay, totals, dataThrough }.
 * An item is { kind: 'pay', date, amount, received, rows }
 *         or { kind: 'bill', bill, date, amount, state, x, row? }: state = paid | due | late | missed | unknown;
 *            `x` = billMonth() for the month the payment counts for (a bill paid a few days early counts for the next month).
 */
export function calendarMonth({ cfg, rows, ym, today = new Date() }) {
    const bills = parseBills(cfg);
    const match = billMatcher(bills);
    const pays = paymentsByMonth(bills, rows);
    const dataThrough = rows.reduce((a, r) => (!a || r._date > a ? r._date : a), null);
    const opts = b => ({ dataThrough, today, since: firstPaid(pays.get(b.name)) });
    const items = [];

    // Bill payments that left this month, on the day they left.
    for (const r of rows) {
        if (r._ym !== ym) continue;
        const b = match(r);
        if (!b) continue;
        const forYm = paymentMonth(b, r._date);
        items.push({ kind: 'bill', bill: b, date: r._date, amount: round2(-r._amt), state: 'paid', row: r, x: billMonth(b, forYm, pays.get(b.name).get(forYm), opts(b)) });
    }
    // Bills due this month that haven't been paid, on their due date.
    for (const b of bills) {
        const x = billMonth(b, ym, pays.get(b.name).get(ym), opts(b));
        if (x.due && !x.payments.length) items.push({ kind: 'bill', bill: b, date: x.dueOn, amount: x.expected, state: x.status, x });
    }

    // Paydays: the real ones, then the expected ones after your latest paycheck.
    const pay = payRhythm(cfg, rows);
    for (const c of monthChecks(pay, ym)) items.push({ kind: 'pay', ...c });

    // Paychecks first, then bills, biggest first.
    items.sort((a, b) => a.date - b.date || (a.kind === 'pay' ? -1 : 0) - (b.kind === 'pay' ? -1 : 0) || b.amount - a.amount);
    const byDay = new Map();
    for (const it of items) {
        const d = it.date.getDate();
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(it);
    }

    const billItems = items.filter(i => i.kind === 'bill'), payItems = items.filter(i => i.kind === 'pay');
    const paid = billItems.filter(i => i.state === 'paid'), toCome = billItems.filter(i => TO_COME.includes(i.state));
    const received = payItems.filter(i => i.received), expected = payItems.filter(i => !i.received);
    const totals = {
        paid: sumOf(paid), paidCount: paid.length,
        toCome: sumOf(toCome), toComeCount: toCome.length,
        late: billItems.filter(i => i.state === 'late').length,
        missed: billItems.filter(i => i.state === 'missed').length,
        bills: round2(sumOf(paid) + sumOf(toCome)),
        received: sumOf(received), receivedCount: received.length,
        expected: sumOf(expected), expectedCount: expected.length,
        pay: sumOf(payItems),
    };
    totals.net = round2(totals.pay - totals.bills);
    return { ym, items, byDay, pay, totals, dataThrough, hasBills: bills.length > 0 };
}
