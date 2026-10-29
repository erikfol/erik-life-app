// Health's red and yellow banners, for the Home page's counts and the menu colours. General Health, Dental and Eye:
// no future appointment (red) or one in the next two weeks (yellow), as their appointment banner. The HSA: an account
// whose activity isn't updated in STALE_DAYS (yellow) or VERY_STALE_DAYS (red), as its "Activity not updated" banners
// (views/section.js draws them from staleAccounts here).
import { SECTIONS, loadRecords, loadAccounts, appointmentsSection, accountSection } from './records.js';
import { appointmentStatus } from '../../pets/js/pets.js';

// Like Bills Etc → Loan/CC → Credit Cards: an account whose newest entry, or the last time it was marked checked, is
// STALE_DAYS or more ago gets a yellow banner (red from VERY_STALE_DAYS), so you know to look at its activity.
export const STALE_DAYS = 20, VERY_STALE_DAYS = 40;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const daysSince = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    const t = new Date();
    return Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(y, m - 1, d)) / 86400000);
};

/** Accounts to look at, longest first: [{ a, lastEntry, checked, days }]; entries: { account id: rows }. */
export function staleAccounts(list, entries) {
    return list.map(a => {
        const lastEntry = (entries[a.id] || []).map(r => r.Date).filter(d => ISO.test(d || '')).sort().at(-1) || null;
        const checked = ISO.test(a.activityChecked || '') ? a.activityChecked : null;
        const last = [lastEntry, checked].filter(Boolean).sort().at(-1);
        return { a, lastEntry, checked, days: last ? daysSince(last) : Infinity };
    }).filter(x => x.days >= STALE_DAYS).sort((x, y) => y.days - x.days);
}

const inDays = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** [{ level: 'red' | 'yellow', text, href }] (href: the section's page) */
export default async function alerts() {
    const lists = await Promise.all(SECTIONS.map(async s => {
        const out = [];
        if (s.appointments) {
            const st = appointmentStatus(await loadRecords(appointmentsSection(s), false));
            if (st.level === 'none') out.push({ level: 'red', text: `${s.label}: no future appointment`, href: `#${s.id}` });
            else if (st.level === 'soon') out.push({ level: 'yellow', text: `${s.label}: appointment ${inDays(st.days)}`, href: `#${s.id}` });
        }
        if (s.accounts) {
            const list = await loadAccounts(s, false);
            const rows = await Promise.all(list.map(a => loadRecords(accountSection(s, a), false)));
            const entries = Object.fromEntries(list.map((a, i) => [a.id, rows[i]]));
            for (const x of staleAccounts(list, entries)) {
                out.push({ level: x.days >= VERY_STALE_DAYS ? 'red' : 'yellow',
                    text: `${s.label}, ${x.a.title}: activity not updated${Number.isFinite(x.days) ? ` in ${x.days} days` : ' (no entries yet)'}`, href: `#${s.id}` });
            }
        }
        return out;
    }));
    return lists.flat();
}
