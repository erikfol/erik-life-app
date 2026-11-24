// The shared date helpers (docs/shared/js/dates.js). Run: node --test tests/
// Day counts are checked in a time zone with daylight saving, where (b - a) / 864e5 alone gives wrong answers.
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseDate, fmtDate, yearMonth, monthLabel, isoDate, dateOf, todayIso, daysBetween, inDays, addMonths, dLong } =
    await import('../docs/shared/js/dates.js');

test('daysBetween counts calendar days across daylight-saving changes', () => {
    assert.equal(daysBetween(new Date(2026, 2, 1), new Date(2026, 2, 21)), 20); // spring forward (Mar 8)
    assert.equal(daysBetween(new Date(2026, 9, 20), new Date(2026, 10, 10)), 21); // fall back (Nov 1)
    assert.equal(daysBetween(new Date(2026, 0, 1), new Date(2027, 0, 1)), 365);
});

test('daysBetween ignores the time of day and goes backwards', () => {
    assert.equal(daysBetween(new Date(2026, 10, 1, 23, 59), new Date(2026, 10, 2, 0, 1)), 1);
    assert.equal(daysBetween(new Date(2026, 10, 5), new Date(2026, 10, 1)), -4);
    assert.equal(daysBetween(new Date(2026, 10, 5, 8), new Date(2026, 10, 5, 20)), 0);
});

test('isoDate, dateOf and todayIso use this device\'s date', () => {
    assert.equal(isoDate(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(isoDate(dateOf('2026-03-08')), '2026-03-08');
    assert.equal(dateOf('3/8/2026'), null);
    assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('inDays', () => {
    assert.equal(inDays(0), 'today');
    assert.equal(inDays(1), 'tomorrow');
    assert.equal(inDays(12), 'in 12 days');
});

test('addMonths stays within the month', () => {
    assert.equal(isoDate(addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
    assert.equal(isoDate(addMonths(new Date(2026, 10, 15), 3)), '2027-02-15');
    assert.equal(dLong(new Date(2026, 10, 24)), 'Nov 24, 2026');
});

test('parseDate reads the bank and spreadsheet formats', () => {
    for (const s of ['2026-11-03', '11/3/2026', '11/03/26', '3-Nov-26', '03 Nov 2026', 'Nov 3, 2026']) {
        assert.equal(isoDate(parseDate(s)), '2026-11-03', s);
    }
    assert.equal(parseDate('2026-02-30'), null);
    assert.equal(parseDate(''), null);
    assert.equal(fmtDate(new Date(2026, 10, 3)), '03-Nov-26');
    assert.equal(yearMonth(new Date(2026, 10, 3)), '2026-11');
    assert.equal(monthLabel('2026-11'), 'Nov 2026');
});
