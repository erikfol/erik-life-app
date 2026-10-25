// Kid Lunches: a week/month calendar like the Dinner Planner's, with a lunch for each kid on every day. Uses the same
// folder as Bills Etc (the browser remembers it for the whole site); the data lives in inputs/kid-lunches/ (js/store.js).
import * as fs from '../../bills-etc/js/fs.js';
import { esc, toast } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import * as store from './store.js';

// 0 = weeks start on Sunday, 1 = Monday (same as the Dinner Planner).
const WEEK_START = 0;
const RECENT = 6; // past lunches offered as chips under each kid in the day dialog

const state = {
    kids: [],
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
const todayKey = () => dateKey(new Date());
const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);
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
    ({ kids: state.kids, days: state.days } = store.data());
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
        const start = startOfWeek(state.cursor);
        days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
        const end = days[6];
        const sameMonth = start.getMonth() === end.getMonth();
        $('#cal-title').textContent = `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${end.getFullYear()}`;
        cal.className = 'cal-week';
    } else {
        const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
        const start = startOfWeek(first);
        days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
        $('#cal-title').textContent = fmt(first, { month: 'long', year: 'numeric' });
        cal.className = 'cal-month';
    }

    const dowHeader = state.view === 'month'
        ? days.slice(0, 7).map(d => `<div class="cal-dow">${fmt(d, { weekday: 'short' })}</div>`).join('')
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

        // Week: a box for every kid, filled or not. Month: only the kids with a lunch, to fit.
        const body = state.kids.map((kid, i) => {
            if (e[kid]) return `<span class="kid-lunch ${kidClass(i)}"><span class="kid">${esc(kid)}</span><span class="lunch">${esc(e[kid])}</span></span>`;
            return state.view === 'week'
                ? `<span class="kid-lunch ${kidClass(i)}"><span class="kid">${esc(kid)}</span><span class="empty">${key < today ? '—' : '+ Add lunch'}</span></span>`
                : '';
        }).join('');
        return `<div role="button" tabindex="0" class="${classes.join(' ')}" data-date="${key}"><span class="date"><span>${label}</span>${badge}</span>${body}</div>`;
    }).join('');
}

function shiftCursor(dir) {
    const c = state.cursor;
    state.cursor = state.view === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    renderCalendar();
}

// ---------- day dialog ----------

/** A kid's most recent different lunches, newest first, leaving out the day being edited. */
function recentLunches(kid, exceptDate) {
    const seen = new Set();
    const out = [];
    for (const date of Object.keys(state.days).sort().reverse()) {
        const lunch = state.days[date][kid];
        if (date === exceptDate || !lunch || seen.has(lunch.toLowerCase())) continue;
        seen.add(lunch.toLowerCase());
        out.push(lunch);
        if (out.length === RECENT) break;
    }
    return out;
}

function openDay(date) {
    if (!state.kids.length) return openKids();
    const e = state.days[date] || {};
    const form = $('#day-form');
    form.dataset.date = date;
    $('#day-dialog-title').textContent = fmt(parseKey(date), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('#kid-fields').innerHTML = state.kids.map((kid, i) => {
        const recent = recentLunches(kid, date);
        return `<fieldset class="kid-field ${kidClass(i)}">
            <legend>${esc(kid)}</legend>
            <textarea rows="2" maxlength="300" data-kid="${i}" aria-label="${esc(kid)}'s lunch" placeholder="e.g. Turkey sandwich, apple, pretzels"></textarea>
            ${recent.length ? `<div class="chips"><span class="hint">Recent:</span>${recent.map(l => `<button type="button" class="chip" data-fill="${i}">${esc(l)}</button>`).join('')}</div>` : ''}
        </fieldset>`;
    }).join('');
    state.kids.forEach((kid, i) => { $(`textarea[data-kid="${i}"]`, form).value = e[kid] || ''; });
    $('#day-dialog').showModal();
}

async function saveDay(ev) {
    ev.preventDefault();
    const form = $('#day-form');
    const lunches = Object.fromEntries($$('textarea[data-kid]', form).map(t => [state.kids[t.dataset.kid], t.value]));
    await store.setDay(form.dataset.date, lunches);
    $('#day-dialog').close();
    reload();
}

async function clearDay() {
    await store.setDay($('#day-form').dataset.date, {});
    $('#day-dialog').close();
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
        const chip = ev.target.closest('[data-fill]');
        if (chip) $(`textarea[data-kid="${chip.dataset.fill}"]`).value = chip.textContent;
    };
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
