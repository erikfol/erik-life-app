// Kid Lunches: a week/month calendar like the Dinner Planner's, with a lunch box for each kid on every day. Each part of
// the box (store.COMPARTMENTS) only takes its own items, set in ✎ Box. Uses the same folder as Bills Etc (the browser
// remembers it for the whole site); the data lives in inputs/kid-lunches/ (js/store.js).
import * as fs from '../../bills-etc/js/fs.js';
import { esc, toast } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import * as store from './store.js';

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
            const box = store.COMPARTMENTS.some(c => lunch[c.id]) ? miniBox(lunch) : '';
            return `${head}${box}${lunch.note ? `<span class="meal-note">${esc(lunch.note)}</span>` : ''}</span>`;
        }).join('');
        return `<div role="button" tabindex="0" class="${classes.join(' ')}" data-date="${key}"><span class="date"><span>${label}</span>${badge}</span>${body}</div>`;
    }).join('');
}

/** A kid's lunch drawn as the box, each item in its part. */
const miniBox = lunch => `<span class="box mini">${store.COMPARTMENTS.map(c =>
    `<span class="comp ${c.id}" title="${esc(c.name)}">${(lunch[c.id] || []).map(esc).join('<br>')}</span>`).join('')}</span>`;

function shiftCursor(dir) {
    const c = state.cursor;
    state.cursor = state.view === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    renderCalendar();
}

// ---------- day dialog ----------

const itemChip = (name, on, isNew = false) =>
    `<button type="button" class="chip ${on ? 'active' : ''}" data-item="${esc(name)}" aria-pressed="${on}"${isNew ? ' data-new' : ''}>${esc(name)}</button>`;

/** A kid's lunch box to build: each part offers its own items (plus any saved on this day that have since left its
 *  list) as chips to click on or off, and takes a new item typed below them. */
function buildBox(lunch = {}) {
    return `<div class="box">${store.COMPARTMENTS.map(c => {
        const picked = lunch[c.id] || [];
        const names = [...state.items[c.id], ...picked.filter(p => !state.items[c.id].some(n => store.sameName(n, p)))];
        return `<div class="comp ${c.id}" data-comp="${c.id}">
            <span class="comp-name">${esc(c.name)}</span>
            <span class="comp-items">${names.map(n => itemChip(n, picked.some(p => store.sameName(p, n)))).join('')}</span>
            <input class="new-item" maxlength="60" placeholder="+ New…" aria-label="New item for the ${esc(c.name.toLowerCase())}">
        </div>`;
    }).join('')}</div>`;
}

function openDay(date) {
    if (!state.kids.length) return openKids();
    const e = state.days[date] || {};
    const form = $('#day-form');
    form.dataset.date = date;
    $('#day-dialog-title').textContent = fmt(parseKey(date), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('#kid-fields').innerHTML = state.kids.map((kid, i) => `<fieldset class="kid-field ${kidClass(i)}" data-kid="${i}">
            <legend>${esc(kid)}</legend>
            ${buildBox(e[kid])}
            <input class="kid-note" maxlength="200" aria-label="${esc(kid)}'s note" placeholder="Note (e.g. buying lunch, field trip)">
        </fieldset>`).join('');
    state.kids.forEach((kid, i) => { $(`.kid-field[data-kid="${i}"] .kid-note`, form).value = e[kid]?.note || ''; });
    $('#day-dialog').showModal();
}

/** The parts an item already belongs to: its list in ✎ Box, or typed as new into that part in this dialog. */
function homesOf(name) {
    return store.COMPARTMENTS.filter(c => state.items[c.id].some(n => store.sameName(n, name))
        || $$(`[data-comp="${c.id}"] .chip[data-new]`, $('#day-form')).some(b => store.sameName(b.dataset.item, name)));
}

/** Put the item typed below a part into it. False (with a message) when it belongs in a different part. */
function addTyped(input) {
    const name = input.value.trim();
    if (!name) return true;
    const comp = input.closest('[data-comp]');
    const existing = $$('.chip', comp).find(b => store.sameName(b.dataset.item, name));
    if (existing) {
        setChip(existing, true);
    } else {
        const homes = homesOf(name).filter(c => c.id !== comp.dataset.comp);
        if (homes.length) {
            const listed = state.items[homes[0].id].find(n => store.sameName(n, name)) || name;
            toast(`${listed} goes in the ${homes.map(c => c.name.toLowerCase()).join(' or the ')}. To change that, use ✎ Box.`, 'bad');
            input.select();
            return false;
        }
        // A new item for this part: picked for this kid, offered to the others.
        $$(`[data-comp="${comp.dataset.comp}"] .comp-items`, $('#day-form')).forEach(list =>
            list.insertAdjacentHTML('beforeend', itemChip(name, list.closest('[data-comp]') === comp, true)));
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

/** A weighted random pick: mostly things the kid hasn't had in the days around this one (planned days count too),
 *  a little more often what they've had a lot, and something new when Suggest is pressed again. */
function suggestItem(kid, date, options, previous) {
    if (!options.length) return null;
    const weighted = options.map(name => {
        const { count, near } = itemHistory(kid, name, date);
        let w = (near === null ? 1 : Math.max(0.02, Math.min(1, near / 7) ** 2)) * (1 + Math.min(count, 10) / 10);
        if (options.length > 1 && previous.some(p => store.sameName(p, name))) w *= 0.05;
        return { name, w };
    });
    let x = Math.random() * weighted.reduce((s, o) => s + o.w, 0);
    for (const o of weighted) if ((x -= o.w) <= 0) return o.name;
    return weighted.at(-1).name;
}

/** ✨ Suggest: one item in every part of each kid's box that wasn't picked by hand (if every part was, all of them get
 *  new picks). The same item never goes in two parts of one box. */
function suggestDay() {
    const form = $('#day-form');
    const date = form.dataset.date;
    let filled = 0;
    for (const field of $$('.kid-field', form)) {
        const kid = state.kids[field.dataset.kid];
        const parts = store.COMPARTMENTS.map(c => {
            const el = $(`[data-comp="${c.id}"]`, field);
            const chips = $$('.chip', el);
            return {
                chips,
                byHand: chips.some(b => b.classList.contains('active') && !b.hasAttribute('data-suggested')),
                // its list in ✎ Box, plus anything typed in as new while this dialog is open
                options: chips.filter(b => b.hasAttribute('data-new') || state.items[c.id].some(n => store.sameName(n, b.dataset.item))).map(b => b.dataset.item),
            };
        });
        let open = parts.filter(p => !p.byHand && p.options.length);
        if (!open.length) open = parts.filter(p => p.options.length);
        const taken = new Set(parts.filter(p => !open.includes(p)).flatMap(p => p.chips.filter(b => b.classList.contains('active')).map(b => b.dataset.item.toLowerCase())));
        // Fewest choices first, so a part with few items isn't left with only what another part took.
        open.sort((a, b) => a.options.length - b.options.length);
        for (const p of open) {
            const previous = p.chips.filter(b => b.classList.contains('active')).map(b => b.dataset.item);
            p.chips.forEach(b => setChip(b, false));
            const pick = suggestItem(kid, date, p.options.filter(n => !taken.has(n.toLowerCase())), previous);
            if (!pick) continue;
            setChip(p.chips.find(b => b.dataset.item === pick), true, true);
            taken.add(pick.toLowerCase());
            filled++;
        }
    }
    if (!filled) toast('Nothing to suggest yet. Add what can go in each part with ✎ Box.');
}

async function saveDay(ev) {
    ev.preventDefault();
    const form = $('#day-form');
    if (!$$('.new-item', form).every(addTyped)) return; // typed but not added with Enter yet
    const lunches = {};
    for (const field of $$('.kid-field', form)) {
        const lunch = { note: $('.kid-note', field).value };
        for (const c of store.COMPARTMENTS) lunch[c.id] = $$(`[data-comp="${c.id}"] .chip.active`, field).map(b => b.dataset.item);
        lunches[state.kids[field.dataset.kid]] = lunch;
    }
    const newItems = Object.fromEntries(store.COMPARTMENTS.map(c => [c.id, $$(`[data-comp="${c.id}"] .chip[data-new]`, form).map(b => b.dataset.item)]));
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

function openBox() {
    $('#box-items').innerHTML = store.COMPARTMENTS.map(c => `<label class="comp ${c.id}">
            <span class="comp-name">${esc(c.name)}</span>
            <textarea rows="5" data-comp="${c.id}" aria-label="What goes in the ${esc(c.name.toLowerCase())}, one per line"></textarea>
        </label>`).join('');
    for (const c of store.COMPARTMENTS) $(`#box-items textarea[data-comp="${c.id}"]`).value = state.items[c.id].join('\n');
    $('#box-dialog').showModal();
}

async function saveBox(ev) {
    ev.preventDefault();
    await store.setItems(Object.fromEntries($$('#box-items textarea').map(t => [t.dataset.comp, t.value.split('\n')])));
    $('#box-dialog').close();
    reload();
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
        setChip(chip, !chip.classList.contains('active'));
    };
    $('#day-suggest').onclick = suggestDay;
    $('#kid-fields').onkeydown = ev => {
        if (ev.key === 'Enter' && ev.target.classList.contains('new-item')) {
            ev.preventDefault(); // Enter adds the item instead of saving the day
            addTyped(ev.target);
        }
    };
    $('#open-box').onclick = openBox;
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
        await store.load();
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
