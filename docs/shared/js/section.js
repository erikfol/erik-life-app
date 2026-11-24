// The start-up the Home sections share (Pets, Insurance, Health, Vehicles, House, Gifts, Taxes, 401(k), Working
// Career): reconnect the remembered folder, draw the page for the address (#…) and again whenever it changes, ask
// before leaving a page with unsaved edits, show "Connect your folder" while there's none, colour the menu from the
// section's alerts, and show what went wrong if a page fails to draw. Each section's js/app.js says only what's its own.
import * as fs from './fs.js';
import { esc } from './util.js';
import { refreshStatus, askForFolder } from './folder.js';
import { colourMenus } from './navcolors.js';

/**
 * Start the section. Options:
 *   what, where      for "Connect your folder": what's kept, and where ('Pet records', 'inputs/pets/')
 *   alerts           the section's alerts() (its js/alerts.js): menu links turn red or yellow with its banners (navcolors.js)
 *   hasUnsavedEdits  () => true while a page has edits not saved: leaving it asks first
 *   leaveWarning     () => true when closing the tab should warn (default: hasUnsavedEdits)
 *   forget           () => drop the pages' unsaved state before another page is drawn
 *   noFolder         (hash, page) => what to do while no folder is connected (e.g. empty the menu), before it's asked for
 *   draw             async (hash, page) => draw the page for location.hash into #view. Call page.show('#…') with the
 *                    address of the page it settled on (the address bar is corrected to it, and leaving it asks about
 *                    unsaved edits); page.go('id') opens another page after a change (an entry added or renamed)
 *                    without asking.
 */
export function startSection({ what, where, alerts, hasUnsavedEdits = () => false, leaveWarning = hasUnsavedEdits,
    forget = () => {}, noFolder = () => {}, draw }) {
    const viewEl = document.getElementById('view');
    const menus = alerts ? colourMenus(alerts) : null; // menu links (and tabs / pills) turn red or yellow with the banners
    let currentHash = null;

    const page = {
        show(hash) {
            currentHash = hash;
            if (location.hash !== hash) history.replaceState(null, '', hash);
        },
        go(id) {
            if (location.hash === '#' + id) route(true);
            else { currentHash = '#' + id; location.hash = id; } // hashchange draws it; nothing unsaved to ask about
        },
    };

    async function route(force = false) {
        const hash = location.hash;
        if (!force && hash !== currentHash && hasUnsavedEdits()) {
            if (!confirm('You have unsaved edits. Leave without saving?')) {
                history.replaceState(null, '', currentHash);
                return;
            }
        }
        forget();
        if (!fs.folder()) {
            noFolder(hash, page);
            return askForFolder(viewEl, { what, where, onConnected: () => route(true) });
        }
        menus?.ready();
        try {
            await draw(hash, page);
        } catch (e) {
            console.error(e);
            viewEl.innerHTML = `<div class="banner bad"><strong>Something went wrong:</strong> ${esc(e.message)}</div>`;
        }
    }

    window.addEventListener('hashchange', () => route());
    window.addEventListener('beforeunload', e => {
        if (leaveWarning()) { e.preventDefault(); e.returnValue = ''; }
    });
    (async () => {
        if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
        refreshStatus();
        route();
    })();
}

/** Mark the menu link for `hash` as the page you're on. */
export const markActive = hash =>
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
