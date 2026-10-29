// Menu colours, like Pets' names: a link in a section's menu, or in a page's tabs or pills, is red or yellow while that
// part of the section has a red or yellow banner (point at it to see what). The items come from the section's
// alerts.js — the same ones the Home page counts — each with the link (href) of the page it's on.
import * as fs from '../../bills-etc/js/fs.js';

/**
 * Colour the menus from `load` (the section's alerts(): [{ level: 'red' | 'yellow', text, href }]). Call ready() from
 * the section's route once a folder is connected: it counts the first time; after that the colours follow every save
 * (fs.writeText's 'file-written'), and menus drawn later are coloured as they appear.
 */
export function colourMenus(load) {
    let items = [], counted = false, timer = null, frame = 0;

    const paint = () => {
        frame = 0;
        for (const nav of document.querySelectorAll('#nav, nav.subnav, nav.pillnav')) {
            const links = [...nav.querySelectorAll('a[href^="#"]')];
            const hrefs = links.map(a => a.getAttribute('href'));
            for (const a of links) {
                const h = a.getAttribute('href');
                // A link covers the pages under it (#utilities → #utilities/water), unless one of those has its own
                // link in the same menu (a house's Overview tab, a tab's first pill): then only its own page.
                const under = !hrefs.some(x => x.startsWith(h + '/'));
                const mine = items.filter(x => x.href && (x.href === h || (under && x.href.startsWith(h + '/'))));
                const level = mine.some(x => x.level === 'red') ? 'red' : mine.some(x => x.level === 'yellow') ? 'yellow' : null;
                a.classList.toggle('bad', level === 'red');
                a.classList.toggle('warn', level === 'yellow');
                if (!('plainTitle' in a.dataset)) a.dataset.plainTitle = a.title;
                a.title = level ? mine.map(x => `• ${x.text}`).join('\n') : a.dataset.plainTitle;
            }
        }
    };
    const schedulePaint = () => { if (!frame) frame = requestAnimationFrame(paint); };

    const recount = async () => {
        if (!fs.folder()) return;
        counted = true;
        try { items = await load(); } catch (e) { console.error('Menu colours:', e); return; }
        paint();
    };

    window.addEventListener('file-written', () => { clearTimeout(timer); timer = setTimeout(recount, 800); });
    new MutationObserver(schedulePaint).observe(document.body, { childList: true, subtree: true });
    return { ready: () => (counted ? schedulePaint() : recount()) };
}
