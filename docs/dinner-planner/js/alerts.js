// Dinner Planner's red and yellow items, for the Home page's counts and the menu colours: leftovers in the fridge
// longer than the yellow or red number of days on the Settings tab, as the "In the fridge" box on the Calendar shows them.
import * as fs from '../../shared/js/fs.js';
import { DB_PATH, localDate } from './store.js';
import { fridgeItems, alertText, limitsOf } from './leftovers.js';

/** [{ level: 'red' | 'yellow', text, href }] */
export default async function alerts() {
    const text = await fs.readText(DB_PATH);
    if (!text) return [];
    const db = JSON.parse(text);
    return fridgeItems(db.plan || {}, db.meals || [], localDate(), limitsOf(db))
        .filter(x => x.level)
        .map(x => ({ level: x.level, text: alertText(x), href: '#calendar' }));
}
