// House's red and yellow banners, for the Home page's counts and the menu colours: each maintenance schedule item that's
// overdue (red) or due soon (yellow), as the banners on its system page or the Maintenance tab (scheduleStatus); and
// the red and yellow banners of a page's tables (REC payments: a payment late or due).
import { loadHouses, loadSchedule, allMaintenance, scheduleStatus, dueText, pageOfItem, pageHref, AREAS, loadAreaTable } from './house.js';

/** [{ level: 'red' | 'yellow', text, href }] (href: the item's system page, else the Maintenance tab) */
export default async function alerts() {
    const houses = await loadHouses(false);
    const lists = await Promise.all(houses.map(async h => {
        const [items, entries] = await Promise.all([loadSchedule(h, false), allMaintenance(h)]);
        const tables = await Promise.all(AREAS.flatMap(t => t.parts || [t]).flatMap(a => (a.tables || []).filter(tb => tb.banners).map(async tb =>
            tb.banners(h, a, await loadAreaTable(h, a, tb, false)).filter(b => b.level === 'red' || b.level === 'yellow')
                .map(b => ({ level: b.level, text: `${b.title.replace(/\.$/, '')}${houses.length > 1 ? ` (${h.name})` : ''}`, href: pageHref(h, a) })))));
        return [...items.map(r => ({ r, s: scheduleStatus(h, r, entries) })).filter(x => x.s.level === 'red' || x.s.level === 'yellow')
            .map(({ r, s }) => ({
                level: s.level,
                text: `${r.Item}${houses.length > 1 ? ` (${h.name})` : ''} ${s.level === 'red' ? 'is due' : 'is due by'} ${dueText(s)}`,
                href: pageOfItem(r) ? pageHref(h, pageOfItem(r)) : `#${h.id}/maintenance`,
            })), ...tables.flat()];
    }));
    return lists.flat();
}
