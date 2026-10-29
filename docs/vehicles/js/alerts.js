// Vehicles' red and yellow banners, for the Home page's counts and the menu colours: each item of a car's or boat's
// maintenance schedule that's overdue (red) or due soon (yellow), as the banners above the schedule on its page
// (scheduleStatus).
import {
    loadVehicles, hasSchedule, hasMileageLog, loadSchedule, loadMaintenance, loadMileage, currentReading, scheduleStatus, dueText,
} from './vehicles.js';

/** [{ level: 'red' | 'yellow', text, href }] (href: the vehicle's page) */
export default async function alerts() {
    const lists = await Promise.all((await loadVehicles(false)).filter(hasSchedule).map(async v => {
        const [items, log, readings] = await Promise.all([
            loadSchedule(v, false), loadMaintenance(v, false), hasMileageLog(v) ? loadMileage(v, false) : []]);
        const now = currentReading(v, log, readings);
        return items.map(r => ({ r, s: scheduleStatus(v, r, log, now) })).filter(x => x.s.level === 'red' || x.s.level === 'yellow')
            .map(({ r, s }) => ({ level: s.level, text: `${v.name}: ${r.Item} ${s.level === 'red' ? 'overdue' : 'due soon'} (due ${dueText(s)})`, href: `#${v.id}` }));
    }));
    return lists.flat();
}
