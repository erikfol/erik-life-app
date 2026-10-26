// The school's lunch menu, shown read-only on the calendar for reference. Each month is loaded from the link to its
// FD MealPlanner menu printout (fdmealplanner.com/pages/menuPrintout/?…&monthId=10&year=2026). That page fills itself
// in from FD MealPlanner's menu API, which this calls directly (no sign-in needed); only each day's dish names are kept,
// in inputs/kid-lunches/school-menu.json.
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';
import { DIR } from './store.js';

export const PATH = `${DIR}/school-menu.json`;
const API = 'https://apiservicelocatorstenant.fdmealplanner.com/api/v1/data-locator-webapi';

let menu = { months: {} }; // { months: { 'YYYY-MM': { url, loaded, days: { date: { closed } | { items: [{ name, main }] } } } } }

export const months = () => menu.months;

/** The school's menu for a day: { closed: true }, { items: [{ name, main }] }, or null if no month covers it. */
export const dayMenu = date => menu.months[date.slice(0, 7)]?.days[date] || null;

export async function load() {
    const text = await readTracked(PATH);
    menu = text ? JSON.parse(text) : { months: {} };
    menu.months ||= {};
}

const save = () => writeTracked(PATH, JSON.stringify(menu, null, 2));

const pad = n => String(n).padStart(2, '0');
export const monthLabel = ym => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

/** The menu printout link's settings, or an error saying what's wrong with it. */
function readLink(link) {
    let url;
    try {
        url = new URL(link.trim());
    } catch {
        throw new Error("That doesn't look like a link. Copy the whole address of the menu page and paste it here.");
    }
    if (!/(^|\.)fdmealplanner\.com$/.test(url.hostname)) throw new Error('That link is not an FD MealPlanner menu (fdmealplanner.com).');
    const p = url.searchParams;
    const need = ['tenantId', 'accountId', 'locationId', 'mealPeriodId', 'monthId', 'year'];
    const missing = need.filter(k => !/^\d+$/.test(p.get(k) || ''));
    if (missing.length) throw new Error(`That link is missing part of what says which menu it is (${missing.join(', ')}). Use the link of the monthly menu printout page.`);
    const month = +p.get('monthId');
    const year = +p.get('year');
    if (month < 1 || month > 12) throw new Error('That link has a month that doesn\'t exist.');
    return { p, month, year };
}

/** A day's dishes as the printout lists them: main dishes first, then the sides, each in menu order. */
function dishes(day) {
    return (day.menuRecipiesData || [])
        .filter(r => String(r.isShowOnMenu) === '1')
        .map(r => ({ name: String(r.componentEnglishName || r.componentName || '').trim(), main: String(r.isEntreeType) === '1', seq: +r.sequenceNumber || 0 }))
        .filter(r => r.name)
        .sort((a, b) => (b.main - a.main) || (a.seq - b.seq))
        .map(({ name, main }) => ({ name, main }));
}

/** Load (or reload) the month a menu printout link is for. Returns { ym, days } (days = school days with a menu). */
export async function loadMonth(link) {
    const { p, month, year } = readLink(link);
    const ym = `${year}-${pad(month)}`;
    const last = new Date(year, month, 0).getDate();
    const query = new URLSearchParams({
        tenantId: p.get('tenantId'),
        accountId: p.get('accountId'),
        locationId: p.get('locationId'),
        mealPeriodId: p.get('mealPeriodId'),
        menuId: /^\d+$/.test(p.get('menuId') || '') ? p.get('menuId') : '0',
        monthId: month,
        startDate: `${year}/${pad(month)}/01`,
        endDate: `${year}/${pad(month)}/${last}`,
        timeOffset: new Date().getTimezoneOffset(),
    });
    let data;
    try {
        const res = await fetch(`${API}/${p.get('tenantId')}/meals?${query}`);
        if (!res.ok) throw new Error(`the menu site answered ${res.status}`);
        data = await res.json();
    } catch (err) {
        throw new Error(`Couldn't load the menu (${err.message}). Check the internet connection and try again.`);
    }
    const days = {};
    for (const d of data.result || []) {
        const date = String(d.strMenuForDate || '').slice(0, 10);
        if (!date.startsWith(ym)) continue;
        if (d.isLocationClosed) days[date] = { closed: true };
        else {
            const items = dishes(d);
            if (items.length) days[date] = { items };
        }
    }
    if (!Object.keys(days).length) throw new Error(`The school hasn't posted a menu for ${monthLabel(ym)} yet.`);
    await change(ym, { url: link.trim(), loaded: new Date().toISOString(), days });
    return { ym, days: Object.values(days).filter(d => d.items).length };
}

export const removeMonth = ym => change(ym, null);

/** Replace (or with null remove) a month and save; if the save fails, the month goes back to how it was. */
async function change(ym, month) {
    const before = menu.months[ym];
    if (month) menu.months[ym] = month;
    else delete menu.months[ym];
    try {
        await save();
    } catch (err) {
        if (before) menu.months[ym] = before;
        else delete menu.months[ym];
        throw err;
    }
}
