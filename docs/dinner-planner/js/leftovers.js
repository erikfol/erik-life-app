// Leftovers: a calendar day's dinner can have leftovers, each kept on the day as
// plan[date].leftovers = [{ mealId, name, status, doneOn }] (mealId '' = the day's note, e.g. eating out).
// The days in the fridge count from the dinner's day. Shared by the page (js/app.js) and the Home counts (js/alerts.js),
// so it imports nothing.

export const STATUS = { fridge: 'In the fridge', eaten: 'All eaten', tossed: 'Thrown out' };

// A day you ate out (plan[date].ateOut = { place }) can have leftovers too: their mealId is OUT.
export const OUT = '@out';

/** What a day's leftovers can be of: its meals and eating out, or (with neither) its note. */
export function leftoverKeys({ mealIds = [], note = '', ateOut = null }) {
    const keys = [...mealIds, ...(ateOut ? [OUT] : [])];
    return keys.length ? keys : note ? [''] : [];
}

/** How eating out shows: the place, or 'Ate out' ('Eating out' on a day still to come) without one. */
export const outLabel = (ateOut, future = false) => ateOut?.place || (future ? 'Eating out' : 'Ate out');

// Leftovers turn yellow, then red, once they've been in the fridge MORE than this many days. Changed on the Settings
// tab and saved in db.json as settings.leftovers { yellowAfter, redAfter }.
export const DEFAULT_LIMITS = { yellow: 5, red: 8 };
export const MAX_DAYS = 365;

const wholeDays = v => (Number.isInteger(v) && v >= 0 && v <= MAX_DAYS ? v : null);

/** The yellow / red limits saved in the data file ({ yellow, red }), or the defaults. */
export function limitsOf(db) {
    const s = db?.settings?.leftovers;
    const yellow = wholeDays(s?.yellowAfter), red = wholeDays(s?.redAfter);
    return yellow !== null && red !== null && red > yellow ? { yellow, red } : { ...DEFAULT_LIMITS };
}

/** Why these limits can't be saved, or '' when they can. */
export function limitsProblem({ yellow, red }) {
    if (wholeDays(yellow) === null || wholeDays(red) === null) return `Use whole numbers of days from 0 to ${MAX_DAYS}.`;
    if (red <= yellow) return 'Red needs more days than yellow.';
    return '';
}

const utc = key => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
};
const daysFrom = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

/** Days a leftover from `date` has been in the fridge: until today, or until it was eaten or thrown out. */
export const daysIn = (date, l, today) => Math.max(0, daysFrom(date, l.status === 'fridge' ? today : l.doneOn || today));

export const levelOf = (days, limits = DEFAULT_LIMITS) => (days > limits.red ? 'red' : days > limits.yellow ? 'yellow' : null);

export const daysText = n => (n === 0 ? 'since today' : n === 1 ? '1 day' : `${n} days`);

/** A leftover's name: its meal's name now, else the name saved with it. */
export const nameOf = (l, meals) => meals.find(m => m.id === l.mealId)?.name || l.name || 'Leftovers';

/** Everything in the fridge now, oldest first: [{ date, mealId, name, days, level }]. */
export function fridgeItems(plan, meals, today, limits = DEFAULT_LIMITS) {
    return Object.entries(plan)
        .filter(([date]) => date <= today)
        .flatMap(([date, e]) => (e.skipped ? [] : (e.leftovers || []).filter(l => l.status === 'fridge').map(l => {
            const days = daysIn(date, l, today);
            return { date, mealId: l.mealId, name: nameOf(l, meals), days, level: levelOf(days, limits) };
        })))
        .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** The Home counts' and menu's text for one: 'Chili leftovers: 9 days in the fridge'. */
export const alertText = x => `${x.name} leftovers: ${x.days} days in the fridge`;
