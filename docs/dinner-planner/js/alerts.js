// Dinner Planner's red and yellow items, for the Home page's counts and the menu colours: leftovers in the fridge for
// 3–4 days (yellow) or 5 days and more (red), as the "In the fridge" box on the Calendar shows them.
import * as fs from '../../bills-etc/js/fs.js';
import { DB_PATH, localDate } from './store.js';
import { fridgeItems, alertText } from './leftovers.js';

/** [{ level: 'red' | 'yellow', text, href }] */
export default async function alerts() {
    const text = await fs.readText(DB_PATH);
    if (!text) return [];
    const db = JSON.parse(text);
    return fridgeItems(db.plan || {}, db.meals || [], localDate())
        .filter(x => x.level)
        .map(x => ({ level: x.level, text: alertText(x), href: '#calendar' }));
}
