// Dinner Planner, ported from the old Node app (dinner-planner/public/app.js): Calendar (#calendar), Meals (#meals),
// Ideas (#ideas) and Backup (#backup). Uses the same folder as Bills Etc (the browser remembers it for the whole site);
// the data lives in inputs/dinner-planner/ (js/store.js), and nothing needs a server.
import * as fs from '../../bills-etc/js/fs.js';
import { esc, toast } from '../../bills-etc/js/util.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';
import * as store from './store.js';
import { aiSettings, suggestMeals } from './ai.js';

// 0 = weeks start on Sunday, 1 = Monday.
const WEEK_START = 0;

const TABS = [['calendar', 'Calendar'], ['meals', 'Meals'], ['ideas', 'Ideas'], ['backup', 'Backup']];

const state = {
    meals: [],
    plan: {},
    dismissed: [],
    catalog: [],
    view: 'week',
    cursor: new Date(),
    tagFilter: null,
    shuffleIdeas: false,
    aiIdeas: [],
    ai: { enabled: false, loading: false, settings: null },
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
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const fmt = (d, opts) => d.toLocaleDateString(undefined, opts);

/** Wrap an event handler so a failed save shows what went wrong. */
const guard = fn => async (...args) => {
    try {
        await fn(...args);
    } catch (err) {
        console.error(err);
        toast(err.message, 'bad');
    }
};

/** Hand the viewer a file to save. */
function download(name, type, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function reload() {
    const s = store.data();
    state.meals = s.meals;
    state.plan = s.plan;
    state.dismissed = s.dismissed;
    state.aiIdeas = s.aiIdeas || [];
    renderAll();
}

const mealById = id => state.meals.find(m => m.id === id);

// ---------- history & learning ----------

// Every meal on a past, non-skipped calendar day counts as "we ate this".
function pastDinners() {
    const today = todayKey();
    return Object.entries(state.plan)
        .filter(([date, e]) => date < today && !e.skipped)
        .flatMap(([date, e]) => e.mealIds.map(mealId => ({ date, mealId, daysAgo: daysBetween(date, today) })))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function computeStats() {
    const stats = {};
    for (const m of state.meals) stats[m.id] = { count: 0, dates: [], recency: 0 };
    for (const h of pastDinners()) {
        const s = stats[h.mealId];
        if (!s) continue;
        s.count++;
        s.dates.push(h.date);
        s.recency += Math.pow(0.5, h.daysAgo / 120); // half-life of ~4 months
    }
    const today = todayKey();
    for (const s of Object.values(stats)) {
        s.last = s.dates[s.dates.length - 1] || null;
        s.daysSince = s.last ? daysBetween(s.last, today) : null;
        s.avgGap = s.dates.length > 1 ? daysBetween(s.dates[0], s.last) / (s.dates.length - 1) : null;
    }
    return stats;
}

// How much a meal says about the family's taste.
const mealWeight = (meal, stats) => 1 + (meal.favorite ? 2 : 0) + 1.5 * (stats[meal.id]?.recency || 0);

const STOP = new Set(('salt oil olive water garlic butter onion sugar flour sauce fresh frozen can canned ground chopped '
    + 'diced sliced large small breast thigh fillet whole dried mix seasoning powder paste and for the with cup lb oz '
    + 'red white jumbo cooked serving packet jar bag slice crushed minced shredded boneless skinless').split(' '));

function singular(w) {
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (w.endsWith('oes')) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
    return w;
}

const tokens = text => text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .map(singular).filter(w => w.length > 2 && !STOP.has(w));

function mealTokens(meal) {
    const set = new Set(tokens(meal.name));
    for (const i of meal.ingredients) for (const t of tokens(i.name)) set.add(t);
    return set;
}

function buildProfile(stats) {
    const tok = {};
    const tag = {};
    for (const m of state.meals) {
        if (m.special) continue; // "Free For All" etc. say nothing about taste
        const w = mealWeight(m, stats);
        for (const t of mealTokens(m)) tok[t] = (tok[t] || 0) + w;
        for (const t of m.tags) tag[t] = (tag[t] || 0) + w;
    }
    return { tok, tag };
}

const topEntries = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

function recommendNew(stats) {
    const { tok, tag } = buildProfile(stats);
    const maxTok = Math.max(1, ...Object.values(tok));
    const maxTag = Math.max(1, ...Object.values(tag));
    const owned = new Set(state.meals.map(m => m.name.trim().toLowerCase()));

    return state.catalog
        .filter(c => !owned.has(c.name.toLowerCase()) && !state.dismissed.includes(c.id))
        .map(c => {
            const ct = [...mealTokens(c)];
            const ingScore = ct.reduce((s, t) => s + (tok[t] || 0) / maxTok, 0) / Math.sqrt(ct.length || 1);
            const tagScore = c.tags.reduce((s, t) => s + (tag[t] || 0) / maxTag, 0) / Math.sqrt(c.tags.length || 1);
            let score = 0.6 * ingScore + 0.4 * tagScore;
            if (state.shuffleIdeas) score *= 0.6 + Math.random() * 0.8;
            const matchedTags = c.tags.filter(t => tag[t]).sort((a, b) => tag[b] - tag[a]).slice(0, 2);
            const matchedToks = ct.filter(t => tok[t]).sort((a, b) => tok[b] - tok[a]).slice(0, 3);
            return { item: c, score, matchedTags, matchedToks };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
}

// Your own meals ranked by "it's been a while".
function rankDue(stats, { aroundDate = todayKey(), exclude = new Set() } = {}) {
    // Avoid repeats close together when planning; be looser when logging the past.
    const span = aroundDate < todayKey() ? 1 : 4;
    const near = new Set();
    for (let i = -span; i <= span; i++) {
        const e = state.plan[dateKey(addDays(parseKey(aroundDate), i))];
        if (e && !e.skipped) e.mealIds.forEach(id => near.add(id));
    }
    return state.meals
        .filter(m => !m.special && !near.has(m.id) && !exclude.has(m.id))
        .map(m => {
            const s = stats[m.id];
            const fav = m.favorite ? 1.5 : 1;
            let score;
            if (!s.count) score = 1.2 * fav; // never logged: worth trying
            else {
                const gap = s.avgGap || 14;
                score = (s.daysSince / gap) * fav * (1 + Math.min(s.count, 10) / 10);
            }
            return { meal: m, score, stats: s };
        })
        .sort((a, b) => b.score - a.score);
}

// Weighted random pick from the top few so suggestions vary.
function pickFor(date, stats, exclude) {
    const ranked = rankDue(stats, { aroundDate: date, exclude }).slice(0, 5);
    if (!ranked.length) return null;
    const total = ranked.reduce((s, r) => s + r.score + 0.1, 0);
    let x = Math.random() * total;
    for (const r of ranked) if ((x -= r.score + 0.1) <= 0) return r.meal;
    return ranked[0].meal;
}

function describeStats(s) {
    if (!s || !s.count) return 'Not in your history yet';
    const last = s.daysSince === 1 ? 'yesterday' : `${s.daysSince} days ago`;
    const every = s.avgGap ? ` · usually every ~${Math.round(s.avgGap)} days` : '';
    return `Had ${s.count}× · last ${last}${every}`;
}

// ---------- calendar ----------

function renderCalendar() {
    const cal = $('#calendar');
    const today = todayKey();
    $$('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    $$('.week-only').forEach(el => (el.hidden = state.view !== 'week'));

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
        const e = state.plan[key];
        const meals = (e?.mealIds || []).map(mealById).filter(Boolean);
        const classes = ['day'];
        if (key === today) classes.push('today');
        if (key < today) classes.push('past');
        if (state.view === 'month' && d.getMonth() !== state.cursor.getMonth()) classes.push('other-month');

        const label = state.view === 'week' ? `${fmt(d, { weekday: 'short' })} ${d.getDate()}` : d.getDate();
        const badge = key === today ? '<span class="badge">Today</span>' : '';

        let body;
        if (meals.length) {
            body = meals.map(meal => `<span class="meal-name ${meal.special ? 'special' : ''} ${e.skipped ? 'skipped' : ''}">${meal.favorite ? '★ ' : ''}${esc(meal.name)}</span>`
                + (meal.prepMinutes && state.view === 'week' ? `<span class="meta">⏱ ${meal.prepMinutes} min</span>` : '')).join('');
            if (e.note) body += `<span class="meal-note">${esc(e.note)}</span>`;
        } else if (e?.note) {
            body = `<span class="meal-note ${e.skipped ? 'skipped' : ''}">${esc(e.note)}</span>`;
        } else {
            body = state.view === 'week' ? `<span class="empty">${key < today ? 'Nothing logged' : '+ Plan dinner'}</span>` : '';
        }
        // Quick actions for upcoming planned days, so you can reject a suggestion in one click (↻ only with one meal).
        const quick = state.view === 'week' && key >= today && e
            ? `<span class="day-actions">${meals.length === 1 ? '<button type="button" class="day-act" data-day-act="swap" title="Swap for another suggestion" aria-label="Swap meal">↻</button>' : ''}<button type="button" class="day-act" data-day-act="clear" title="Clear this day" aria-label="Clear day">✕</button></span>`
            : '';
        return `<div role="button" tabindex="0" class="${classes.join(' ')}" data-date="${key}"><span class="date"><span>${label}</span>${badge}</span>${body}${quick}</div>`;
    }).join('');
}

function shiftCursor(dir) {
    const c = state.cursor;
    state.cursor = state.view === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
    renderCalendar();
}

async function fillWeek() {
    const stats = computeStats();
    const today = todayKey();
    const start = startOfWeek(state.cursor);
    const used = new Set();
    let count = 0;
    try {
        for (let i = 0; i < 7; i++) {
            const key = dateKey(addDays(start, i));
            if (key < today || state.plan[key]) continue;
            const meal = pickFor(key, stats, used);
            if (!meal) break;
            used.add(meal.id);
            await store.setDay(key, { mealIds: [meal.id] }); // later picks see it
            count++;
        }
    } finally {
        reload();
    }
    toast(count ? `Planned ${count} day${count > 1 ? 's' : ''}` : 'No empty upcoming days this week');
}

const dayMealNames = e => (e?.mealIds || []).map(id => mealById(id)?.name).filter(Boolean).join(' + ');

async function quickClearDay(date) {
    const name = dayMealNames(state.plan[date]) || state.plan[date]?.note;
    await store.clearDay(date);
    reload();
    toast(`Cleared ${name || 'day'}`);
}

async function swapDay(date) {
    const e = state.plan[date];
    const meal = pickFor(date, computeStats(), new Set(e?.mealIds));
    if (!meal) return toast('No other meals to suggest. Add more meals first.');
    await store.setDay(date, { mealIds: [meal.id], note: e?.note, skipped: e?.skipped });
    reload();
    toast(`Swapped to ${meal.name}`);
}

function openShoppingList() {
    const start = startOfWeek(state.cursor);
    const items = new Map();
    for (let i = 0; i < 7; i++) {
        const e = state.plan[dateKey(addDays(start, i))];
        if (!e || e.skipped) continue;
        for (const meal of e.mealIds.map(mealById).filter(Boolean)) {
            for (const ing of meal.ingredients) {
                const k = ing.name.toLowerCase();
                if (!items.has(k)) items.set(k, { name: ing.name, qty: [], from: new Set() });
                const it = items.get(k);
                if (ing.quantity) it.qty.push(ing.quantity);
                it.from.add(meal.name);
            }
        }
    }
    const list = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
    $('#shop-title').textContent = `Shopping list · ${$('#cal-title').textContent}`;
    $('#shop-list').innerHTML = list.length
        ? list.map(it => `<li><label><input type="checkbox"><span>${esc(it.name)}${it.qty.length ? ` — ${esc(it.qty.join(' + '))}` : ''}<br><span class="from">${esc([...it.from].join(', '))}</span></span></label></li>`).join('')
        : '<li class="hint">No meals planned this week yet.</li>';
    $('#shop-copy').onclick = async () => {
        const text = list.map(it => `- ${it.name}${it.qty.length ? ` (${it.qty.join(' + ')})` : ''}`).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            toast('Copied to clipboard');
        } catch {
            toast('Could not copy', 'bad');
        }
    };
    $('#shop-dialog').showModal();
}

// ---------- day dialog ----------

let activeMealRow = null; // the day dialog's meal that a suggestion chip fills in

function mealOptions() {
    const sorted = [...state.meals].sort((a, b) => a.name.localeCompare(b.name));
    const opt = m => `<option value="${m.id}">${m.favorite ? '★ ' : ''}${esc(m.name)}</option>`;
    const specials = sorted.filter(m => m.special);
    return '<option value="">— No meal —</option>'
        + (specials.length ? `<optgroup label="Special">${specials.map(opt).join('')}</optgroup><optgroup label="Meals">` : '')
        + sorted.filter(m => !m.special).map(opt).join('')
        + (specials.length ? '</optgroup>' : '');
}

function setActiveMealRow(row) {
    activeMealRow = row;
    $$('.day-meal-row').forEach(r => r.classList.toggle('active', r === row));
}

/** One of the day's meals (e.g. one for the adults, one for the kids). */
function addDayMealRow(mealId = '') {
    const row = document.createElement('div');
    row.className = 'ing-row day-meal-row';
    row.innerHTML = `<select aria-label="Meal">${mealOptions()}</select><button type="button" class="btn small" aria-label="Remove meal" title="Remove this meal">✕</button>`;
    const select = row.querySelector('select');
    select.value = mealId;
    select.onfocus = () => setActiveMealRow(row);
    select.onchange = () => { setActiveMealRow(row); updateDayDialog(); };
    row.querySelector('button').onclick = () => {
        if ($$('.day-meal-row').length === 1) select.value = ''; // keep one to choose from
        else {
            row.remove();
            if (activeMealRow === row) setActiveMealRow($$('.day-meal-row').at(-1));
        }
        updateDayDialog();
    };
    $('#day-meal-rows').append(row);
    setActiveMealRow(row);
    return row;
}

const dayMealIds = () => [...new Set($$('.day-meal-row select').map(s => s.value).filter(Boolean))];

function openDay(date, presetMealId) {
    const e = state.plan[date] || {};
    const form = $('#day-form');
    $('#day-meal-rows').innerHTML = '';
    const ids = presetMealId ? [presetMealId] : e.mealIds || [];
    (ids.length ? ids : ['']).forEach(id => addDayMealRow(id));
    form.note.value = e.note || '';
    form.skipped.checked = !!e.skipped;
    form.dataset.date = date;
    updateDayDialog();
    $('#day-dialog').showModal();
}

function updateDayDialog() {
    const form = $('#day-form');
    const date = form.dataset.date;
    const isPast = date < todayKey();
    $('#day-dialog-title').textContent = fmt(parseKey(date), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $$('.past-only', form).forEach(el => (el.hidden = !isPast));

    const stats = computeStats();
    const sugg = rankDue(stats, { aroundDate: date, exclude: new Set(dayMealIds()) }).slice(0, 5);
    const specials = state.meals.filter(m => m.special).sort((a, b) => a.name.localeCompare(b.name));
    $('#day-suggestions').innerHTML =
        (sugg.length ? '<span class="hint">Suggestions:</span>' + sugg.map(r => `<button type="button" class="chip" data-meal="${r.meal.id}" title="${esc(describeStats(r.stats))}">${esc(r.meal.name)}</button>`).join('') : '')
        + (specials.length ? '<span class="chip-break"></span><span class="hint">Special:</span>' + specials.map(m => `<button type="button" class="chip special" data-meal="${m.id}">${esc(m.name)}</button>`).join('') : '');
}

async function saveDay(ev) {
    ev.preventDefault();
    const form = $('#day-form');
    const date = form.dataset.date;
    await store.setDay(date, { mealIds: dayMealIds(), note: form.note.value, skipped: form.skipped.checked && date < todayKey() });
    $('#day-dialog').close();
    reload();
}

async function clearDay() {
    await store.clearDay($('#day-form').dataset.date);
    $('#day-dialog').close();
    reload();
}

function nextFreeDay() {
    let d = new Date();
    for (let i = 0; i < 60; i++, d = addDays(d, 1)) if (!state.plan[dateKey(d)]) return dateKey(d);
    return todayKey();
}

// ---------- meals ----------

function renderTagFilter() {
    const tags = [...new Set(state.meals.flatMap(m => m.tags))].sort();
    if (state.tagFilter && !tags.includes(state.tagFilter)) state.tagFilter = null;
    $('#tag-filter').innerHTML = tags.map(t => `<button class="chip ${t === state.tagFilter ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
}

function renderMeals() {
    renderTagFilter();
    const stats = computeStats();
    const q = $('#meal-search').value.trim().toLowerCase();
    const sort = $('#meal-sort').value;
    const meals = state.meals.filter(m => {
        if (state.tagFilter && !m.tags.includes(state.tagFilter)) return false;
        if (!q) return true;
        return m.name.toLowerCase().includes(q) || m.tags.some(t => t.includes(q))
            || m.ingredients.some(i => i.name.toLowerCase().includes(q));
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    const sorters = {
        name: byName,
        most: (a, b) => stats[b.id].count - stats[a.id].count || byName(a, b),
        recent: (a, b) => (stats[b.id].last || '').localeCompare(stats[a.id].last || '') || byName(a, b),
        longest: (a, b) => (stats[a.id].last || '').localeCompare(stats[b.id].last || '') || byName(a, b),
    };
    meals.sort(sorters[sort]);

    $('#meal-list').innerHTML = meals.length ? meals.map(m => `
        <article class="card">
            <h3><span>${esc(m.name)}</span><button class="link fav ${m.favorite ? 'on' : ''}" data-act="fav" data-id="${m.id}" title="Toggle favorite">${m.favorite ? '★' : '☆'}</button></h3>
            ${m.tags.length ? `<div class="tag-list">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
            ${m.special ? '<div><span class="badge">Special: never auto-suggested</span></div>' : ''}
            ${m.special && !m.ingredients.length && !m.prepMinutes ? '' : `<div class="stats">${m.prepMinutes ? `⏱ ${m.prepMinutes} min · ` : ''}${m.ingredients.length} ingredient${m.ingredients.length === 1 ? '' : 's'}</div>`}
            <div class="stats">${esc(describeStats(stats[m.id]))}</div>
            ${m.ingredients.length ? `<details><summary>Ingredients</summary><ul>${m.ingredients.map(i => `<li>${esc(i.name)}${i.quantity ? ` — ${esc(i.quantity)}` : ''}</li>`).join('')}</ul></details>` : ''}
            ${m.notes ? `<details><summary>Notes</summary><p>${esc(m.notes).replace(/\n/g, '<br>')}</p></details>` : ''}
            <div class="actions">
                <button class="btn small" data-act="edit" data-id="${m.id}">Edit</button>
                <button class="btn small" data-act="plan" data-id="${m.id}">Plan…</button>
                <button class="btn small" data-act="ate" data-id="${m.id}">Had it today</button>
                <button class="btn small danger" data-act="delete" data-id="${m.id}">Delete</button>
            </div>
        </article>`).join('')
        : `<div class="empty-state">${state.meals.length ? 'No meals match.' : 'No meals yet. Add the dinners your family eats regularly.'}</div>`;
}

function addIngredientRow(ing = { name: '', quantity: '' }) {
    const row = document.createElement('div');
    row.className = 'ing-row';
    row.innerHTML = `<input placeholder="Ingredient" value="${esc(ing.name)}"><input placeholder="Amount" value="${esc(ing.quantity)}"><button type="button" class="btn small" aria-label="Remove">✕</button>`;
    row.querySelector('button').onclick = () => row.remove();
    $('#ingredient-rows').append(row);
    return row;
}

function openMealEditor(meal) {
    const form = $('#meal-form');
    form.reset();
    form.dataset.id = meal?.id || '';
    $('#meal-dialog-title').textContent = meal ? 'Edit meal' : 'Add meal';
    form.name.value = meal?.name || '';
    form.tags.value = meal?.tags.join(', ') || '';
    form.prepMinutes.value = meal?.prepMinutes || '';
    form.favorite.checked = !!meal?.favorite;
    form.special.checked = !!meal?.special;
    form.notes.value = meal?.notes || '';
    $('#ingredient-rows').innerHTML = '';
    (meal?.ingredients.length ? meal.ingredients : [{ name: '', quantity: '' }]).forEach(i => addIngredientRow(i));
    $('#meal-dialog').showModal();
    form.name.focus();
}

async function saveMeal(ev) {
    ev.preventDefault();
    const form = $('#meal-form');
    const body = {
        name: form.name.value,
        tags: form.tags.value.split(',').map(t => t.trim()).filter(Boolean),
        prepMinutes: form.prepMinutes.value,
        favorite: form.favorite.checked,
        special: form.special.checked,
        notes: form.notes.value,
        ingredients: $$('.ing-row').map(r => {
            const [n, q] = $$('input', r);
            return { name: n.value, quantity: q.value };
        }),
    };
    const id = form.dataset.id;
    const existing = id && mealById(id);
    if (existing) body.source = existing.source;
    if (id) await store.updateMeal(id, body);
    else await store.addMeal(body);
    $('#meal-dialog').close();
    toast(id ? 'Meal updated' : 'Meal added');
    reload();
}

async function mealAction(act, id) {
    const meal = mealById(id);
    if (!meal) return;
    if (act === 'edit') return openMealEditor(meal);
    if (act === 'plan') return openDay(nextFreeDay(), id);
    if (act === 'fav') {
        await store.updateMeal(id, { ...meal, favorite: !meal.favorite });
        return reload();
    }
    if (act === 'ate') {
        const today = todayKey();
        const cur = state.plan[today];
        const ids = cur?.mealIds || [];
        if (ids.includes(id)) return toast(`${meal.name} is already on today`);
        if (ids.length && !confirm(`Today already has ${dayMealNames(cur)}. Add "${meal.name}" to today too?`)) return;
        await store.setDay(today, { mealIds: [...ids, id], note: cur?.note });
        toast(`Logged ${meal.name} for today`);
        return reload();
    }
    if (act === 'delete') {
        if (!confirm(`Delete "${meal.name}"? Calendar days that used it will keep its name as a note.`)) return;
        await store.deleteMeal(id);
        toast('Meal deleted');
        return reload();
    }
}

// ---------- ideas ----------

function renderIdeas() {
    const stats = computeStats();
    const { tok, tag } = buildProfile(stats);
    const hist = pastDinners();
    const chips = entries => entries.map(([k]) => `<span class="chip static">${esc(k)}</span>`).join('') || '<span class="hint">—</span>';
    $('#profile').innerHTML = `
        <div class="profile-row"><strong>Top styles</strong>${chips(topEntries(tag, 8))}</div>
        <div class="profile-row"><strong>Top ingredients</strong>${chips(topEntries(tok, 10))}</div>
        <p class="hint">${hist.length} dinner${hist.length === 1 ? '' : 's'} in your history${hist.length < 10 ? '. Log more past dinners on the calendar to sharpen these suggestions.' : '.'}</p>`;

    const due = rankDue(stats).slice(0, 6);
    $('#due-list').innerHTML = due.length ? due.map(r => `
        <article class="card">
            <h3><span>${r.meal.favorite ? '<span class="fav on">★</span> ' : ''}${esc(r.meal.name)}</span></h3>
            <div class="stats">${esc(describeStats(r.stats))}</div>
            <div class="actions"><button class="btn small primary" data-act="plan" data-id="${r.meal.id}">Plan it</button></div>
        </article>`).join('')
        : '<div class="empty-state">Add some meals first.</div>';

    const ideas = recommendNew(stats);
    $('#idea-list').innerHTML = ideas.length ? ideas.map(({ item, matchedTags, matchedToks }) => {
        const why = [...matchedTags, ...matchedToks.filter(t => !matchedTags.includes(t))].slice(0, 4);
        return `
        <article class="card">
            <h3><span>${esc(item.name)}</span>${item.prepMinutes ? `<span class="badge good">${item.prepMinutes >= 120 ? Math.round(item.prepMinutes / 60) + ' hr' : item.prepMinutes + ' min'}</span>` : ''}</h3>
            <div class="tag-list">${item.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
            ${why.length ? `<div class="why">Because you like: ${why.map(esc).join(', ')}</div>` : ''}
            <details><summary>Ingredients</summary><ul>${item.ingredients.map(i => `<li>${esc(i.name)} — ${esc(i.quantity)}</li>`).join('')}</ul></details>
            <div class="actions">
                <button class="btn small primary" data-idea="add" data-id="${item.id}">Add to my meals</button>
                <button class="btn small" data-idea="dismiss" data-id="${item.id}">Not for us</button>
            </div>
        </article>`;
    }).join('') + '<div class="empty-state"><button class="btn" id="shuffle-ideas">↻ Show different ideas</button></div>'
        : '<div class="empty-state">You\'ve seen every idea in the catalog. Use "Show hidden ideas again" to bring them back.</div>';
}

async function ideaAction(act, id) {
    const item = state.catalog.find(c => c.id === id);
    if (!item) return;
    if (act === 'add') {
        await store.addMeal({ ...item, source: 'Suggested' });
        toast(`Added "${item.name}" to your meals`);
    } else {
        await store.dismissIdea(id);
    }
    reload();
}

// ---------- AI ideas ----------

function renderAi() {
    const { enabled, loading } = state.ai;
    $('#ai-section').hidden = !enabled;
    $('#ai-request').disabled = !enabled || loading;
    $('#ai-go').disabled = !enabled || loading;
    $('#ai-go').innerHTML = loading ? '<span class="spinner"></span>Thinking…' : 'Get AI ideas';
    $('#ai-clear').hidden = !state.aiIdeas.length || loading;

    $('#ai-list').innerHTML = state.aiIdeas.length ? state.aiIdeas.map(m => `
        <article class="card ai">
            <h3><span>${esc(m.name)}</span>${m.prepMinutes ? `<span class="badge good">${m.prepMinutes} min</span>` : ''}</h3>
            ${m.tags.length ? `<div class="tag-list">${m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
            ${m.why ? `<div class="why">${esc(m.why)}</div>` : ''}
            <details><summary>Ingredients</summary><ul>${m.ingredients.map(i => `<li>${esc(i.name)}${i.quantity ? ` — ${esc(i.quantity)}` : ''}</li>`).join('')}</ul></details>
            ${m.notes ? `<details><summary>How to make it</summary><p>${esc(m.notes).replace(/\n/g, '<br>')}</p></details>` : ''}
            <div class="actions">
                <button class="btn small primary" data-ai="add" data-id="${m.id}">Add to my meals</button>
                <button class="btn small" data-ai="reject" data-id="${m.id}">Not for us</button>
            </div>
        </article>`).join('')
        : enabled && !loading ? '<div class="empty-state">Click "Get AI ideas" to get started. It usually takes 20–60 seconds.</div>' : '';
}

async function requestAiIdeas(ev) {
    ev.preventDefault();
    state.ai.loading = true;
    renderAi();
    try {
        await store.addAiIdeas(await suggestMeals(store.data(), $('#ai-request').value, state.ai.settings));
        state.aiIdeas = store.data().aiIdeas;
        toast('New AI ideas are ready', 'ok');
    } finally {
        state.ai.loading = false;
        renderAi();
    }
}

async function aiAction(act, id) {
    const idea = state.aiIdeas.find(i => i.id === id);
    if (!idea) return;
    if (act === 'add') {
        await store.addMeal(idea);
        await store.removeAiIdeas(id);
        toast(`Added "${idea.name}" to your meals`);
    } else {
        await store.removeAiIdeas(id, true);
    }
    reload();
}

// ---------- backups ----------

const BACKUP_KINDS = { daily: 'Start of day', manual: 'Backed up by hand', 'before-restore': 'Saved before a restore' };

function describeBackup(b) {
    const kind = Object.keys(BACKUP_KINDS).find(k => b.name.startsWith(k + '-'));
    const when = kind === 'daily'
        ? fmt(parseKey(b.name.slice(6, 16)), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        : new Date(b.modified).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { when, kind: BACKUP_KINDS[kind] || '' };
}

async function renderBackup() {
    const files = await store.listBackups();
    $('#data-dir').textContent = store.DIR + '/';
    $('#backup-dir').textContent = store.BACKUP_DIR + '/';
    $('#backup-list').innerHTML = files.length ? files.map(b => {
        const { when, kind } = describeBackup(b);
        return `<div class="backup-row">
            <div class="name"><div class="when">${esc(when)}</div><div class="kind">${esc(kind)} · ${Math.max(1, Math.round(b.size / 1024))} KB</div></div>
            <button class="btn small" data-backup-download="${esc(b.name)}">Download</button>
            <button class="btn small" data-restore="${esc(b.name)}" data-when="${esc(when)}">Restore</button>
        </div>`;
    }).join('')
        : '<div class="empty-state">No backups yet. One is made automatically the next time you change something, or click "Back up now".</div>';
}

async function restore(body, label) {
    if (!confirm(`Replace all current meals and calendar days with the backup from ${label}?\n\nYour current data will be saved as a backup first, so this can be undone.`)) return;
    const r = await store.restore(body);
    reload();
    await renderBackup();
    toast(`Restored ${r.meals} meals and ${r.days} days`, 'ok');
}

async function restoreFromFile(ev) {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        return toast("That file isn't a valid backup.", 'bad');
    }
    await restore({ data }, `"${file.name}"`);
}

function downloadExport(what) {
    if (what === 'backup.json') download(`dinner-planner-backup-${todayKey()}.json`, 'application/json', JSON.stringify(store.data(), null, 2));
    else download(what, 'text/csv;charset=utf-8', what === 'meals.csv' ? store.mealsCsv() : store.historyCsv());
}

// ---------- wiring ----------

function renderAll() {
    renderCalendar();
    renderMeals();
    renderIdeas();
    renderAi();
}

function showTab() {
    const want = location.hash.slice(1);
    const name = TABS.some(([id]) => id === want) ? want : 'calendar';
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    $$('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + name));
    $$('.tab-panel').forEach(p => (p.hidden = p.id !== `tab-${name}`));
    if (name === 'backup') renderBackup().catch(err => toast(`Couldn't list backups: ${err.message}`, 'bad'));
}

function wire() {
    $('#cal-prev').onclick = () => shiftCursor(-1);
    $('#cal-next').onclick = () => shiftCursor(1);
    $('#cal-today').onclick = () => { state.cursor = new Date(); renderCalendar(); };
    $$('.view-btn').forEach(b => (b.onclick = () => {
        state.view = b.dataset.view;
        try { localStorage.setItem('dinner-view', state.view); } catch { /* storage blocked */ }
        renderCalendar();
    }));
    $('#calendar').onclick = guard(async ev => {
        const day = ev.target.closest('.day');
        if (!day) return;
        const act = ev.target.closest('[data-day-act]');
        if (act) return act.dataset.dayAct === 'swap' ? swapDay(day.dataset.date) : quickClearDay(day.dataset.date);
        openDay(day.dataset.date);
    });
    $('#calendar').onkeydown = ev => {
        if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('day')) {
            ev.preventDefault();
            openDay(ev.target.dataset.date);
        }
    };
    $('#fill-week').onclick = guard(fillWeek);
    $('#shopping-list').onclick = openShoppingList;

    $('#day-form').onsubmit = guard(saveDay);
    $('#day-clear').onclick = guard(clearDay);
    $('#day-suggestions').onclick = ev => {
        const chip = ev.target.closest('[data-meal]');
        if (!chip) return;
        const row = activeMealRow?.isConnected ? activeMealRow : $$('.day-meal-row').at(-1);
        row.querySelector('select').value = chip.dataset.meal;
        updateDayDialog();
    };
    $('#add-day-meal').onclick = () => addDayMealRow().querySelector('select').focus();

    $('#add-meal').onclick = () => openMealEditor(null);
    $('#add-ingredient').onclick = () => addIngredientRow().querySelector('input').focus();
    $('#meal-form').onsubmit = guard(saveMeal);
    $('#meal-search').oninput = renderMeals;
    $('#meal-sort').onchange = renderMeals;
    $('#tag-filter').onclick = ev => {
        const chip = ev.target.closest('[data-tag]');
        if (!chip) return;
        state.tagFilter = state.tagFilter === chip.dataset.tag ? null : chip.dataset.tag;
        renderMeals();
    };

    // Delegated clicks for meal cards (Meals tab and "Due for a repeat"), ideas, backups and dialog Cancel buttons.
    $('#app').addEventListener('click', guard(async ev => {
        const btn = ev.target.closest('[data-act]');
        if (btn) return mealAction(btn.dataset.act, btn.dataset.id);
        const idea = ev.target.closest('[data-idea]');
        if (idea) return ideaAction(idea.dataset.idea, idea.dataset.id);
        const ai = ev.target.closest('[data-ai]');
        if (ai) return aiAction(ai.dataset.ai, ai.dataset.id);
        const exp = ev.target.closest('[data-download]');
        if (exp) return downloadExport(exp.dataset.download);
        const bk = ev.target.closest('[data-backup-download]');
        if (bk) return download(bk.dataset.backupDownload, 'application/json', await store.readBackup(bk.dataset.backupDownload) ?? '');
        if (ev.target.closest('#shuffle-ideas')) {
            state.shuffleIdeas = true;
            renderIdeas();
        }
        if (ev.target.closest('[data-close]')) ev.target.closest('dialog').close();
    }));
    $('#reset-dismissed').onclick = guard(async () => {
        await store.resetDismissed();
        reload();
        toast('Hidden ideas restored');
    });
    $('#backup-now').onclick = guard(async () => {
        await store.backUpNow();
        await renderBackup();
        toast('Backup saved', 'ok');
    });
    $('#restore-file').onchange = guard(restoreFromFile);
    $('#backup-list').onclick = guard(async ev => {
        const btn = ev.target.closest('[data-restore]');
        if (btn) await restore({ name: btn.dataset.restore }, btn.dataset.when);
    });
    $('#ai-form').onsubmit = guard(requestAiIdeas);
    $('#ai-clear').onclick = guard(async () => {
        await store.removeAiIdeas();
        reload();
    });
    window.addEventListener('hashchange', showTab);
}

async function start() {
    const viewEl = $('#view');
    if (!fs.folder()) {
        $('#app').hidden = true;
        $('#nav').innerHTML = '';
        return askForFolder(viewEl, { what: 'Dinner plans', where: `${store.DIR}/`, onConnected: start });
    }
    viewEl.innerHTML = '<p class="muted">Loading…</p>';
    try {
        [state.catalog, state.ai.settings] = await Promise.all([
            fetch('catalog.json', { cache: 'no-cache' }).then(r => r.json()).then(c => c.meals),
            aiSettings(),
            store.load(),
        ]);
    } catch (e) {
        console.error(e);
        viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
        return;
    }
    state.ai.enabled = !!state.ai.settings.key;
    try { state.view = localStorage.getItem('dinner-view') || 'week'; } catch { /* storage blocked */ }
    viewEl.innerHTML = '';
    $('#nav').innerHTML = TABS.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('');
    $('#app').hidden = false;
    wire();
    reload();
    showTab();
}

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    start();
})();

