// Taxes' red and yellow banners, for the Home page's counts and the menu colours: where this season's return stands
// (seasonStatus: not filed by February yellow, April red, past due red; a refund not in 21 days after filing yellow).
import { loadReturns, seasonStatus } from './taxes.js';

/** [{ level: 'red' | 'yellow', text, href }] */
export default async function alerts() {
    const s = seasonStatus(await loadReturns(false));
    return s.level === 'red' || s.level === 'yellow' ? [{ level: s.level, text: s.text, href: '#overview' }] : [];
}
