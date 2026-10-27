// Gifts, Bday, Anniversary: the people (each with their dates and information) and the list of Christmas years in
// inputs/gifts/gifts.json; one gifts CSV per person and one per Christmas year next to it. inputs/ is kept out of git,
// so names and dates are only ever in your folder.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const GIFTS_DIR = 'inputs/gifts';
export const GIFTS_PATH = `${GIFTS_DIR}/gifts.json`;

// The information fields a new person starts with (any can be renamed, removed or reordered). A field whose value is
// a date (Nov 25, Sep 8 2017…) shows when it's next, and the page's banner warns when one is coming up.
export const FIELDS = ['Birthday', 'Sizes', 'Favorite colors', 'Favorite stores', 'Likes', 'Notes'];

// Offered in the Status column (anything else can be typed). Ideas aren't counted in totals; Plan is still to buy;
// Waiting to get is bought but not here yet; the rest are got.
export const STATUSES = ['Idea', 'Plan', 'Bought', 'Waiting to get', 'Received', 'Given'];

// Hash names the menu uses, so a person can't be given one of them as an id.
const RESERVED = ['christmas', 'new'];

const thisYear = () => String(new Date().getFullYear());

/**
 * { people: [{ id, name, info }], christmasYears: ['2025', …], guides: [{ id, year, title, info }] } (plus anything else
 * in the file, kept as it is). A guide is a Christmas year's buying guide (see GUIDE_* below).
 */
export async function loadData(track = true) {
    const text = track ? await readTracked(GIFTS_PATH) : await fs.readText(GIFTS_PATH);
    const data = text === null ? {} : JSON.parse(text);
    return {
        ...data,
        people: Array.isArray(data.people) ? data.people : [],
        christmasYears: Array.isArray(data.christmasYears) ? data.christmasYears.map(String) : [thisYear()],
        guides: Array.isArray(data.guides) ? data.guides : [],
    };
}

export async function saveData(data) {
    const years = [...new Set(data.christmasYears)].sort();
    await writeTracked(GIFTS_PATH, JSON.stringify({ ...data, christmasYears: years }, null, 2) + '\n');
    window.dispatchEvent(new Event('data-saved'));
}

/** A new person with a unique id made from their name. */
export function newPerson(people, name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'person';
    let id = base;
    for (let n = 2; RESERVED.includes(id) || people.some(p => p.id === id); n++) id = `${base}-${n}`;
    return { id, name, info: FIELDS.map(label => ({ label, value: '' })) };
}

// ── Dates ──────────────────────────────────────────────────────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const month = w => (w.length < 3 ? -1 : MONTHS.findIndex(m => m.startsWith(w.toLowerCase())));

/**
 * A date typed as Nov 25, November 25th, 11/25 or 25 Nov, with or without a year (Sep 8, 2017, 9/8/2017, 2017-09-08):
 * { m: 0–11, d, y } (y null when there's no year); null if it isn't a date.
 */
export function readDate(value) {
    const s = String(value ?? '').trim();
    let m, d, y = null, x;
    if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) [y, m, d] = [+x[1], x[2] - 1, +x[3]];
    else if ((x = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(s))) [m, d, y] = [x[1] - 1, +x[2], x[3] ? +x[3] : null];
    else if ((x = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(s))) [m, d, y] = [month(x[1]), +x[2], x[3] ? +x[3] : null];
    else if ((x = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/.exec(s))) [m, d, y] = [month(x[2]), +x[1], x[3] ? +x[3] : null];
    else return null;
    if (m < 0 || m > 11 || d < 1 || d > new Date(2000, m + 1, 0).getDate()) return null; // 2000 had a Feb 29
    return { m, d, y };
}

/** When a yearly date next comes, on or after `today`: { date, days (0 = today), years (since its year, or null) }. */
export function nextDate(dt, today = new Date()) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const on = y => new Date(y, dt.m, Math.min(dt.d, new Date(y, dt.m + 1, 0).getDate())); // Feb 29 → Feb 28
    let date = on(start.getFullYear());
    if (date < start) date = on(start.getFullYear() + 1);
    const years = dt.y == null ? null : date.getFullYear() - dt.y;
    return { date, days: Math.round((date - start) / 86400000), years: years > 0 ? years : null };
}

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/** 'turns 40', '10th anniversary', '3 years', or '' when the date has no year. */
export function milestone(label, years) {
    if (!years) return '';
    if (/birth|bday/i.test(label)) return `turns ${years}`;
    if (/anniv|wedding|married/i.test(label)) return `${ordinal(years)} anniversary`;
    return `${years} year${years === 1 ? '' : 's'}`;
}

/** A person's information fields that are dates, soonest first: [{ label, date, days, years }]. */
export function upcomingDates(person, today = new Date()) {
    return (person.info || [])
        .map(f => ({ label: f.label.trim(), dt: readDate(f.value) }))
        .filter(x => x.label && x.dt)
        .map(({ label, dt }) => ({ label, ...nextDate(dt, today) }))
        .sort((a, b) => a.days - b.days);
}

/** Christmas `year`'s day, and how many days until it (negative once it's past). */
export function christmas(year, today = new Date()) {
    const date = new Date(+year, 11, 25);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return { date, days: Math.round((date - start) / 86400000) };
}

/** The Christmas a gift list is being made for now: this year's, or next year's after Dec 25. */
export const comingChristmas = (today = new Date()) => String(today.getFullYear() + (christmas(today.getFullYear(), today).days < 0 ? 1 : 0));

export const showDay = date => date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const inDays = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

// ── Gifts ──────────────────────────────────────────────────────────────

/** 'idea', 'todo' (a plan, or no status), 'waiting' (bought, not here yet) or 'got'. */
export function statusGroup(status) {
    const s = String(status ?? '').trim().toLowerCase();
    if (s === 'idea' || s === 'maybe') return 'idea';
    if (!s || s === 'plan' || s === 'planned' || s === 'to buy') return 'todo';
    if (s.startsWith('waiting') || s === 'ordered' || s === 'shipped') return 'waiting';
    return 'got';
}

const priceOf = v => Number(String(v ?? '').replace(/[$,]/g, '')) || 0;

/** What a set of gifts adds up to. Ideas are only counted; every other gift is in the total. */
export function tally(rows) {
    const t = { count: 0, ideas: 0, todo: 0, waiting: 0, got: 0, total: 0, toBuy: 0, spent: 0 };
    for (const r of rows) {
        const g = statusGroup(r.Status), price = priceOf(r.Price);
        if (g === 'idea') { t.ideas++; continue; }
        t.count++;
        t[g]++;
        t.total += price;
        if (g === 'todo') t.toBuy += price; else t.spent += price;
    }
    return t;
}

const statusColumn = { name: 'Status', kind: 'suggest', suggestions: STATUSES, default: 'Plan', badge: v => `st-${statusGroup(v)}` };

/** A person's gift columns; `occasions` (their date fields' names) are offered first in Occasion. */
export const giftColumns = occasions => [
    { name: 'Year', kind: 'suggest', default: thisYear, suggestions: [0, 1, -1].map(n => String(new Date().getFullYear() + n)) },
    { name: 'Occasion', kind: 'suggest', suggestions: [...occasions, "Valentine's Day", "Mother's Day", 'Just because'] },
    { name: 'Gift', kind: 'text' },
    { name: 'Link', kind: 'link' },
    { name: 'Price', kind: 'money' },
    statusColumn,
    { name: 'Notes', kind: 'text' },
];

/** The Christmas list's columns; `people` (the people pages and names on other years' lists) are offered in Person. */
export const christmasColumns = people => [
    { name: 'Person', kind: 'suggest', suggestions: people },
    { name: 'Gift', kind: 'text' },
    { name: 'Link', kind: 'link' },
    { name: 'Price', kind: 'money' },
    statusColumn,
    { name: 'Notes', kind: 'text' },
];

const GIFT_NAMES = giftColumns([]).map(c => c.name);
const CHRISTMAS_NAMES = christmasColumns([]).map(c => c.name);

export const giftsPath = p => `${GIFTS_DIR}/${p.id}-gifts.csv`;
export const christmasPath = year => `${GIFTS_DIR}/christmas-${year}.csv`;

async function readRows(path, names, track) {
    const text = track ? await readTracked(path) : await fs.readText(path);
    if (text === null) return [];
    return parseCSV(text).rows.map(r => Object.fromEntries(names.map(c => [c, r[c] ?? ''])));
}

async function writeRows(path, names, rows) {
    await writeTracked(path, toCSV(names, rows));
    window.dispatchEvent(new Event('data-saved'));
}

export const loadGifts = (p, track = true) => readRows(giftsPath(p), GIFT_NAMES, track);
export const saveGifts = (p, rows) => writeRows(giftsPath(p), GIFT_NAMES, rows);
export const loadChristmas = (year, track = true) => readRows(christmasPath(year), CHRISTMAS_NAMES, track);
export const saveChristmas = (year, rows) => writeRows(christmasPath(year), CHRISTMAS_NAMES, rows);

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
export const isFor = name => r => same(r.Person, name);
export const forOccasion = (rows, label, year) => rows.filter(r => same(r.Occasion, label) && String(r.Year).trim() === String(year));

// ── Buying guides ──────────────────────────────────────────────────────
// A Christmas year can have buying guides (e.g. tablets for the kids): a summary box, the options compared, and a
// price watch that says whether a price you've seen is worth buying at. Each guide's tables are two CSVs.

// The summary fields a new guide starts with.
export const GUIDE_FIELDS = ['For', 'Pick', 'Where to watch', 'Notes'];

/** A new guide for Christmas `year` with a unique id made from its title. */
export function newGuide(guides, year, title) {
    const base = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guide'}-${year}`;
    let id = base;
    for (let n = 2; guides.some(g => g.id === id); n++) id = `${base}-${n}`;
    return { id, year: String(year), title, info: GUIDE_FIELDS.map(label => ({ label, value: '' })) };
}

export const OPTION_COLUMNS = [
    { name: 'Item', kind: 'suggest' },
    { name: 'Details', kind: 'text' },
    { name: 'Typical Price', kind: 'suggest' }, // a range like $110-$150, so not a number
    { name: 'Pros', kind: 'text' },
    { name: 'Cons', kind: 'text' },
    { name: 'Link', kind: 'link' },
];

/** Price watch → Deal: a price seen at or under Buy Now At, Great Deal or Good Deal; Wait when it's above them all. */
export function dealFor(r) {
    const n = v => priceOf(v) || null;
    const seen = n(r['Price Seen']);
    if (!seen) return '';
    if (n(r['Buy Now At']) && seen <= n(r['Buy Now At'])) return 'Buy now';
    if (n(r['Great Deal']) && seen <= n(r['Great Deal'])) return 'Great deal';
    if (n(r['Good Deal']) && seen <= n(r['Good Deal'])) return 'Good deal';
    return 'Wait';
}

const DEAL_CLASS = { 'Buy now': 'deal-buy', 'Great deal': 'deal-great', 'Good deal': 'deal-good', Wait: 'deal-wait' };

/** The price watch's columns (Deal next to Item, so it's in view on a narrow screen); `items` are offered in Item. */
export const priceColumns = items => [
    { name: 'Item', kind: 'suggest', suggestions: items },
    { name: 'Deal', calc: dealFor, badge: v => DEAL_CLASS[v] || '' },
    { name: 'Price Seen', kind: 'money', total: false },
    { name: 'Where Seen', kind: 'suggest', suggestions: ['Amazon', 'Walmart', 'Best Buy', 'Target', 'Costco'] },
    { name: 'Date Seen', kind: 'date' },
    { name: 'Buy Now At', kind: 'money', total: false },
    { name: 'Great Deal', kind: 'money', total: false },
    { name: 'Good Deal', kind: 'money', total: false },
    { name: 'Expected Sale', kind: 'suggest' }, // e.g. the Black Friday range
];

const OPTION_NAMES = OPTION_COLUMNS.map(c => c.name);
const PRICE_NAMES = priceColumns([]).filter(c => !c.calc).map(c => c.name);

export const optionsPath = g => `${GIFTS_DIR}/guide-${g.id}-options.csv`;
export const pricesPath = g => `${GIFTS_DIR}/guide-${g.id}-prices.csv`;

export const loadOptions = g => readRows(optionsPath(g), OPTION_NAMES, true);
export const saveOptions = (g, rows) => writeRows(optionsPath(g), OPTION_NAMES, rows);
export const loadPrices = g => readRows(pricesPath(g), PRICE_NAMES, true);
export const savePrices = (g, rows) => writeRows(pricesPath(g), PRICE_NAMES, rows);
