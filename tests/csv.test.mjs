// The shared CSV reader and writer (docs/shared/js/csv.js): files must round-trip unchanged. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseRecords, toCSV } from '../docs/shared/js/csv.js';

test('quotes, commas, new lines and a byte-order mark', () => {
    const text = '﻿Date,Description,Amount\r\n2026-11-03,"Hardware, paint","-12.50"\r\n2026-11-04,"Said ""hi""\nthen left",5\r\n';
    const { columns, rows } = parseCSV(text);
    assert.deepEqual(columns, ['Date', 'Description', 'Amount']);
    assert.deepEqual(rows, [
        { Date: '2026-11-03', Description: 'Hardware, paint', Amount: '-12.50' },
        { Date: '2026-11-04', Description: 'Said "hi"\nthen left', Amount: '5' },
    ]);
});

test('what toCSV writes reads back the same', () => {
    const columns = ['Item', 'Notes', 'Cost'];
    const rows = [{ Item: 'Tires, 4', Notes: '3/4" tread "OK"', Cost: '480' }, { Item: 'Wipers', Notes: '', Cost: '' }];
    const text = toCSV(columns, rows);
    assert.deepEqual(parseCSV(text), { columns, rows });
    assert.equal(toCSV(columns, parseCSV(text).rows), text);
});

test('a quote in the middle of a value is just a character; blank lines are skipped', () => {
    assert.deepEqual(parseRecords('a,3/4" pipe,b\n\n'), [['a', '3/4" pipe', 'b']]);
    assert.deepEqual(parseRecords('x\ty\n1\t2', '\t'), [['x', 'y'], ['1', '2']]);
});

test('missing cells come back empty', () => {
    assert.deepEqual(parseCSV('A,B,C\n1\n').rows, [{ A: '1', B: '', C: '' }]);
});
