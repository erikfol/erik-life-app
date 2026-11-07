// The Documents pages, one per tax year (#documents/<year>, a pill for each, "＋ Add year" #documents/add): the
// documents to gather for that year's return, ticked off as they come in (✓ Received) with their files, and the things
// to remember for it as the year goes (donations, medical bills, energy improvements, questions for the preparer),
// with receipts. A new year starts with the year before's list.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import {
    DOCUMENT_COLUMNS, DOCUMENT_CHOICES, DEFAULT_DOCUMENTS, NOTE_COLUMNS, documentsPath, documentsDir, notesPath, notesDir,
    loadDocuments, saveDocuments, loadNotes, saveNotes, saveData, nextYearDocuments, docsProgress, dueDate, longDate, workingYear,
} from '../taxes.js';

let checks = [];
export const hasUnsavedEdits = () => checks.some(f => f());
export const forget = () => { checks = []; closeFilterMenu(); };

const sorted = years => [...years].sort();
const pills = (years, active) => `<nav class="pillnav">${sorted(years).map(y => `<a href="#documents/${esc(y)}"${y === active ? ' class="active"' : ''}>${esc(y)}</a>`).join('')}`
    + `<a href="#documents/add"${active === 'add' ? ' class="active"' : ''}>＋ Add year</a></nav>`;

/** The year #documents opens: the one you're gathering for (workingYear) if it has a page, else the newest. */
export const defaultYear = years => (years.includes(workingYear()) ? workingYear() : sorted(years).at(-1));

/** The list a year starts with: the year before's (the newest earlier year with a saved list), else the default one. */
async function startingList(years, year) {
    for (const y of sorted(years).filter(x => +x < +year).reverse()) {
        const rows = await loadDocuments(y, false);
        if (rows?.length) return nextYearDocuments(rows);
    }
    return DEFAULT_DOCUMENTS.map(r => ({ ...r }));
}

function progressBanner(year, rows, saved) {
    const p = docsProgress(rows);
    if (!p.needed) return '';
    const start = saved ? '' : ' · the starting list: change it with ✎ Edit';
    if (!p.waiting.length) return `<div class="banner ok">✓ <strong>All ${p.needed} documents are in</strong> for the ${esc(year)} return.</div>`;
    // a document on the list more than once (e.g. a 1098 from each mortgage servicer) says who it's from
    const twice = d => rows.filter(r => r.Document === d).length > 1;
    const name = r => `${r.Document || 'a document'}${twice(r.Document) && r.From ? ` (${r.From})` : ''}`;
    return `<div class="banner info"><strong>${p.received} of ${p.needed} documents in</strong> for the ${esc(year)} return · still to come:
        ${p.waiting.map(r => esc(name(r))).join(', ')}${start}</div>`;
}

export async function renderDocuments(el, data, year, onChanged) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [savedDocs, notes] = await Promise.all([loadDocuments(year), loadNotes(year)]);
    const saved = savedDocs !== null;
    let docs = saved ? savedDocs : await startingList(data.years, year);
    const due = dueDate(year);
    el.innerHTML = `
        <h1 class="page">Documents ${esc(year)}</h1>
        ${pills(data.years, year)}
        <div id="progress"></div>
        <p class="lead">For the ${esc(year)} return, due ${esc(longDate(due))}. Documents in <code>${esc(documentsPath(year))}</code> (files in
            <code>${esc(documentsDir(year))}/</code>), things to remember in <code>${esc(notesPath(year))}</code>.</p>
        <section>
            <h2>Documents to gather <span class="sub">tick each one off as it comes in, and add its PDF or photo</span></h2>
            <div id="docs"></div>
        </section>
        <section>
            <h2>Things to remember for the ${esc(year)} return <span class="sub">donations, medical bills, energy improvements, life changes, questions for the preparer</span></h2>
            <div id="notes"></div>
        </section>
        <div class="row" style="margin-top:6px"><span class="spacer"></span>
            <button type="button" class="danger small" id="remove-year">Remove ${esc(year)} from Documents</button></div>`;
    const progress = el.querySelector('#progress');
    const draw = (rows, isSaved) => { progress.innerHTML = progressBanner(year, rows, isSaved); };
    draw(docs, saved);
    const reload = async () => { const y = scrollY; await renderDocuments(el, data, year, onChanged); scrollTo(0, y); };
    const docsTable = recordTable(el.querySelector('#docs'), {
        columns: DOCUMENT_COLUMNS,
        choices: DOCUMENT_CHOICES,
        rows: docs,
        filesDir: documentsDir(year),
        save: async r => { await saveDocuments(year, r); docs = r; draw(r, true); },
        rowActions: [{
            label: '✓ Received', title: 'It came in: marks it Received (✎ Edit to add its file)',
            show: r => r.Status !== 'Received' && r.Status !== 'Not needed',
            run: async row => {
                const k = docs.indexOf(row);
                const next = docs.map((r, i) => (i === k || (k < 0 && r.Document === row.Document && r.From === row.From) ? { ...r, Status: 'Received' } : r));
                try {
                    await saveDocuments(year, next);
                    toast(`${row.Document || 'Document'}: received`, 'ok');
                    await reload();
                } catch (err) { toast(`Save failed: ${err.message}. Is ${documentsPath(year)} open in Excel?`, 'bad'); }
            },
        }],
    });
    const notesTable = recordTable(el.querySelector('#notes'), {
        columns: NOTE_COLUMNS,
        rows: notes,
        filesDir: notesDir(year),
        save: r => saveNotes(year, r),
    });
    checks = [() => docsTable.hasUnsavedEdits(), () => notesTable.hasUnsavedEdits()];

    el.querySelector('#remove-year').onclick = async () => {
        if (!confirm(`Remove ${year} from Documents?\n\nIts files (${documentsPath(year)}, ${notesPath(year)} and the documents in ${documentsDir(year)}/) stay in your folder: add ${year} again to bring it back.`)) return;
        try {
            await saveData({ ...data, years: data.years.filter(y => y !== year) });
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Removed ${year}`, 'ok');
        onChanged('documents');
    };
}

/** "＋ Add year": the year after the newest (the one you're gathering for, if it isn't there yet). Starts with the year before's list. */
export function renderAddYear(el, data, onChanged) {
    const years = data.years, w = workingYear();
    const suggest = years.includes(w) ? Math.max(...years.map(Number)) + 1 : +w;
    el.innerHTML = `
        <h1 class="page">Documents</h1>
        ${pills(years, 'add')}
        <section>
            <h2>Add a tax year</h2>
            <form id="year-form" class="new-vehicle">
                <label class="field">Tax year<input type="number" name="year" min="1990" max="2200" step="1" required value="${suggest}"></label>
                <p class="muted">It starts with the documents on the year before's list, all waiting again.</p>
                <div class="row"><button class="primary">Add year</button></div>
            </form>
        </section>`;
    el.querySelector('#year-form').onsubmit = async e => {
        e.preventDefault();
        const year = String(new FormData(e.target).get('year')).trim();
        if (!/^\d{4}$/.test(year)) return toast('Type a year like 2027.', 'bad');
        if (years.includes(year)) return onChanged(`documents/${year}`);
        try {
            if ((await loadDocuments(year, false)) === null) await saveDocuments(year, await startingList(years, year));
            await saveData({ ...data, years: sorted([...years, year]) });
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added ${year}`, 'ok');
        onChanged(`documents/${year}`);
    };
}
