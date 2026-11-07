// The Overview page: where this season's return stands (a banner, with the documents still to come), cards (the next
// deadline, the last return, refunds over the years, the preparer's fees), the information and websites, each year's
// return, and the refund or amount owed by year.
import { esc, money } from '../../../bills-etc/js/util.js';
import { drawBars } from '../../../bills-etc/js/charts.js';
import { card, setResize, clearResize } from '../../../bills-etc/js/views/utilcommon.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { infoLinks } from '../../../shared/js/infolinks.js';
import {
    DATA_PATH, RETURNS_PATH, RETURNS_DIR, RETURN_COLUMNS, loadData, saveData, loadReturns, saveReturns, loadDocuments,
    seasonStatus, dueDate, docsProgress, dateOf, longDate, amountOf, returnStatus,
} from '../taxes.js';

let checks = [];
export const hasUnsavedEdits = () => checks.some(f => f());
export const forget = () => { checks = []; closeFilterMenu(); clearResize(); };

const WHERES_MY_REFUND = 'https://www.irs.gov/wheres-my-refund';
const yearOf = r => String(r['Tax Year'] ?? '').trim();
/** A return's result: + refund, − owed (NaN with neither filled in). */
const net = r => { const a = amountOf(r.Refund), b = amountOf(r['Amount Owed']); return Number.isFinite(a) || Number.isFinite(b) ? (a || 0) - (b || 0) : NaN; };
const daysText = n => (n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'}`);

/** The banner for seasonStatus `s`, with how many of the year's documents are in. */
function banner(s, docs) {
    const cls = s.level === 'red' ? 'bad' : s.level === 'yellow' ? 'updated-aging' : s.level === 'ok' ? 'ok' : 'info';
    const p = docs ? docsProgress(docs) : null;
    const docLine = p && p.needed ? ` · <a href="#documents/${esc(s.year)}">${p.received} of ${p.needed} documents in</a>` : '';
    const body = {
        filed: `✓ <strong>${esc(s.text)}</strong>${s.row && returnStatus(s.row) === 'Waiting for refund' ? ` · waiting for the ${esc(money(amountOf(s.row.Refund)))} refund` : ''}`,
        refund: `<strong>${esc(s.text)}.</strong> Check <a href="${WHERES_MY_REFUND}" target="_blank" rel="noopener">Where's My Refund ↗</a>, and add the day it came in as Refund Received below.`,
        missing: `<strong>${esc(s.text)}.</strong> Fill in when it was filed and the refund or amount owed, so next year has it to compare.`,
        late: `<strong>${esc(s.text)}.</strong>${docLine} If you filed it, add the date under Tax returns; if you filed an extension, write "extension" in its Notes.`,
        due: `<strong>${esc(s.text)}</strong>${docLine}${s.level ? '' : ' · W-2s and 1099s come by the end of January'}`,
    }[s.kind];
    return `<div class="banner ${cls}">${body}</div>`;
}

export async function renderOverview(el) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const [data, returns] = await Promise.all([loadData(), loadReturns()]);
    const s = seasonStatus(returns);
    const docs = await loadDocuments(s.year, false);
    el.innerHTML = `
        <h1 class="page">Taxes</h1>
        <div id="season"></div>
        <p class="lead">Each year's return, the filing deadline, and for each tax year the documents to gather and things to remember
            (Documents). Kept in <code>${esc(DATA_PATH)}</code> and <code>${esc(RETURNS_PATH)}</code>.</p>
        <div class="cards kpis" id="cards"></div>
        <section>
            <h2 class="info-head" id="links-head"></h2>
            <div id="links-hints"></div>
            <div id="info"></div>
        </section>
        <section>
            <h2>Tax returns <span class="sub">one entry a tax year · the return itself goes in Return (PDF or photos)</span></h2>
            <p class="section-note">If you file an extension, write "extension" in that year's Notes: its deadline becomes October 15.</p>
            <div id="returns"></div>
        </section>
        <section id="chart-sec">
            <h2>Refund or amount owed by year</h2>
            <canvas id="c-net" style="display:block;width:100%;height:220px"></canvas>
        </section>`;
    el.querySelector('#season').innerHTML = banner(s, docs);

    const drawCards = rows => {
        const filed = rows.filter(r => dateOf(r['Filed On'])).sort((a, b) => yearOf(b).localeCompare(yearOf(a)));
        const last = filed[0];
        // The next deadline still ahead: this season's while it isn't filed, else the next tax year's.
        const t = seasonStatus(rows), nextYear = t.kind === 'due' ? t.year : String(+t.year + 1);
        const nextDue = t.kind === 'due' ? t.due : dueDate(nextYear), days = Math.round((nextDue - new Date(new Date().toDateString())) / 864e5);
        const recent = rows.filter(r => +yearOf(r) >= new Date().getFullYear() - 5 && Number.isFinite(net(r)));
        const fees = rows.map(r => amountOf(r['Prep Fee'])).filter(Number.isFinite);
        el.querySelector('#cards').innerHTML = [
            card('Next deadline', longDate(nextDue), `<span class="muted">the ${esc(nextYear)} return · ${esc(daysText(days))} from now</span>`, days <= 14 ? 'var(--red)' : ''),
            last ? card(`${yearOf(last)} return`, Number.isFinite(net(last)) ? money(Math.abs(net(last))) : '—',
                `<span class="muted">${Number.isFinite(net(last)) ? (net(last) >= 0 ? 'refund' : 'owed') + ' · ' : ''}filed ${esc(longDate(dateOf(last['Filed On'])))}${last['Prepared By'] ? ` by ${esc(last['Prepared By'])}` : ''}</span>`,
                Number.isFinite(net(last)) ? (net(last) >= 0 ? 'var(--green)' : 'var(--red)') : '')
                : card('Last return', '—', '<span class="muted">add it under Tax returns</span>'),
            card('Last 5 years', recent.length ? money(recent.reduce((a, r) => a + net(r), 0)) : '—',
                `<span class="muted">${recent.length ? `refunds less amounts owed, ${recent.length} return${recent.length === 1 ? '' : 's'}` : 'refunds less amounts owed'}</span>`),
            card('Prep fees', fees.length ? money(fees.reduce((a, b) => a + b, 0)) : '—', `<span class="muted">${fees.length ? `${fees.length} year${fees.length === 1 ? '' : 's'}, about ${esc(money(fees.reduce((a, b) => a + b, 0) / fees.length))} a year` : 'what the preparer charged'}</span>`),
        ].join('');
    };
    const drawChart = rows => {
        const pts = rows.filter(r => /^\d{4}$/.test(yearOf(r)) && Number.isFinite(net(r))).sort((a, b) => yearOf(a).localeCompare(yearOf(b)));
        el.querySelector('#chart-sec').hidden = pts.length < 2;
        if (pts.length < 2) return;
        drawBars(el.querySelector('#c-net'), {
            labels: pts.map(yearOf),
            series: [{ name: 'Refund (+) or owed (−)', values: pts.map(net), color: '#27ae60', negColor: '#c0392b', valueLabels: true }],
            fmt: v => `$${Math.round(v).toLocaleString('en-US')}`, valueFmt: v => money(v), tipFmt: money,
        });
    };
    let current = returns;
    drawCards(current);
    const redraw = () => drawChart(current);
    redraw();
    setResize(redraw);

    const links = infoLinks(el.querySelector('#links-head'), el.querySelector('#links-hints'), data.links, async list => {
        const latest = await loadData(); // re-read, so the information and years saved since stay
        await saveData({ ...latest, links: list });
        data.links = list;
    }, { title: 'Information <span class="sub">your filing details and the websites you use</span>', example: 'IRS online account' });
    const info = infoBox(el.querySelector('#info'), {
        info: data.info,
        noun: 'tax',
        save: async newInfo => { const latest = await loadData(); await saveData({ ...latest, info: newInfo }); data.info = newInfo; },
    });
    const table = recordTable(el.querySelector('#returns'), {
        columns: RETURN_COLUMNS,
        rows: returns,
        filesDir: RETURNS_DIR,
        save: async r => {
            await saveReturns(r);
            current = r;
            const t = seasonStatus(r);
            el.querySelector('#season').innerHTML = banner(t, await loadDocuments(t.year, false));
            drawCards(r);
            redraw();
        },
    });
    checks = [() => links.hasUnsavedEdits(), () => info.hasUnsavedEdits(), () => table.hasUnsavedEdits()];
}
