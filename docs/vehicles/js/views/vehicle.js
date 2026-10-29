// One vehicle's page, in three tabs: Overview (information, current mileage and the maintenance schedule for cars,
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
    lastText, SOON_MILES, SOON_DAYS,
} from '../vehicles.js';

let table = null;
let mileage = null; // the mileage log (cars)
let schedule = null; // the maintenance schedule (cars)
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!mileage?.hasUnsavedEdits() || !!schedule?.hasUnsavedEdits()
    || !!info?.hasUnsavedEdits() || placesUnsaved() || guidesUnsaved() || notesUnsaved();
export const forget = () => {
    table = null; mileage = null; schedule = null; info = null;
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
        el.querySelector('.sched-note').innerHTML = `Worked out from ${now ? `the latest mileage, <strong>${now.miles.toLocaleString('en-US')} miles</strong>
            (${esc(now.date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}),` : 'the mileage (none logged yet)'} and the
            Maintenance log below. An item counts from the newest entry whose Action is its name (or one of its Also counts names,
            comma-separated); never logged, it counts from the purchase (by First, where that's filled in). Due soon: within
            ${SOON_MILES.toLocaleString('en-US')} miles or ${SOON_DAYS} days. Log work with the item's name as the Action and it turns green.`;
        if (schedule?.hasUnsavedEdits()) return; // don't throw away edits in progress
        const cols = scheduleColumns([...new Set(log.map(r => String(r.Action || '').trim()).filter(Boolean))]);
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
            save: async next => { await saveSchedule(v, next); saved = next; schedule = null; draw(); },
        });
    };
    draw();
    return draw;
}

/** The newest reading in the log (64,870 miles, Oct 23, 2026) and the miles a month and a year it works out to. */
const currentMileage = (v, rows) => {
    const r = latestMileage(rows);
    if (!r) return '<p class="muted">Nothing logged yet. Press Edit to add a reading.</p>';
    const rate = mileageRate(v, rows);
    const n = x => (Number.isNaN(Number(x)) ? String(x) : Number(x).toLocaleString('en-US'));
    const stat = (label, value, sub) => `<div class="info-item"><dt>${label}</dt><dd class="mileage-stat">${esc(value)}</dd>${
        sub ? `<dd class="muted mileage-sub">${esc(sub)}</dd>` : ''}</div>`;
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
    el.innerHTML = `
        <h1 class="page" id="v-name"></h1>
        <p class="lead">${esc(TYPES[v.type]?.label || 'Vehicle')} · information in <code>${esc(VEHICLES_PATH)}</code>,
            ${miles ? `mileage in <code>${esc(mileagePath(v))}</code>, ` : ''}${plan ? `schedule in <code>${esc(schedulePath(v))}</code>, ` : ''}maintenance in
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
    // The logs as last saved: the mileage table's worked-out columns and the schedule are worked out from them.
    const saved = { log: rows, readings: miles || [] };
    const redrawSchedule = plan ? renderSchedule(el.querySelector('#schedule'), v, plan, () => saved) : () => {};
    if (miles) {
        const now = el.querySelector('#miles-now');
        now.innerHTML = currentMileage(v, miles);
        mileage = recordTable(el.querySelector('#miles'), {
            columns: [...MILEAGE_COLUMNS, ...mileageRateColumns(v, () => saved.readings)],
            rows: miles,
            save: async rows => { await saveMileage(v, rows); saved.readings = rows; now.innerHTML = currentMileage(v, rows); redrawSchedule(); },
        });
    }
    renderPlaces(el.querySelector('#places'), list, v);
    renderGallery(el.querySelector('#photos'), photosDir(v), { noun: 'photo' }).catch(err => {
        el.querySelector('#photos').innerHTML = `<div class="banner bad">Couldn't load photos: ${esc(err.message)}</div>`;
    });
    table = recordTable(el.querySelector('#maint'), {
        columns: maintenanceColumns(v, (plan || []).map(r => r.Item)), // the schedule's items are offered first as Actions
        rows,
        save: async rows => { await saveMaintenance(v, rows); saved.log = rows; redrawSchedule(); },
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
