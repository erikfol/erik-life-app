// 401(k)'s red and yellow banners, for the Home page's counts, the menu colours and the Overview's banner: no balance
// yet (yellow), or none in 45 days (yellow) or 100 days (red).
import { loadBalances, ledger, daysSinceUpdate, STALE_DAYS, VERY_STALE_DAYS } from './401k.js';

/** The banner's level and text for these entries (ledger()): { level: 'red' | 'yellow' | null, text, days }. */
export function balanceStatus(pts, now = new Date()) {
    const days = daysSinceUpdate(pts, now);
    if (days === null) return { level: 'yellow', text: 'No balance yet: add one from your latest statement', days };
    if (days >= VERY_STALE_DAYS) return { level: 'red', text: `Balance not updated in ${VERY_STALE_DAYS}+ days (${days} days)`, days };
    if (days >= STALE_DAYS) return { level: 'yellow', text: `Balance not updated in ${STALE_DAYS}+ days (${days} days)`, days };
    return { level: null, text: '', days };
}

/** [{ level: 'red' | 'yellow', text, href }] */
export default async function alerts() {
    const s = balanceStatus(ledger(await loadBalances(false)));
    return s.level ? [{ level: s.level, text: s.text, href: '#overview' }] : [];
}
