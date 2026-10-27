// One person's page — a banner for their next date, their dates & information, what's coming up (each date's gifts
// this time, and what was given before), every gift for them, and their gifts on the Christmas lists — and the
// "Add person" page.
import { esc, toast, money } from '../../../bills-etc/js/util.js';
import { dataTable } from '../../../bills-etc/js/datatable.js';
import { recordTable, closeFilterMenu } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import {
    GIFTS_PATH, saveData, newPerson, giftsPath, giftColumns, loadGifts, saveGifts, loadChristmas, readDate, nextDate,
    milestone, upcomingDates, christmas, comingChristmas, showDay, inDays, statusGroup, tally, isFor, forOccasion,
} from '../gifts.js';

const SOON_DAYS = 30; // a date this close with nothing planned turns the banner red

let table = null;
let info = null; // the information box

export const hasUnsavedEdits = () => !!table?.hasUnsavedEdits() || !!info?.hasUnsavedEdits();
export const forget = () => { table = null; info = null; closeFilterMenu(); };

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const giftName = r => String(r.Gift || '').split('\n')[0].trim() || '(no gift named)';
const badge = r => (r.Status ? `<span class="cat-badge st-${statusGroup(r.Status)}">${esc(r.Status)}</span>` : '');

/** '2 gifts · $180.00 · 1 to buy ($60.00) · 1 idea' */
export function tallyText(t) {
    const parts = [];
    if (t.count) {
        parts.push(`${plural(t.count, 'gift')} · ${money(t.total)}`);
        parts.push(t.todo ? `${t.todo} to buy (${money(t.toBuy)})` : 'all bought');
        if (t.waiting) parts.push(`${t.waiting} on the way`);
    }
    if (t.ideas) parts.push(plural(t.ideas, 'idea'));
    return parts.join(' · ');
}

/** After a field that's a date: when it's next (worked out, not saved). */
const nextItem = f => {
    const dt = readDate(f.value);
    if (!dt) {
        return f.value && /birth|bday|anniv/i.test(f.label)
            ? '<div class="info-item"><dt>Next</dt><dd><span class="muted">Can’t read the date — type it like Nov 25 or Sep 8, 2017</span></dd></div>' : '';
    }
    const n = nextDate(dt);
    const m = milestone(f.label, n.years);
    return `<div class="info-item"><dt>Next ${esc(f.label)}</dt><dd>${esc(showDay(n.date))}<br><span class="muted">${inDays(n.days)}${m ? ` · ${esc(m)}` : ''}</span></dd></div>`;
};

/** Red: the next date is within 30 days and nothing's planned for it; yellow: some still to buy; green otherwise. */
function dateBanner(next, gifts) {
    if (!next) return '';
    const year = next.date.getFullYear();
    const t = tally(forOccasion(gifts, next.label, year));
    const m = milestone(next.label, next.years);
    const when = `${esc(next.label)} ${inDays(next.days)} (${esc(showDay(next.date))}${m ? `, ${esc(m)}` : ''})`;
    if (next.days > SOON_DAYS) return `<div class="banner ok"><strong>Next: ${when}.</strong>${t.count || t.ideas ? ` ${tallyText(t)}.` : ''}</div>`;
    if (!t.count) {
        return `<div class="banner bad"><strong>${when}</strong> — nothing planned yet. Add a gift below with Year ${year} and Occasion “${esc(next.label)}”${
            t.ideas ? ` (there ${t.ideas === 1 ? 'is 1 idea' : `are ${t.ideas} ideas`})` : ''}.</div>`;
    }
    if (t.todo) {
        return `<div class="banner"><strong>${when}:</strong> ${t.todo === t.count ? `${plural(t.count, 'gift')} planned, none bought yet`
            : `${t.todo} of ${t.count} gifts still to buy`}.</div>`;
    }
    return `<div class="banner ok"><strong>${when}:</strong> ${t.count === 1 ? 'the gift is' : `all ${t.count} gifts are`} bought${t.waiting ? ` (${t.waiting} on the way)` : ''}.</div>`;
}

/** One box under Coming up: the occasion, this time's gifts and totals, and what was given the last few times. */
function occasionBox({ title, when, note, rows, before, link }) {
    const t = tally(rows);
    const list = rows.length
        ? `<ul class="occ-gifts">${rows.map(r => `<li><span class="g-name">${esc(giftName(r))}</span>${r.Price ? `<span class="g-price">${esc(money(r.Price))}</span>` : ''}${badge(r)}</li>`).join('')}</ul>`
        : '<p class="muted">Nothing planned yet.</p>';
    const past = before.filter(b => b.rows.length).slice(0, 3);
    return `<div class="place occasion">
        <h3>${esc(title)}</h3>
        <p class="occ-when">${esc(when)}${note ? ` · ${esc(note)}` : ''}</p>
        ${list}
        ${t.count || t.ideas ? `<p class="occ-total">${tallyText(t)}</p>` : ''}
        ${past.length ? `<div class="occ-past"><div class="occ-past-h">Before</div>${past.map(b => {
            const bt = tally(b.rows);
            const names = b.rows.filter(r => statusGroup(r.Status) !== 'idea').map(giftName);
            return `<p><strong>${esc(b.year)}</strong> ${esc(money(bt.total))}${names.length ? ` — ${esc(names.join(', '))}` : ''}</p>`;
        }).join('')}</div>` : ''}
        ${link || ''}
    </div>`;
}

/** data: everything in gifts.json (saved back whole); onListChanged(goTo) re-draws the menu and opens #goTo. */
export async function renderPerson(el, data, p, onListChanged) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    const years = data.christmasYears;
    const [gifts, ...lists] = await Promise.all([loadGifts(p), ...years.map(y => loadChristmas(y, false))]);
    const xmasRows = years.flatMap((y, i) => lists[i].filter(isFor(p.name)).map(r => ({ Year: y, ...r })));
    el.innerHTML = `
        <h1 class="page" id="p-name"></h1>
        <div id="date-banner"></div>
        <p class="lead">Dates and information in <code>${esc(GIFTS_PATH)}</code>, gifts in <code>${esc(giftsPath(p))}</code>.</p>
        <section>
            <h2>Dates &amp; information</h2>
            <div id="info"></div>
        </section>
        <section>
            <h2>Coming up</h2>
            <div id="coming"></div>
        </section>
        <section>
            <h2>Gifts</h2>
            <p class="section-note">Everything given and planned, with ideas for later. Occasion ties a gift to a date above
                (e.g. Birthday) and Year to which time, so it shows under Coming up. Filter Year or Occasion to see one —
                the Total adds up what's shown. Christmas gifts go on the Christmas page.</p>
            <div id="gifts"></div>
        </section>
        <section>
            <h2>On the Christmas lists</h2>
            <div id="xmas"></div>
        </section>`;
    el.querySelector('#p-name').textContent = p.name;

    const drawSummary = rows => {
        const dates = upcomingDates(p);
        el.querySelector('#date-banner').innerHTML = dateBanner(dates[0], rows);
        const xYear = comingChristmas(), xDay = christmas(xYear);
        const boxes = dates.map(d => {
            const year = d.date.getFullYear();
            const before = [...new Set(rows.map(r => String(r.Year).trim()))].filter(y => /^\d{4}$/.test(y) && +y < year)
                .sort().reverse().map(y => ({ year: y, rows: forOccasion(rows, d.label, y) }));
            return occasionBox({
                title: `${d.label} ${year}`, when: `${showDay(d.date)} · ${inDays(d.days)}`, note: milestone(d.label, d.years),
                rows: forOccasion(rows, d.label, year), before,
            });
        });
        const xBefore = years.filter(y => +y < +xYear).sort().reverse().map(y => ({ year: y, rows: xmasRows.filter(r => r.Year === y) }));
        boxes.push(occasionBox({
            title: `Christmas ${xYear}`, when: `${showDay(xDay.date)} · ${inDays(xDay.days)}`,
            rows: xmasRows.filter(r => r.Year === xYear), before: xBefore,
            link: years.includes(xYear) ? `<p><a href="#christmas/${xYear}">Christmas ${xYear} list →</a></p>`
                : `<p><a href="#christmas/add">Add ${xYear} to the Christmas lists →</a></p>`,
        }));
        el.querySelector('#coming').innerHTML = `${dates.length ? '' : `<p class="muted" style="margin-bottom:12px">Add a date
            (e.g. Birthday: Nov 25) under Dates &amp; information to see it here.</p>`}<div class="place-grid">${boxes.join('')}</div>`;
    };
    drawSummary(gifts);

    info = infoBox(el.querySelector('#info'), {
        info: p.info,
        name: p.name,
        noun: 'person',
        extra: nextItem,
        save: async (newInfo, name) => {
            const updated = { ...p, name, info: newInfo };
            await saveData({ ...data, people: data.people.map(x => (x.id === p.id ? updated : x)) });
            Object.assign(p, updated);
            onListChanged(p.id);
        },
        remove: async () => {
            if (!confirm(`Remove “${p.name}” from Gifts?\n\nTheir gifts file (${giftsPath(p)}) is kept in your folder.`)) return;
            try {
                await saveData({ ...data, people: data.people.filter(x => x.id !== p.id) });
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            info = null;
            toast(`Removed “${p.name}”`, 'ok');
            onListChanged(data.people.find(x => x.id !== p.id)?.id || 'christmas');
        },
    });

    table = recordTable(el.querySelector('#gifts'), {
        columns: giftColumns(upcomingDates(p).map(d => d.label)),
        rows: gifts,
        save: async rows => { await saveGifts(p, rows); drawSummary(rows); },
    });

    const xEl = el.querySelector('#xmas');
    if (!xmasRows.length) {
        xEl.innerHTML = `<p class="muted">Gifts for ${esc(p.name)} on the <a href="#christmas">Christmas lists</a> show here (Person “${esc(p.name)}”).</p>`;
        return;
    }
    dataTable(xEl, {
        columns: [
            { id: 'Year', label: 'Year', value: r => r.Year, cell: r => `<a href="#christmas/${esc(r.Year)}">${esc(r.Year)}</a>` },
            { id: 'Gift', label: 'Gift', value: r => r.Gift, tdClass: () => 'text' },
            { id: 'Price', label: 'Price', num: true, value: r => (r.Price === '' ? '' : Number(r.Price)), text: v => money(v) },
            { id: 'Status', label: 'Status', value: r => r.Status, cell: badge },
            { id: 'Notes', label: 'Notes', value: r => r.Notes, tdClass: () => 'text' },
        ],
        rows: [...xmasRows].sort((a, b) => b.Year.localeCompare(a.Year)), // newest year first, each in the list's order
        footer: visible => `<tr class="total-row"><td colspan="2"><strong>Total</strong> <span class="muted">(${visible.length} shown)</span></td>
            <td class="amt"><strong>${esc(money(tally(visible).total))}</strong></td><td colspan="2"></td></tr>`,
    });
    xEl.classList.add('record-table');
}

/** The "＋ Add person" page. */
export function renderNewPerson(el, data, onListChanged) {
    el.innerHTML = `
        <h1 class="page">Add a person</h1>
        <p class="lead">They get their own page: dates (birthday, anniversary…) with what's coming up, information like
            sizes and favorites, and every gift for them.</p>
        <section>
            <form id="new-form" class="new-vehicle">
                <label class="field">Name (shown in the menu)<input type="text" name="name" required></label>
                <label class="field">Birthday (optional, e.g. Nov 25 or Nov 25, 1990)<input type="text" name="birthday"></label>
                <div class="row" style="margin-top:6px"><button class="primary">Add person</button></div>
            </form>
        </section>`;
    el.querySelector('#new-form').onsubmit = async e => {
        e.preventDefault();
        const form = new FormData(e.target);
        const name = String(form.get('name')).trim(), birthday = String(form.get('birthday')).trim();
        if (!name) return;
        if (birthday && !readDate(birthday)) return toast('Can’t read the birthday — type it like Nov 25 or Nov 25, 1990.', 'bad');
        const p = newPerson(data.people, name);
        const field = p.info.find(f => /birth/i.test(f.label));
        if (field) field.value = birthday;
        try {
            await saveData({ ...data, people: [...data.people, p] });
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        toast(`Added “${name}”`, 'ok');
        onListChanged(p.id);
    };
}
