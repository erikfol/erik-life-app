// Leftovers: a calendar day's dinner can have leftovers, each kept on the day as
// plan[date].leftovers = [{ mealId, name, status, doneOn }] (mealId '' = the day's note, e.g. eating out).
// The days in the fridge count from the dinner's day. Shared by the page (js/app.js) and the Home counts (js/alerts.js),
// so it imports nothing.

export const STATUS = { fridge: 'In the fridge', eaten: 'All eaten', tossed: 'Thrown out' };

// Cooked leftovers keep 3 to 4 days in the fridge: yellow on days 3 and 4 (eat them soon), red from day 5.
export const YELLOW_DAYS = 3;
export const RED_DAYS = 5;

const utc = key => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};
const daysFrom = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

/** Days a leftover from `date` has been in the fridge: until today, or until it was eaten or thrown out. */
export const daysIn = (date, l, today) => Math.max(0, daysFrom(date, l.status === 'fridge' ? today : l.doneOn || today));

export const levelOf = days => (days >= RED_DAYS ? 'red' : days >= YELLOW_DAYS ? 'yellow' : null);

export const daysText = n => (n === 0 ? 'since today' : n === 1 ? '1 day' : `${n} days`);

/** A leftover's name: its meal's name now, else the name saved with it. */
export const nameOf = (l, meals) => meals.find(m => m.id === l.mealId)?.name || l.name || 'Leftovers';

/** Everything in the fridge now, oldest first: [{ date, mealId, name, days, level }]. */
export function fridgeItems(plan, meals, today) {
    return Object.entries(plan)
        .filter(([date]) => date <= today)
        .flatMap(([date, e]) => (e.skipped ? [] : (e.leftovers || []).filter(l => l.status === 'fridge').map(l => {
            const days = daysIn(date, l, today);
            return { date, mealId: l.mealId, name: nameOf(l, meals), days, level: levelOf(days) };
        })))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** The Home counts' and menu's text for one: 'Chili leftovers: 5 days in the fridge'. */
export const alertText = x => `${x.name} leftovers: ${x.days} days in the fridge${x.level === 'red' ? ' (they keep 3–4)' : ''}`;
