// Gifts' red and yellow banners: the rules a person's date banner (views/person.js) and the Christmas banner
// (views/christmas.js) use, and the Home page's counts and the menu colours from them.
import { loadData, loadGifts, loadChristmas, upcomingDates, christmas, comingChristmas, tally, forOccasion, inDays } from './gifts.js';

export const DATE_SOON_DAYS = 30; // a date this close with nothing planned turns the banner red
export const CHRISTMAS_SOON_DAYS = 14; // this close to Christmas with gifts still to buy, the banner turns red
export const CHRISTMAS_BANNER_DAYS = 90; // a Christmas further off than this gets no banner (the cards say where it stands)

/**
 * A person's next date (from upcomingDates) with their gifts: 'red' within DATE_SOON_DAYS and nothing planned for it,
 * 'yellow' within DATE_SOON_DAYS and gifts still to buy, else 'green'. null without a date.
 */
export function dateLevel(next, gifts) {
    if (!next) return null;
    if (next.days > DATE_SOON_DAYS) return 'green';
    const t = tally(forOccasion(gifts, next.label, next.date.getFullYear()));
    return !t.count ? 'red' : t.todo ? 'yellow' : 'green';
}

/**
 * Christmas `year`'s list: null when it's past or more than CHRISTMAS_BANNER_DAYS off (no banner); 'yellow' with
 * nothing on the list, or gifts still to buy ('red' from CHRISTMAS_SOON_DAYS); else 'green'.
 */
export function christmasLevel(year, rows) {
    const { days } = christmas(year);
    if (days < 0 || days > CHRISTMAS_BANNER_DAYS) return null;
    const t = tally(rows);
    return !t.count ? 'yellow' : t.todo ? (days <= CHRISTMAS_SOON_DAYS ? 'red' : 'yellow') : 'green';
}

/** [{ level: 'red' | 'yellow', text, href }]: each person's next date, and the coming Christmas's list if there is one. */
export default async function alerts() {
    const data = await loadData(false);
    const people = await Promise.all(data.people.map(async p => {
        const next = upcomingDates(p)[0];
        const level = dateLevel(next, next ? await loadGifts(p, false) : []);
        return level === 'red' ? [{ level, text: `${p.name}: ${next.label} ${inDays(next.days)}, nothing planned yet`, href: `#${p.id}` }]
            : level === 'yellow' ? [{ level, text: `${p.name}: ${next.label} ${inDays(next.days)}, gifts still to buy`, href: `#${p.id}` }] : [];
    }));
    const year = comingChristmas(), out = people.flat();
    if (data.christmasYears.includes(year)) {
        const rows = await loadChristmas(year, false);
        const level = christmasLevel(year, rows), t = tally(rows);
        if (level === 'red' || level === 'yellow') {
            out.push({ level, text: `Christmas ${inDays(christmas(year).days)}: ${t.count ? `${t.todo} of ${t.count} gifts still to buy` : `nothing on the ${year} list yet`}`, href: `#christmas/${year}` });
        }
    }
    return out;
}
