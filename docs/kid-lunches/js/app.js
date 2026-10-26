// Kid Lunches: a week/month calendar like the Dinner Planner's, with a lunch box for each kid on every day. Each part of
// the box (store.COMPARTMENTS) only takes that kid's items for it, set in ✎ Box. Uses the same folder as Bills Etc (the
// browser remembers it for the whole site); the data lives in inputs/kid-lunches/ (js/store.js).
import * as fs from '../../bills-etc/js/fs.js';
import { esc, toast } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import * as store from './store.js';
import * as school from './school.js';

// School days only: weeks run Monday to Friday, and Saturday and Sunday aren't shown.
const WEEK_START = 1;
const SCHOOL_DAYS = 5;

const state = {
    kids: [],
    items: {},
    days: {},
    view: 'week',
    cursor: new Date(),
};

// ---------- utilities ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dateKey = store.localDate;
function parseKey(k) {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(d, n) {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    r.setDate(r.getDate() + n);
    return r;
}
const startOfWeek = d => addDays(d, -((d.getDay() - WEEK_START + 7) % 7));
// On a Saturday or Sunday, the school week ahead.
const schoolWeek = d => startOfWeek(d.getDay() === 0 || d.getDay() === 6 ? addDays(d, 2) : d);
const schoolDays = start => Array.from({ length: SCHOOL_DAYS }, (_, i) => addDays(start, i));
const todayKey = () => dateKey(new Date());
const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const kidClass = i => `k${i % 4}`; // each kid's color

/** Wrap an event handler so a failed save shows what went wrong. */
const guard = fn => async (...args) => {
    try {
        await fn(...args);
    } catch (err) {
        console.error(err);
        toast(err.message, 'bad');
    }
};

function reload() {
    ({ kids: state.kids, items: state.items, days: state.days } = store.data());
    renderCalendar();
}

// ---------- calendar ----------

function renderCalendar() {
    const cal = $('#calendar');
    const today = todayKey();
    $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    $$('.week-only').forEach(el => (el.hidden = state.view !== 'week'));
    $('#no-kids').hidden = state.kids.length > 0;

    let days;
    if (state.view === 'week') {
        const start = schoolWeek(state.cursor);
        days = schoolDays(start);
        const end = days.at(-1);
        const sameMonth = start.getMonth() === end.getMonth();
        $('#cal-title').textContent = `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${end.getFullYear()}`;
        cal.className = 'cal-week';
    } else {
        const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
        const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
        days = [];
        for (let w = schoolWeek(first); w <= last; w = addDays(w, 7)) days.push(...schoolDays(w));
        $('#cal-title').textContent = fmt(first, { month: 'long', year: 'numeric' });
        cal.className = 'cal-month';
    }

    const dowHeader = state.view === 'month'
        ? days.slice(0, SCHOOL_DAYS).map(d => `<div class="cal-dow">${fmt(d, { weekday: 'short' })}</div>`).join('')
        : '';

    cal.innerHTML = dowHeader + days.map(d => {
        const key = dateKey(d);
        const e = state.days[key] || {};
        const classes = ['day'];
        if (key === today) classes.push('today');
        if (key < today) classes.push('past');
        if (state.view === 'month' && d.getMonth() !== state.cursor.getMonth()) classes.push('other-month');

        const label = state.view === 'week' ? `${fmt(d, { weekday: 'short' })} ${d.getDate()}` : d.getDate();
        const badge = key === today ? '<span class="badge">Today</span>' : '';

        // Week: every kid, with a small lunch box once something's in it. Month: only the kids with a lunch, as text.
        const body = state.kids.map((kid, i) => {
            const lunch = e[kid];
            const head = `<span class="kid-lunch ${kidClass(i)}"><span class="kid">${esc(kid)}</span>`;
            if (state.view === 'month') {
                const items = lunch && store.COMPARTMENTS.flatMap(c => lunch[c.id] || []).join(', ');
                return lunch ? `${head}<span class="lunch">${esc(items || lunch.note)}</span></span>` : '';
            }
            if (!lunch) return `${head}<span class="empty">${key < today ? '—' : '+ Add lunch'}</span></span>`;
            const box = store.COMPARTMENTS.some(c => lunch[c.id]) ? miniBox(lunch, key) : '';
            return `${head}${box}${lunch.note ? `<span class="meal-note">${esc(lunch.note)}</span>` : ''}</span>`;
        }).join('');
        return `<div role="button" tabindex="0" class="${classes.join(' ')}" data-date="${key}"><span class="date"><span>${label}</span>${badge}</span>${body}${schoolLunch(key)}</div>`;
    }).join('');
}

/** The school's lunch that day, read-only, from 🏫 School menu: in week view the first main dish and then the rest; in
 *  month view just the first. */
function schoolLunch(date, wide = false) {
    const m = school.dayMenu(date);
    if (!m) return '';
    const tag = wide ? 'div' : 'span';
    if (state.view === 'month' && !wide) {
        return `<span class="school" title="${m.closed ? 'School closed' : `School lunch: ${esc(m.items.map(i => i.name).join(', '))}`}">`
            + `<span class="school-main">🏫 ${m.closed ? 'Closed' : esc(m.items[0].name)}</span></span>`;
    }
    if (m.closed) return `<${tag} class="school"><span class="school-name">🏫 School</span><span class="school-main">Closed</span></${tag}>`;
    const [first, ...rest] = m.items;
    return `<${tag} class="school" title="From the school's menu"><span class="school-name">🏫 School lunch</span><span class="school-main">${esc(first.name)}</span>`
        + `${rest.length ? `<span class="school-rest">${rest.map(i => esc(i.name)).join(' · ')}</span>` : ''}</${tag}>`;
}

/** A kid's lunch as markup, `part(c)` giving each part's: the main entree on its own, above the box's tray. */
const boxHtml = (part, cls = '', tag = 'div') => `<${tag} class="box ${cls}">${store.COMPARTMENTS.filter(c => !c.tray).map(part).join('')}`
    + `<${tag} class="tray">${store.COMPARTMENTS.filter(c => c.tray).map(part).join('')}</${tag}></${tag}>`;

// A main entree every kid can pick, instead of a packed one: they eat what the school serves that day.
const SCHOOL_LUNCH = 'School lunch';
const isSchoolLunch = name => store.sameName(name, SCHOOL_LUNCH);

/** A kid's lunch drawn as the box, each item in its part; School lunch says what the school is serving. */
const miniBox = (lunch, date) => boxHtml(c => `<span class="comp ${c.id}" title="${esc(c.name)}">${(lunch[c.id] || []).map(n => {
    if (!isSchoolLunch(n)) return esc(n);
    const dish = school.dayMenu(date)?.items?.[0]?.name;
    return `🏫 ${esc(SCHOOL_LUNCH)}${dish ? `<span class="school-dish">${esc(dish)}</span>` : ''}`;
}).join('<br>')}</span>`, 'mini', 'span');

function shiftCursor(dir) {
    const c = state.cursor;
    state.cursor = state.view === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    renderCalendar();
}

// ---------- day dialog ----------

const itemChip = (name, on, isNew = false) => `<button type="button" class="chip ${on ? 'active' : ''}${isSchoolLunch(name) ? ' school-pick' : ''}"`
    + ` data-item="${esc(name)}" aria-pressed="${on}"${isNew ? ' data-new' : ''}>${isSchoolLunch(name) ? '🏫 ' : ''}${esc(name)}</button>`;

/** A kid's lunch box to build: each part offers that kid's items for it (plus any saved on this day that have since left
 *  the list) as chips to click on or off, and takes a new item typed below them. The main entree also offers School
 *  lunch first, unless the school is closed that day. */
function buildBox(kid, lunch, date) {
    lunch ||= {};
    return boxHtml(c => {
        const list = state.items[kid][c.id];
        const picked = lunch[c.id] || [];
        let names = [...list, ...picked.filter(p => !list.some(n => store.sameName(n, p)))];
        if (c.id === 'main') {
            const schoolPicked = picked.some(isSchoolLunch);
            names = names.filter(n => !isSchoolLunch(n));
            if (schoolPicked || !school.dayMenu(date)?.closed) names.unshift(SCHOOL_LUNCH);
        }
        return `<div class="comp ${c.id}" data-comp="${c.id}">
            <span class="comp-name">${esc(c.name)}</span>
            <span class="comp-items">${names.map(n => itemChip(n, picked.some(p => store.sameName(p, n)))).join('')}</span>
            <input class="new-item" maxlength="60" placeholder="+ New…" aria-label="New item for the ${esc(c.name.toLowerCase())}">
        </div>`;
    });
}

function openDay(date) {
    if (!state.kids.length) return openKids();
    const e = state.days[date] || {};
    const form = $('#day-form');
    form.dataset.date = date;
    $('#day-dialog-title').textContent = fmt(parseKey(date), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('#day-school').innerHTML = schoolLunch(date, true);
    $('#kid-fields').innerHTML = state.kids.map((kid, i) => `<fieldset class="kid-field ${kidClass(i)}" data-kid="${i}">
            <legend>${esc(kid)}</legend>
            ${buildBox(kid, e[kid], date)}
            <input class="kid-note" maxlength="200" aria-label="${esc(kid)}'s note" placeholder="Note (e.g. buying lunch, field trip)">
        </fieldset>`).join('');
    state.kids.forEach((kid, i) => { $(`.kid-field[data-kid="${i}"] .kid-note`, form).value = e[kid]?.note || ''; });
    $('#day-dialog').showModal();
}

/** The parts of a kid's box an item already belongs to: on that kid's list in ✎ Box, or typed in as new in this dialog. */
function homesOf(field, name) {
    const kid = state.kids[field.dataset.kid];
    return store.COMPARTMENTS.filter(c => state.items[kid][c.id].some(n => store.sameName(n, name))
        || $$(`[data-comp="${c.id}"] .chip[data-new]`, field).some(b => store.sameName(b.dataset.item, name)));
}

/** Put the item typed below a part into it. False (with a message) when it belongs in a different part. */
function addTyped(input) {
    const name = input.value.trim();
    if (!name) return true;
    const comp = input.closest('[data-comp]');
    const field = input.closest('.kid-field');
    const existing = $$('.chip', comp).find(b => store.sameName(b.dataset.item, name));
    if (existing) {
        pickChip(existing, true);
    } else {
        const homes = isSchoolLunch(name) ? store.COMPARTMENTS.filter(c => c.id === 'main' && c.id !== comp.dataset.comp)
            : homesOf(field, name).filter(c => c.id !== comp.dataset.comp);
        if (homes.length) {
            const kid = state.kids[field.dataset.kid];
            const listed = state.items[kid][homes[0].id].find(n => store.sameName(n, name)) || name;
            toast(`${listed} goes in the ${homes.map(c => c.name.toLowerCase()).join(' or the ')} of ${kid}'s box. To change that, use ✎ Box.`, 'bad');
            input.select();
            return false;
        }
        // A new item for this part of this kid's box.
        $('.comp-items', comp).insertAdjacentHTML('beforeend', itemChip(name, true, true));
    }
    input.value = '';
    return true;
}

/** Pick an item on or off. Suggested picks are marked so ✨ Suggest can swap them; anything picked by hand stays. */
function setChip(chip, on, suggested = false) {
    chip.classList.toggle('active', on);
    chip.setAttribute('aria-pressed', on);
    chip.toggleAttribute('data-suggested', on && suggested);
}

/** Pick an item on or off by hand. In the main entree, School lunch takes the place of a packed entree and the other
 *  way round. */
function pickChip(chip, on) {
    setChip(chip, on);
    const main = chip.closest('[data-comp="main"]');
    if (!on || !main) return;
    const buying = isSchoolLunch(chip.dataset.item);
    $$('.chip.active', main).filter(b => b !== chip && (buying || isSchoolLunch(b.dataset.item))).forEach(b => setChip(b, false));
}

// ---------- suggestions ----------

/** How many days this kid has had an item (in any part), and how far the nearest of those days is from `date`. */
function itemHistory(kid, item, date) {
    let count = 0;
    let near = null;
    for (const [d, e] of Object.entries(state.days)) {
        const lunch = e[kid];
        if (d === date || !lunch || !store.COMPARTMENTS.some(c => (lunch[c.id] || []).some(n => store.sameName(n, item)))) continue;
        count++;
        const gap = Math.abs(daysBetween(d, date));
        if (near === null || gap < near) near = gap;
    }
    return { count, near };
}

const MAX_COMBOS = 20000; // more ways to fill a box than this and the parts are picked one at a time instead

/** A random pick from [{ w, … }], each as likely as its weight. */
function weightedPick(list) {
    let x = Math.random() * list.reduce((s, o) => s + o.w, 0);
    for (const o of list) if ((x -= o.w) <= 0) return o;
    return list.at(-1);
}

/** Picks for some parts of one kid's box, { part id: item }. Each of `parts` is { id, options, previous }; `taken` is
 *  what's already in the box's other parts, since the same item never goes in two parts of one box. Each item weighs
 *  mostly by how long it's been since the kid had it (days around this one, planned days count too), a little more for
 *  what they've had a lot, and much less for the part's previous pick, so pressing again gives something else. */
function pickParts(kid, date, parts, taken = []) {
    const base = new Map();
    const weight = (p, name) => {
        const key = name.toLowerCase();
        if (!base.has(key)) {
            const { count, near } = itemHistory(kid, name, date);
            base.set(key, (near === null ? 1 : Math.max(0.02, Math.min(1, near / 7) ** 2)) * (1 + Math.min(count, 10) / 10));
        }
        return base.get(key) * (p.options.length > 1 && (p.previous || []).some(n => store.sameName(n, name)) ? 0.05 : 1);
    };
    // Every way to fill the parts without repeating an item, weighted by its items, then one picked at random. Picking
    // the whole box at once matters when parts share items (Strawberry in two parts): one at a time, the first part
    // would keep taking the shared item and leave the other part the same leftover every day.
    let combos = [{ picks: {}, used: new Set(taken.map(n => n.toLowerCase())), w: 1 }];
    for (const p of parts) {
        const next = [];
        for (const combo of combos) {
            const options = p.options.filter(n => !combo.used.has(n.toLowerCase()));
            if (!options.length) next.push(combo);
            for (const n of options) {
                next.push({ picks: { ...combo.picks, [p.id]: n }, used: new Set([...combo.used, n.toLowerCase()]), w: combo.w * weight(p, n) });
            }
        }
        combos = next;
        if (combos.length > MAX_COMBOS) return pickPartsOneByOne(parts, taken, weight);
    }
    const most = Math.max(...combos.map(c => Object.keys(c.picks).length)); // fill every part that can be filled
    return weightedPick(combos.filter(c => Object.keys(c.picks).length === most)).picks;
}

/** The same, one part at a time (fewest choices first), for boxes with very long lists. */
function pickPartsOneByOne(parts, taken, weight) {
    const used = new Set(taken.map(n => n.toLowerCase()));
    const picks = {};
    for (const p of [...parts].sort((a, b) => a.options.length - b.options.length)) {
        const options = p.options.filter(n => !used.has(n.toLowerCase()));
        if (!options.length) continue;
        picks[p.id] = weightedPick(options.map(name => ({ name, w: weight(p, name) }))).name;
        used.add(picks[p.id].toLowerCase());
    }
    return picks;
}

/** ✨ Suggest: one item in every part of each kid's box that wasn't picked by hand (if every part was, all of them get
 *  new picks). */
function suggestDay() {
    const form = $('#day-form');
    const date = form.dataset.date;
    let filled = 0;
    for (const field of $$('.kid-field', form)) {
        const kid = state.kids[field.dataset.kid];
        const parts = store.COMPARTMENTS.map(c => {
            const chips = $$(`[data-comp="${c.id}"] .chip`, field);
            const active = chips.filter(b => b.classList.contains('active'));
            return {
                id: c.id,
                chips,
                byHand: active.some(b => !b.hasAttribute('data-suggested')),
                schoolLunch: active.some(b => isSchoolLunch(b.dataset.item)), // only ever picked by hand, and it stays
                previous: active.map(b => b.dataset.item),
                // the kid's list in ✎ Box, plus anything typed in as new while this dialog is open
                options: chips.filter(b => !isSchoolLunch(b.dataset.item)
                    && (b.hasAttribute('data-new') || state.items[kid][c.id].some(n => store.sameName(n, b.dataset.item)))).map(b => b.dataset.item),
            };
        });
        let open = parts.filter(p => !p.byHand && p.options.length);
        if (!open.length) open = parts.filter(p => p.options.length && !p.schoolLunch);
        const picks = pickParts(kid, date, open, parts.filter(p => !open.includes(p)).flatMap(p => p.previous));
        for (const p of open) {
            p.chips.forEach(b => setChip(b, false));
            if (picks[p.id]) setChip(p.chips.find(b => b.dataset.item === picks[p.id]), true, true);
        }
        filled += Object.keys(picks).length;
    }
    if (!filled) toast('Nothing to suggest yet. Add what can go in each part with ✎ Box.');
}

/** ✨ Fill empty days: a suggested lunch for every kid without one on the days left in the week shown (not on days the
 *  school menu says the school is closed). */
async function fillWeek() {
    const today = todayKey();
    const partsFor = kid => store.COMPARTMENTS.map(c => ({ id: c.id, options: state.items[kid][c.id].filter(n => !isSchoolLunch(n)) }));
    let count = 0;
    try {
        for (const d of schoolDays(schoolWeek(state.cursor))) {
            const date = dateKey(d);
            if (date < today || school.dayMenu(date)?.closed) continue; // no school, no lunch to pack
            const day = { ...state.days[date] };
            let packed = 0;
            for (const kid of state.kids) {
                if (day[kid]) continue; // anything there already (even just a note) stays as it is
                const picks = pickParts(kid, date, partsFor(kid));
                if (!Object.keys(picks).length) continue;
                day[kid] = Object.fromEntries(Object.entries(picks).map(([id, item]) => [id, [item]]));
                packed++;
            }
            if (!packed) continue;
            await store.setDay(date, day); // state.days is the store's, so later days see it
            count += packed;
        }
    } finally {
        reload();
    }
    if (count) toast(`Packed ${count} lunch${count > 1 ? 'es' : ''}`);
    else toast(state.kids.some(kid => store.COMPARTMENTS.some(c => state.items[kid][c.id].length))
        ? 'Every day left this week already has a lunch for each kid'
        : 'Nothing to pack yet. Add the kids and what goes in each part (✎ Kids, ✎ Box).');
}

async function saveDay(ev) {
    ev.preventDefault();
    const form = $('#day-form');
    if (!$$('.new-item', form).every(addTyped)) return; // typed but not added with Enter yet
    const lunches = {};
    const newItems = {};
    for (const field of $$('.kid-field', form)) {
        const kid = state.kids[field.dataset.kid];
        const chips = (c, sel) => $$(`[data-comp="${c.id}"] .chip${sel}`, field).map(b => b.dataset.item);
        lunches[kid] = { note: $('.kid-note', field).value };
        newItems[kid] = {};
        for (const c of store.COMPARTMENTS) {
            lunches[kid][c.id] = chips(c, '.active');
            newItems[kid][c.id] = chips(c, '[data-new]');
        }
    }
    await store.setDay(form.dataset.date, lunches, newItems);
    $('#day-dialog').close();
    reload();
}

async function clearDay() {
    await store.setDay($('#day-form').dataset.date, {});
    $('#day-dialog').close();
    reload();
}

// ---------- box dialog ----------

/** Each kid's own box (they like different things), one item per line in each part. */
function openBox() {
    if (!state.kids.length) return openKids();
    $('#box-items').innerHTML = state.kids.map((kid, i) => `<fieldset class="kid-field ${kidClass(i)}" data-kid="${i}">
            <legend>${esc(kid)}</legend>
            ${boxHtml(c => `<label class="comp ${c.id}">
                <span class="comp-name">${esc(c.name)}</span>
                <textarea rows="${c.tray ? 4 : 3}" data-comp="${c.id}" aria-label="What goes in ${esc(kid)}'s ${esc(c.name.toLowerCase())}, one per line"></textarea>
            </label>`)}
        </fieldset>`).join('');
    state.kids.forEach((kid, i) => {
        for (const c of store.COMPARTMENTS) $(`#box-items [data-kid="${i}"] textarea[data-comp="${c.id}"]`).value = state.items[kid][c.id].join('\n');
    });
    $('#box-dialog').showModal();
}

async function saveBox(ev) {
    ev.preventDefault();
    await store.setItems(Object.fromEntries($$('#box-items .kid-field').map(f => [
        state.kids[f.dataset.kid],
        Object.fromEntries($$('textarea', f).map(t => [t.dataset.comp, t.value.split('\n')])),
    ])));
    $('#box-dialog').close();
    reload();
}

// ---------- school menu dialog ----------

function renderSchoolMonths() {
    const months = Object.entries(school.months()).sort(([a], [b]) => b.localeCompare(a));
    $('#school-months').innerHTML = months.length
        ? months.map(([ym, m]) => {
            const days = Object.values(m.days);
            const closed = days.filter(d => d.closed).length;
            return `<div class="backup-row">
                <span class="name"><span class="when">${esc(school.monthLabel(ym))}</span>
                    <span class="kind">· ${days.length - closed} school days${closed ? `, ${closed} closed` : ''} · loaded ${esc(new Date(m.loaded).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span></span>
                <button type="button" class="btn small" data-school-reload="${ym}" title="Load this month again, in case the school changed its menu">↻ Reload</button>
                <button type="button" class="btn small danger" data-school-remove="${ym}">Remove</button>
            </div>`;
        }).join('')
        : '<p class="hint">No months loaded yet.</p>';
}

function openSchool() {
    renderSchoolMonths();
    $('#school-dialog').showModal();
    $('#school-url').focus();
}

/** Load a month from a pasted link, or (`link` given) load a loaded month again. */
async function loadSchoolMonth(link) {
    const btn = $('#school-go');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
        const { ym, days } = await school.loadMonth(link);
        toast(`Loaded the school menu for ${school.monthLabel(ym)}: ${days} school days`, 'ok');
        $('#school-url').value = '';
        renderSchoolMonths();
        renderCalendar();
    } finally {
        btn.disabled = false;
        btn.textContent = 'Load';
    }
}

// ---------- kids dialog ----------

/** One kid in the Kids dialog; `from` is the index of an existing kid (so renaming keeps their lunches), '' for a new one. */
function addKidRow(name = '', from = '') {
    const row = document.createElement('div');
    row.className = 'kid-row';
    row.dataset.from = from;
    row.innerHTML = `<input maxlength="40" aria-label="Name" placeholder="Name"><button type="button" class="btn small" aria-label="Remove" title="Remove this kid">✕</button>`;
    row.querySelector('input').value = name;
    row.querySelector('button').onclick = () => row.remove();
    $('#kid-rows').append(row);
    return row;
}

function openKids() {
    $('#kid-rows').innerHTML = '';
    state.kids.forEach((kid, i) => addKidRow(kid, String(i)));
    if (!state.kids.length) addKidRow();
    $('#kids-dialog').showModal();
}

async function saveKids(ev) {
    ev.preventDefault();
    const list = $$('#kid-rows .kid-row')
        .map(r => ({ from: r.dataset.from === '' ? null : state.kids[r.dataset.from], name: r.querySelector('input').value.trim() }))
        .filter(k => k.name);
    const kept = new Set(list.map(k => k.from));
    const losing = state.kids.filter(k => !kept.has(k) && Object.values(state.days).some(e => e[k]));
    if (losing.length && !confirm(`Remove ${losing.join(' and ')}? Their lunches are deleted too.`)) return;
    await store.setKids(list);
    $('#kids-dialog').close();
    reload();
}

// ---------- wiring ----------

function wire() {
    $('#cal-prev').onclick = () => shiftCursor(-1);
    $('#cal-next').onclick = () => shiftCursor(1);
    $('#cal-today').onclick = () => { state.cursor = new Date(); renderCalendar(); };
    $$('.view-btn').forEach(b => (b.onclick = () => {
        state.view = b.dataset.view;
        try { localStorage.setItem('kid-lunches-view', state.view); } catch { /* storage blocked */ }
        renderCalendar();
    }));
    $('#calendar').onclick = ev => {
        const day = ev.target.closest('.day');
        if (day) openDay(day.dataset.date);
    };
    $('#calendar').onkeydown = ev => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('day')) {
            ev.preventDefault();
            openDay(ev.target.dataset.date);
        }
    };
    $('#day-form').onsubmit = guard(saveDay);
    $('#day-clear').onclick = guard(clearDay);
    $('#kid-fields').onclick = ev => {
        const chip = ev.target.closest('.chip');
        if (!chip) return;
        pickChip(chip, !chip.classList.contains('active'));
    };
    $('#day-suggest').onclick = suggestDay;
    $('#fill-week').onclick = guard(fillWeek);
    $('#kid-fields').onkeydown = ev => {
        if (ev.key === 'Enter' && ev.target.classList.contains('new-item')) {
            ev.preventDefault(); // Enter adds the item instead of saving the day
            addTyped(ev.target);
        }
    };
    $('#open-box').onclick = openBox;
    $('#open-school').onclick = openSchool;
    $('#school-form').onsubmit = guard(async ev => {
        ev.preventDefault();
        if (!$('#school-url').value.trim()) return toast('Paste the link to a month of the school menu first.', 'bad');
        await loadSchoolMonth($('#school-url').value);
    });
    $('#school-months').onclick = guard(async ev => {
        const reload = ev.target.closest('[data-school-reload]');
        if (reload) return loadSchoolMonth(school.months()[reload.dataset.schoolReload].url);
        const remove = ev.target.closest('[data-school-remove]');
        if (!remove) return;
        await school.removeMonth(remove.dataset.schoolRemove);
        renderSchoolMonths();
        renderCalendar();
    });
    $('#box-form').onsubmit = guard(saveBox);
    $$('[data-open-kids]').forEach(b => (b.onclick = openKids));
    $('#add-kid').onclick = () => addKidRow().querySelector('input').focus();
    $('#kids-form').onsubmit = guard(saveKids);
    $('#app').addEventListener('click', ev => {
        if (ev.target.closest('[data-close]')) ev.target.closest('dialog').close();
    });
}

async function start() {
    const viewEl = $('#view');
    if (!fs.folder()) {
        $('#app').hidden = true;
        return askForFolder(viewEl, { what: 'Kid lunches', where: `${store.DIR}/`, onConnected: start });
    }
    viewEl.innerHTML = '<p class="muted">Loading…</p>';
    try {
        await Promise.all([store.load(), school.load()]);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
        return;
    }
    try { state.view = localStorage.getItem('kid-lunches-view') || 'week'; } catch { /* storage blocked */ }
    viewEl.innerHTML = '';
    $('#app').hidden = false;
    wire();
    reload();
}

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    start();
})();
