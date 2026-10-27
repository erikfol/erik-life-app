// Christmas: one list per year (#christmas/<year>, a pill for each year, "＋ Add year" #christmas/add) — who's getting
// what, with links, prices and status — with the year's totals and a By person table that also lists who was on the
// year before's list but has nothing yet.
import { esc, toast, money } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import {
    saveData, christmasPath, christmasColumns, loadChristmas, saveChristmas, christmas, inDays, showDay, tally, isFor,
} from '../gifts.js';
import { tallyText } from './person.js';

const SOON_DAYS = 14; // this close to Christmas with gifts still to buy, the banner turns red
const BANNER_DAYS = 90; // a Christmas further off than this gets no banner (the cards say where it stands)

let table = null;

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits();
export const forget = () => { table = null; closeFilterMenu(); };

const pills = (years, active) => `<nav class="pillnav">${years.map(y => `<a href="#christmas/${esc(y)}"${y === active ? ' class="active"' : ''}>${esc(y)}</a>`).join('')}`
    + `<a href="#christmas/add"${active === 'add' ? ' class="active"' : ''}>＋ Add year</a></nav>`;

/** Names in first-seen order (ignoring case). */
const names = rows => {
    const seen = new Map();
    for (const r of rows) { const n = String(r.Person || '').trim(); if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n); }
    return [...seen.values()];
};

function banner(year, rows) {
    const { date, days } = christmas(year);
    if (days < 0 || days > BANNER_DAYS) return '';
    const t = tally(rows);
    const when = `Christmas ${inDays(days)} (${esc(showDay(date))})`;
    if (!t.count) return `<div class="banner"><strong>${when}</strong> — nothing on the ${esc(year)} list yet.</div>`;
    if (t.todo) {
        return `<div class="banner${days <= SOON_DAYS ? ' bad' : ''}"><strong>${when}:</strong> ${t.todo} of ${t.count} gift${t.count === 1 ? '' : 's'} still to buy (${esc(money(t.toBuy))})${
            t.waiting ? `, ${t.waiting} on the way` : ''}.</div>`;
    }
    return `<div class="banner ok"><strong>${when}:</strong> everything's bought${t.waiting ? ` (${t.waiting} on the way)` : ''}.</div>`;
}

const cards = t => `<div class="cards">
    <div class="card"><div class="label">Total</div><div class="value">${esc(money(t.total))}</div><div class="sub">${t.count} gift${t.count === 1 ? '' : 's'}${t.ideas ? ` · ${t.ideas} idea${t.ideas === 1 ? '' : 's'} not counted` : ''}</div></div>
    <div class="card"><div class="label">Bought</div><div class="value">${esc(money(t.spent))}</div><div class="sub">${t.got + t.waiting} gift${t.got + t.waiting === 1 ? '' : 's'}${t.waiting ? ` · ${t.waiting} on the way` : ''}</div></div>
    <div class="card"><div class="label">Still to buy</div><div class="value">${esc(money(t.toBuy))}</div><div class="sub">${t.todo} gift${t.todo === 1 ? '' : 's'}</div></div>
</div>`;

/** Each person's gifts and totals this year, with the year before's total; then who had gifts that year but none yet. */
function byPerson(rows, prevYear, prevRows) {
    const people = names(rows);
    const missing = prevYear ? names(prevRows).filter(n => !people.some(x => x.toLowerCase() === n.toLowerCase())) : [];
    if (!people.length && !missing.length) return '<p class="muted">No one on the list yet. Press Edit under Gifts to add the first gift.</p>';
    const prev = n => (prevYear ? `<td class="amt muted">${esc(money(tally(prevRows.filter(isFor(n))).total))}</td>` : '');
    const noName = rows.filter(r => !String(r.Person || '').trim());
    const line = (n, list) => {
        const t = tally(list);
        return `<tr><td>${esc(n)}</td><td class="text">${tallyText(t) || '<span class="muted">only blank entries</span>'}</td>
            <td class="amt">${esc(money(t.total))}</td><td class="amt">${t.todo ? esc(money(t.toBuy)) : '<span class="muted">—</span>'}</td>${prev(n)}</tr>`;
    };
    return `<div class="table-wrap"><table class="by-person">
        <thead><tr><th>Person</th><th>Gifts</th><th class="num">Total</th><th class="num">To buy</th>${prevYear ? `<th class="num">${esc(prevYear)}</th>` : ''}</tr></thead>
        <tbody>
            ${people.map(n => line(n, rows.filter(isFor(n)))).join('')}
            ${noName.length ? line('(no person)', noName) : ''}
            ${missing.map(n => `<tr class="missing"><td>${esc(n)}</td><td class="muted">nothing yet</td><td></td><td></td>${prev(n)}</tr>`).join('')}
        </tbody>
    </table></div>`;
}

/** data: everything in gifts.json (saved back whole); onChanged(goTo) re-reads it and opens #goTo. */
export async function renderChristmas(el, data, year, onChanged) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const years = data.christmasYears;
    const others = years.filter(y => y !== year);
    const [rows, ...otherLists] = await Promise.all([loadChristmas(year), ...others.map(y => loadChristmas(y, false))]);
    const prevYear = others.filter(y => +y < +year).at(-1) || null;
    const prevRows = prevYear ? otherLists[others.indexOf(prevYear)] : [];
    // Person offers the people pages, then everyone on the other years' lists (newest year first).
    const people = [...data.people.map(p => p.name), ...others.slice().reverse().flatMap(y => names(otherLists[others.indexOf(y)]))];
    el.innerHTML = `
        <h1 class="page">Christmas ${esc(year)}</h1>
        ${pills(years, year)}
        <div id="x-banner"></div>
        <p class="lead">The ${esc(year)} list is saved in <code>${esc(christmasPath(year))}</code> in your folder.</p>
        <div id="x-cards"></div>
        <section>
            <h2>By person</h2>
            <div id="x-people"></div>
        </section>
        <section>
            <h2>Gifts</h2>
            <p class="section-note">One row per gift. Status: Idea (not counted in the totals), Plan (still to buy), Bought,
                Waiting to get (on the way), Received, Given — or type your own.</p>
            <div id="x-table"></div>
        </section>
        <div class="row"><span class="spacer"></span>
            <button type="button" class="danger small" id="remove-year">Remove ${esc(year)} from the Christmas lists</button></div>`;
    const draw = r => {
        el.querySelector('#x-banner').innerHTML = banner(year, r);
        el.querySelector('#x-cards').innerHTML = cards(tally(r));
        el.querySelector('#x-people').innerHTML = byPerson(r, prevYear, prevRows);
    };
    draw(rows);
    table = recordTable(el.querySelector('#x-table'), {
        columns: christmasColumns(people),
        rows,
        save: async r => { await saveChristmas(year, r); draw(r); },
    });
    el.querySelector('#remove-year').onclick = async () => {
        if (!confirm(`Remove ${year} from the Christmas lists?\n\nIts list (${christmasPath(year)}) is kept in your folder: add ${year} again to bring it back.`)) return;
        try {
            await saveData({ ...data, christmasYears: years.filter(y => y !== year) });
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        table = null;
        toast(`Removed ${year}`, 'ok');
        onChanged('christmas');
    };
}

/** "＋ Add year": the year after the newest list (this year's if there's none for it yet). */
export function renderAddYear(el, data, onChanged) {
    const years = data.christmasYears;
    const now = new Date().getFullYear();
    const suggest = years.includes(String(now)) ? Math.max(now, ...years.map(Number)) + 1 : now;
    el.innerHTML = `
        <h1 class="page">Christmas</h1>
        ${pills(years, 'add')}
        <section>
            <h2>Add a year</h2>
            <form id="year-form" class="new-vehicle">
                <label class="field">Year<input type="number" name="year" min="1900" max="2200" step="1" required value="${suggest}"></label>
                <p class="muted">${years.length ? `The By person table shows who was on the ${esc(years.filter(y => +y < suggest).at(-1) || years.at(-1))} list, so you can see who still needs a gift.` : ''}</p>
                <div class="row"><button class="primary">Add year</button></div>
            </form>
        </section>`;
    el.querySelector('#year-form').onsubmit = async e => {
        e.preventDefault();
        const year = String(new FormData(e.target).get('year')).trim();
        if (!/^\d{4}$/.test(year)) return toast('Type a year like 2027.', 'bad');
        if (years.includes(year)) return onChanged(`christmas/${year}`);
        try {
            await saveData({ ...data, christmasYears: [...years, year] });
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added ${year}`, 'ok');
        onChanged(`christmas/${year}`);
    };
}

/** The year #christmas opens: the coming Christmas's if it has a list, else the newest. */
export function defaultYear(years, coming) {
    return years.includes(coming) ? coming : years.at(-1) || null;
}
