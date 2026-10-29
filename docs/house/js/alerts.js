// House's red and yellow banners, for the Home page's counts: each maintenance due banner that's shown (House →
// ⚙ Settings), red once it's due and yellow in its warning time before, as on its page (maintenanceStatus).
import { loadHouses, MAINTENANCE_PAGES, bannerSettings, maintenanceStatus, loadMaintenance } from './house.js';

/** [{ level: 'red' | 'yellow', text }] */
export default async function alerts() {
    const houses = await loadHouses(false);
    const lists = await Promise.all(houses.flatMap(h => MAINTENANCE_PAGES.map(async a => {
        const b = bannerSettings(h, a);
        if (!b.show) return [];
        const { level, due } = maintenanceStatus(await loadMaintenance(h, a, false), b);
        const what = `${b.what}${houses.length > 1 ? ` (${h.name})` : ''}`;
        const by = due.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        return level === 'due' ? [{ level: 'red', text: `${what} is due (due by ${by})` }]
            : level === 'soon' ? [{ level: 'yellow', text: `${what} is due by ${by}` }] : [];
    })));
    return lists.flat();
}
