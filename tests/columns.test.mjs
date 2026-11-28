// A table's own columns (⚙ Columns): extra columns survive a load and save (docs/shared/js/csv.js tableRows/tableCSV),
// and a saved column order is laid over the page's columns (docs/shared/js/columns.js arrange). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableRows, tableCSV, parseCSV } from '../docs/shared/js/csv.js';
import { arrange } from '../docs/shared/js/columns.js';

test('a column the page does not know is read and written back', () => {
    const text = 'Date,Vet tech,Cost\n2026-11-01,Sam,40\n';
    const rows = tableRows(text, ['Date', 'Cost', 'Notes']);
    assert.deepEqual(rows, [{ Date: '2026-11-01', Cost: '40', Notes: '', 'Vet tech': 'Sam' }]);
    assert.deepEqual(parseCSV(tableCSV(['Date', 'Cost', 'Notes'], rows)).columns, ['Date', 'Cost', 'Notes', 'Vet tech']);
});

test('a renamed column reads its old name, which is not kept as a column of its own', () => {
    const rows = tableRows('Date,Out of Pocket\n2026-11-01,12\n', ['Date', 'Due from Cigna'], { was: { 'Due from Cigna': 'Out of Pocket' } });
    assert.deepEqual(rows, [{ Date: '2026-11-01', 'Due from Cigna': '12' }]);
});

test('the page\'s own keys (_from, _pending) and non-text values are never written', () => {
    const text = tableCSV(['A'], [{ A: '1', _from: 0, _pending: {}, seq: 3 }]);
    assert.equal(text, 'A\n1\n');
});

test('trim', () => {
    assert.deepEqual(tableRows('A,B\n x , y \n', ['A'], { trim: true }), [{ A: 'x', B: 'y' }]);
});

const base = [{ name: 'Date', kind: 'date' }, { name: 'Description', kind: 'text' }, { name: 'Cost', kind: 'money' }, { name: 'Notes', kind: 'text' }];
const names = cols => cols.map(c => (c.hidden ? `(${c.label || c.name})` : c.label || c.name));

test('no saved columns: the page\'s own, as they are', () => {
    assert.deepEqual(arrange(base, undefined), base);
});

test('saved order, names, taken off and added columns', () => {
    const layout = { columns: [
        { name: 'Cost', label: 'Price' }, { name: 'Date' }, { name: 'Vet tech', added: true, kind: 'suggest' },
        { name: 'Description', hidden: true }, { name: 'Notes' },
    ] };
    const cols = arrange(base, layout);
    assert.deepEqual(names(cols), ['Price', 'Date', 'Vet tech', '(Description)', 'Notes']);
    assert.equal(cols[0].kind, 'money'); // the page's own kind stays
    assert.equal(cols[2].kind, 'suggest');
    assert.equal(cols[2].added, true);
});

test('a column new on the page goes after the one before it; a saved one the page dropped is gone', () => {
    const layout = { columns: [{ name: 'Notes' }, { name: 'Date' }, { name: 'Gone' }, { name: 'Cost' }] };
    assert.deepEqual(names(arrange(base, layout)), ['Notes', 'Date', 'Description', 'Cost']);
});

test('an added column with an unknown kind is text; one named like a page column is the page\'s', () => {
    const cols = arrange(base, { columns: [{ name: 'X', added: true, kind: 'weird' }, { name: 'Cost', added: true, kind: 'text' }] });
    assert.equal(cols.find(c => c.name === 'X').kind, 'text');
    assert.equal(cols.find(c => c.name === 'Cost').kind, 'money');
});
