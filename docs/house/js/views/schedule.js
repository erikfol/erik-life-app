// House → Maintenance tab (#<house>/maintenance): the maintenance schedule — banners for what's overdue (red) and due
// soon (yellow), the schedule table (editable; Status, Next due and Last done worked out from every Maintenance table
// of the house) — and the log for work that isn't on one of the system pages. Also the due banners at the top of a
// system page (Oil furnace, Septic…), from its schedule items.
import { esc } from '../../../bills-etc/js/util.js';
import { recordTable } from '../../../shared/js/recordtable.js';
import {
    MAINTENANCE_PAGES, pageHref, schedulePath, houseLogPath, scheduleColumns, loadSchedule, saveSchedule, maintenanceColumns,
    loadHouseLog, saveHouseLog, allMaintenance, pageOfItem, scheduleStatus, dueText, lastText, itemBanner, SOON_DAYS, invoicesDir,
} from '../house.js';

let schedule = null, log = null;
export const scheduleUnsaved = () => !!schedule?.hasUnsavedEdits() || !!log?.hasUnsavedEdits();
export const forgetSchedule = () => { schedule = null; log = null; };

const STATUS = { red: 'Overdue', yellow: 'Due soon', ok: 'OK' };
const STATUS_CLASS = { Overdue: 'due-red', 'Due soon': 'due-yellow', OK: 'due-ok' };
const BANNER = { red: 'banner bad', yellow: 'banner', ok: 'banner ok' };

/** The banners at the top of system page `a`: one per schedule item whose Area is that page. */
export const pageBanners = (h, a, items, entries) => items.filter(r => pageOfItem(r) === a)
    .map(r => itemBanner(r, scheduleStatus(h, r, entries))).filter(Boolean)
    .map(b => `<div class="${BANNER[b.level]}"><strong>${esc(b.title)}</strong> ${esc(b.detail)}</div>`).join('');

/** The Maintenance tab. top: the house name and menus. */
export async function renderScheduleTab(el, h, top) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    let [rows, entries, logRows] = await Promise.all([loadSchedule(h), allMaintenance(h), loadHouseLog(h)]);
    el.innerHTML = `${top}
        <p class="lead">Schedule in <code>${esc(schedulePath(h))}</code>; this tab's log in <code>${esc(houseLogPath(h))}</code>.</p>
        <section>
            <h2>Maintenance schedule</h2>
            <div class="sched-banner"></div>
            <div class="sched"></div>
            <p class="muted mileage-sub">An item counts from the newest entry, in any of the house's Maintenance tables, whose Action is
                its name (or one of its Also counts names, comma-separated). Never logged, it counts from Count from (e.g. 2020-05), else
                when you bought the house; with Due by (month) it's due by the 1st of that month once a year (or every Every (months) ÷ 12
                years). Due soon: within ${SOON_DAYS} days. Items whose Area is a system page (${esc(MAINTENANCE_PAGES.map(a => a.label).join(', '))})
                also show their banner there, and their work is logged in that page's Maintenance table.</p>
        </section>
        <section>
            <h2>Maintenance log</h2>
            <p class="section-note">For work that isn't on a system page: safety checks, gutters, the dryer vent… Use the item's name as the Action.</p>
            <div class="house-log"></div>
        </section>`;
    const draw = () => {
        const states = rows.map(r => ({ r, s: scheduleStatus(h, r, entries) }));
        const where = r => { const a = pageOfItem(r); return a ? ` <a href="${esc(pageHref(h, a))}">${esc(a.label)} →</a>` : ''; };
        const item = x => `<span class="nowrap"><strong>${esc(x.r.Item)}</strong> <span class="muted">(due ${esc(dueText(x.s))})</span>${where(x.r)}</span>`;
        const red = states.filter(x => x.s.level === 'red'), yellow = states.filter(x => x.s.level === 'yellow');
        el.querySelector('.sched-banner').innerHTML = (red.length ? `<div class="banner bad"><strong>Overdue:</strong> ${red.map(item).join(' · ')}</div>` : '')
            + (yellow.length ? `<div class="banner"><strong>Due soon:</strong> ${yellow.map(item).join(' · ')}</div>` : '')
            + (rows.length && !red.length && !yellow.length ? '<div class="banner ok">✓ <strong>Nothing due.</strong> Everything on the schedule is up to date.</div>' : '');
        if (schedule?.hasUnsavedEdits()) return; // don't throw away edits in progress
        const status = r => scheduleStatus(h, r, entries);
        const cols = scheduleColumns([...new Set(entries.map(e => String(e.row.Action || '').trim()).filter(Boolean))]);
        schedule = recordTable(el.querySelector('.sched'), {
            columns: [cols[0], cols[1],
                { name: 'Status', kind: 'text', calc: r => STATUS[status(r).level] || '—', badge: x => STATUS_CLASS[x] || '' },
                { name: 'Next due', kind: 'text', calc: r => dueText(status(r)) || 'Fill in Every or Due by' },
                { name: 'Last done', kind: 'text', calc: r => lastText(status(r), r) || 'Not logged' },
                cols.at(-1), ...cols.slice(2, -1)], // Notes next, so it's in view; then how often
            rows,
            save: async next => { await saveSchedule(h, next); rows = next; schedule = null; draw(); drawLog(); },
        });
    };
    // The tab's own log; its Action offers the schedule's items that aren't on a system page.
    const drawLog = () => {
        if (log?.hasUnsavedEdits()) return;
        log = recordTable(el.querySelector('.house-log'), {
            columns: maintenanceColumns(h, rows.filter(r => !pageOfItem(r)).map(r => r.Item)),
            rows: logRows,
            filesDir: invoicesDir(h, 'maintenance'),
            save: async next => {
                await saveHouseLog(h, next);
                logRows = next;
                entries = [...entries.filter(e => e.page), ...next.map(row => ({ row, page: null }))];
                log = null; drawLog(); draw();
            },
        });
    };
    draw();
    drawLog();
}

/** For a system page: { items (the schedule), entries (allMaintenance) } — what pageBanners needs. */
export async function pageSchedule(h) {
    const [items, entries] = await Promise.all([loadSchedule(h, false), allMaintenance(h)]);
    return { items, entries };
}
