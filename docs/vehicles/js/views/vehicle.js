// One vehicle's page, in three tabs: Overview (information, current mileage, the maintenance schedule and current tires for cars,
// service places, photos, maintenance table), Guides (long how-to notes with reference images) and Notes (a dated log).
// Also the "Add vehicle" page.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { renderGallery, releaseGalleries } from './gallery.js';
import { renderPlaces, placesUnsaved, forgetPlaces } from './places.js';
import { renderGuides, guidesUnsaved, forgetGuides } from './guides.js';
import { renderNotes, notesUnsaved, forgetNotes } from './notes.js';
import {
    TYPES, VEHICLES_PATH, saveVehicles, photosDir, newVehicle, maintenancePath, maintenanceColumns, loadMaintenance, saveMaintenance,
    hasMileageLog, mileagePath, MILEAGE_COLUMNS, loadMileage, saveMileage, latestMileage, mileageRate, mileageRateColumns,
    hasSchedule, schedulePath, scheduleColumns, loadSchedule, saveSchedule, currentReading, scheduleStatus, dueText, nextDueText,
    lastText, soonOf, SOON_DAYS, invoicesDir, hasTires, currentTires, treadPath, TREAD_COLUMNS, loadTread, saveTread,
    lowestTread, treadLevel, treadMiles, latestTread, TREAD_LOW, TREAD_WORN,
} from '../vehicles.js';

let table = null;
let mileage = null; // the mileage log (cars)
let schedule = null; // the maintenance schedule (cars)
let tread = null; // the tread depth log (cars)
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!mileage?.hasUnsavedEdits() || !!schedule?.hasUnsavedEdits()
    || !!tread?.hasUnsavedEdits() || !!info?.hasUnsavedEdits() || placesUnsaved() || guidesUnsaved() || notesUnsaved();
export const forget = () => {
    table = null; mileage = null; schedule = null; tread = null; info = null;
    closeFilterMenu(); releaseGalleries(); forgetPlaces(); forgetGuides(); forgetNotes();
};

const STATUS = { red: 'Overdue', yellow: 'Due soon', ok: 'OK' };
const STATUS_CLASS = { Overdue: 'due-red', 'Due soon': 'due-yellow', OK: 'due-ok' };

/**
 * The maintenance schedule: a banner of what's overdue (red) and due soon (yellow), the schedule table (editable; its
 * Status, Next due and Last done are worked out from get() = { log, readings }, the maintenance and mileage logs as
 * last saved) and how it's worked out. Returns redraw(), for after either log is saved.
 */
function renderSchedule(el, v, rows, get) {
    let saved = rows;
    const draw = () => {
        const { log, readings } = get();
        const now = currentReading(v, log, readings);
        const status = r => scheduleStatus(v, r, log, now);
        const states = saved.map(r => ({ r, s: status(r) }));
        const red = states.filter(x => x.s.level === 'red'), yellow = states.filter(x => x.s.level === 'yellow');
        const item = x => `<span class="nowrap"><strong>${esc(x.r.Item)}</strong> <span class="muted">(due ${esc(dueText(x.s))})</span></span>`;
        el.querySelector('.sched-banner').innerHTML = (red.length ? `<div class="banner bad"><strong>Overdue:</strong> ${red.map(item).join(' · ')}</div>` : '')
            + (yellow.length ? `<div class="banner"><strong>Due soon:</strong> ${yellow.map(item).join(' · ')}</div>` : '')
            + (saved.length && !red.length && !yellow.length ? '<div class="banner ok">✓ <strong>Nothing due.</strong> Everything on the schedule is up to date.</div>' : '');
        const meter = (v.meter || 'Mileage').toLowerCase(), unit = meter === 'engine hours' ? 'hours' : 'miles';
        el.querySelector('.sched-note').innerHTML = `Worked out from ${now ? `the latest ${esc(meter)}, <strong>${now.miles.toLocaleString('en-US')} ${unit}</strong>
            (${esc(now.date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}),` : `the ${esc(meter)} (none logged yet, so only the dates count)`}
            and the Maintenance log below. An item counts from the newest entry whose Action is its name (or one of its Also counts
            names, comma-separated); never logged, it counts from the purchase (by First, where that's filled in). With Due by (month)
            it's due by the 1st of that month once a year. Due soon: within ${soonOf(v).toLocaleString('en-US')} ${unit} or ${SOON_DAYS} days.
            Log work with the item's name as the Action and it turns green.`;
        if (schedule?.hasUnsavedEdits()) return; // don't throw away edits in progress
        const cols = scheduleColumns(v, [...new Set(log.map(r => String(r.Action || '').trim()).filter(Boolean))]);
        schedule = recordTable(el.querySelector('.sched'), {
            columns: [cols[0], cols[1],
                { name: 'Status', kind: 'text', calc: r => STATUS[status(r).level] || '—', badge: x => STATUS_CLASS[x] || '' },
                { name: 'Next due', kind: 'text', calc: r => {
                    const s = status(r);
                    return s.level ? nextDueText(v, readings, now, s) : 'Fill in Every (or the last entry’s mileage)';
                } },
                { name: 'Last done', kind: 'text', calc: r => lastText(v, status(r), r) || 'Not logged' },
                cols.at(-1), ...cols.slice(2, -1)], // Notes next, so it's in view; then how often
            rows: saved,
            compact: true, // long notes: scroll inside a box, with each note cut to a few lines
            save: async next => { await saveSchedule(v, next); saved = next; schedule = null; draw(); },
        });
    };
    draw();
    return draw;
}

/** A Date as '2026-11-18' (its own day, not UTC's). */
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** One figure in a row of them (Current mileage, Current tires): a label, the value big, and an optional line under it. */
const stat = (label, value, sub) => `<div class="info-item"><dt>${label}</dt><dd class="mileage-stat">${esc(value)}</dd>${
    sub ? `<dd class="muted mileage-sub">${esc(sub)}</dd>` : ''}</div>`;

const TREAD_STATUS = { red: 'Worn out', yellow: 'Replace soon', ok: 'OK' };
const TREAD_CLASS = { 'Worn out': 'due-red', 'Replace soon': 'due-yellow', OK: 'due-ok' };
/** A depth in 32nds of an inch: '6/32', '5.5/32'. */
const depth = n => `${n}/32`;

/**
 * Current tires: the miles on them since the newest New tires entry in the Maintenance log, when they went on, how old
 * they are, the miles a year on them and their latest tread depth, above the tread depth log (editable; its Miles on
 * tires, Lowest and Status are worked out). get() = { log, readings, tread }: the three logs as last saved; tread
 * saves are written back into it. Returns redraw(), for after the maintenance or mileage log is saved.
 */
function renderTires(el, v, get) {
    const drawNow = () => {
        const { log, readings, tread: treadRows } = get();
        const now = currentReading(v, log, readings);
        const t = currentTires(v, log, now);
        const box = el.querySelector('.tires-now');
        if (!t) {
            box.innerHTML = `<p class="muted">No tires logged yet. When tires go on, add a Maintenance entry with the Action
                <strong>New tires</strong> and the mileage, and the miles on them show here.</p>`;
            return;
        }
        const n = x => Math.round(x).toLocaleString('en-US'), meter = (v.meter || 'Mileage').toLowerCase();
        const where = String(t.entry.Location || '').trim();
        const last = latestTread(treadRows, t.entry.Date); // measured since these tires went on
        box.innerHTML = `<dl class="info-grid mileage-stats">${
            Number.isFinite(t.on)
                ? stat('Miles on these tires', `${n(t.on)} miles`, `as of ${showDate(isoDay(now.date))} (${n(now.miles)} miles)`)
                : stat('Miles on these tires', '—', Number.isFinite(t.at) ? 'No newer reading yet' : `The New tires entry has no ${meter}`)}${
            stat('Put on', showDate(t.entry.Date), [Number.isFinite(t.at) ? `at ${n(t.at)} miles` : '', where].filter(Boolean).join(' · '))}${
            stat('Age', t.age)}${
            t.perYear !== null ? stat('Miles per year', `≈ ${n(t.perYear)}`, 'on these tires') : ''}${
            last ? stat('Tread', depth(lowestTread(last)), `lowest tire, ${showDate(last.Date)} · ${TREAD_STATUS[treadLevel(lowestTread(last))]}`) : ''}</dl>
            <p class="muted mileage-sub">${t.tire ? `<strong>${esc(t.tire)}</strong>. ` : ''}From the newest Maintenance entry with
                the Action New tires, and the latest ${esc(meter)} (from the mileage log or the Maintenance log). Log the next
                set the same way and this starts over.</p>`;
    };
    const drawLog = () => {
        if (tread?.hasUnsavedEdits()) return; // don't throw away edits in progress
        const saved = get();
        tread = recordTable(el.querySelector('.tread'), {
            columns: [TREAD_COLUMNS[0], TREAD_COLUMNS[1],
                { name: 'Miles on tires', kind: 'number', calc: r => { const m = treadMiles(v, get().log, r); return Number.isFinite(m) ? m : ''; } },
                ...TREAD_COLUMNS.slice(2, -1),
                { name: 'Lowest', kind: 'number', calc: r => { const m = lowestTread(r); return Number.isFinite(m) ? m : ''; } },
                { name: 'Status', kind: 'text', calc: r => TREAD_STATUS[treadLevel(lowestTread(r))] || '', badge: x => TREAD_CLASS[x] || '' },
                TREAD_COLUMNS.at(-1)],
            rows: saved.tread,
            save: async rows => { await saveTread(v, rows); saved.tread = rows; drawNow(); },
        });
    };
    const draw = () => { drawNow(); drawLog(); };
    draw();
    return draw;
}

/** The newest reading in the log (64,870 miles, Oct 23, 2026) and the miles a month and a year it works out to. */
const currentMileage = (v, rows) => {
    const r = latestMileage(rows);
    if (!r) return '<p class="muted">Nothing logged yet. Press Edit to add a reading.</p>';
    const rate = mileageRate(v, rows);
    const n = x => (Number.isNaN(Number(x)) ? String(x) : Number(x).toLocaleString('en-US'));
    return `<dl class="info-grid mileage-stats">${stat('Latest reading', `${n(r.Mileage)} miles`, showDate(r.Date))}${rate.why
        ? stat('Miles per month / year', '—', rate.why)
        : stat('Miles per month', `≈ ${n(rate.perMonth)}`) + stat('Miles per year', `≈ ${n(rate.perYear)}`)}</dl>
        <p class="muted mileage-sub">${rate.why ? '' : `Averages from the purchase (${esc(rate.from)}) to the latest reading. `}In
            the table, each reading's miles per month and year are since the reading before it (the oldest one's since the
            purchase).</p>`;
};

/** The tabs under a vehicle's name. */
const tabs = (v, part) => {
    const tab = (sub, label, n) => `<a href="#${esc(v.id)}${sub ? '/' + sub : ''}"${(part || '') === sub ? ' class="active"' : ''}>${label}${n ? ` (${n})` : ''}</a>`;
    return `<nav class="pillnav">${tab('', 'Overview')}${tab('guides', 'Guides', (v.guides || []).length)}${tab('notes', 'Notes', (v.notes || []).length)}</nav>`;
};

/**
 * list: every vehicle (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo.
 * part: 'guides' / 'notes' for those tabs, otherwise the Overview.
 */
export async function renderVehicle(el, list, v, onListChanged, part) {
    if (part === 'guides') {
        el.innerHTML = `
            <h1 class="page">${esc(v.name)}</h1>
            <p class="lead">Guides are kept in <code>${esc(VEHICLES_PATH)}</code>; their images in <code>inputs/vehicles/guides/${esc(v.id)}/</code>.</p>
            ${tabs(v, part)}
            <section><h2>Guides</h2><div id="guides"><p class="muted">Loading…</p></div></section>`;
        return renderGuides(el.querySelector('#guides'), list, v);
    }
    if (part === 'notes') {
        el.innerHTML = `
            <h1 class="page">${esc(v.name)}</h1>
            <p class="lead">Notes are kept in <code>${esc(VEHICLES_PATH)}</code>; their images in <code>inputs/vehicles/notes/${esc(v.id)}/</code>.</p>
            ${tabs(v, part)}
            <section><h2>Notes</h2><div id="notes"></div></section>`;
        return renderNotes(el.querySelector('#notes'), list, v);
    }
    el.innerHTML = '<p class="muted">Loading…</p>';
    const rows = await loadMaintenance(v);
    const miles = hasMileageLog(v) ? await loadMileage(v) : null;
    const plan = hasSchedule(v) ? await loadSchedule(v) : null;
    const treadRows = hasTires(v) ? await loadTread(v) : null;
    el.innerHTML = `
        <h1 class="page" id="v-name"></h1>
        <p class="lead">${esc(TYPES[v.type]?.label || 'Vehicle')} · information in <code>${esc(VEHICLES_PATH)}</code>,
            ${miles ? `mileage in <code>${esc(mileagePath(v))}</code>, ` : ''}${plan ? `schedule in <code>${esc(schedulePath(v))}</code>, ` : ''}${
                treadRows ? `tread depths in <code>${esc(treadPath(v))}</code>, ` : ''}maintenance in
            <code>${esc(maintenancePath(v))}</code>.</p>
        ${tabs(v, part)}
        <section>
            <h2>Vehicle information</h2>
            <div id="info"></div>
        </section>
        ${miles ? `<section>
            <h2>Current mileage</h2>
            <div id="miles-now"></div>
            <div id="miles" class="mileage-log"></div>
        </section>` : ''}
        ${plan ? `<section id="schedule">
            <h2>Maintenance schedule</h2>
            <div class="sched-banner"></div>
            <div class="sched"></div>
            <p class="muted mileage-sub sched-note"></p>
        </section>` : ''}
        ${treadRows ? `<section id="tires">
            <h2>Current tires</h2>
            <div class="tires-now"></div>
            <h3 class="tread-h">Tread depth</h3>
            <p class="muted mileage-sub">Each tire's depth in 32nds of an inch (a gauge reading of 6 is 6/32): LF left front,
                RF right front, LR left rear, RR right rear. Replace soon at ${TREAD_LOW}/32 or less; worn out at ${TREAD_WORN}/32,
                the legal minimum. Miles on tires counts from the New tires entry before each reading.</p>
            <div class="tread"></div>
        </section>` : ''}
        <section>
            <h2>Service places</h2>
            <div id="places"></div>
        </section>
        <section>
            <h2>Photos</h2>
            <div id="photos"></div>
        </section>
        <section>
            <h2>Maintenance</h2>
            <div id="maint"></div>
        </section>`;
    el.querySelector('#v-name').textContent = v.name;
    info = infoBox(el.querySelector('#info'), {
        info: v.info,
        name: v.name,
        noun: 'vehicle',
        mono: /\b(vin|hin|serial|bow number|license plate)\b/i,
        save: async (newInfo, name) => {
            const updated = { ...v, name, info: newInfo };
            await saveVehicles(list.map(x => (x.id === v.id ? updated : x)));
            Object.assign(v, updated);
            onListChanged(v.id);
        },
        remove: async () => {
            if (!confirm(`Remove “${v.name}” from Vehicles?\n\nIts maintenance file (${maintenancePath(v)}) is kept in your folder.`)) return;
            try {
                await saveVehicles(list.filter(x => x.id !== v.id));
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            info = null;
            toast(`Removed “${v.name}”`, 'ok');
            onListChanged(list.find(x => x.id !== v.id)?.id || 'new');
        },
    });
    // The logs as last saved: the mileage table's worked-out columns, the schedule and the tires are worked out from them.
    const saved = { log: rows, readings: miles || [], tread: treadRows || [] };
    const redrawSchedule = plan ? renderSchedule(el.querySelector('#schedule'), v, plan, () => saved) : () => {};
    const redrawTires = treadRows ? renderTires(el.querySelector('#tires'), v, () => saved) : () => {};
    const redraw = () => { redrawSchedule(); redrawTires(); }; // after either log is saved
    if (miles) {
        const now = el.querySelector('#miles-now');
        now.innerHTML = currentMileage(v, miles);
        mileage = recordTable(el.querySelector('#miles'), {
            columns: [...MILEAGE_COLUMNS, ...mileageRateColumns(v, () => saved.readings)],
            rows: miles,
            save: async rows => { await saveMileage(v, rows); saved.readings = rows; now.innerHTML = currentMileage(v, rows); redraw(); },
        });
    }
    renderPlaces(el.querySelector('#places'), list, v);
    renderGallery(el.querySelector('#photos'), photosDir(v), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#maint'), {
        columns: maintenanceColumns(v, (plan || []).map(r => r.Item)), // the schedule's items are offered first as Actions
        rows,
        filesDir: invoicesDir(v),
        compact: true, // long notes take many lines: scroll inside a box, with each note cut to a few lines
        save: async rows => { await saveMaintenance(v, rows); saved.log = rows; redraw(); },
    });
}

/** The "＋ Add vehicle" page. */
export function renderNewVehicle(el, list, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a vehicle</h1>
        <p class="lead">It gets its own page with an information section and a maintenance table.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required placeholder="e.g. 2015 Toyota Tacoma"></label>
                <label class="field">Type<select name="type">${Object.entries(TYPES).map(([k, t]) =>
                    `<option value="${k}">${esc(t.label)} — tracks ${esc(t.meter.toLowerCase())}</option>`).join('')}</select></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add vehicle</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const form = new FormData(e.target);
        const name = String(form.get('name')).trim();
        if (!name) return;
        const v = newVehicle(list, name, String(form.get('type')));
        try {
            await saveVehicles([...list, v]);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(v.id);
    };
}
