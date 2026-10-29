// Setup's "Things to update": everything due, or flagged yellow/red, on Savings, This Month, Utilities and Loan/CC in one
// list. The list comes from ../alerts.js, whose checks follow the same rules as the banners on the pages (the Home page
// counts the same list).
import { updateAccount } from '../loans.js';
import { dueItems } from '../alerts.js';
import { esc, toast } from '../util.js';
import { today } from './utilcommon.js';

/** Fill el with the list. A source that can't be read shows as its own line instead of hiding the rest. */
export default async function renderUpdates(el) {
    el.innerHTML = '<p class="muted">Checking what\'s due…</p>';
    const items = await dueItems(today());
    if (!items.length) {
        el.innerHTML = '<div class="banner ok">✓ <strong>Nothing to update.</strong> Savings, This Month, utilities, loans and credit cards are all caught up.</div>';
        return;
    }
    const red = items.filter(x => x.level === 'stale').length;
    el.innerHTML = `<p class="muted" style="margin-bottom:10px">${items.length} thing${items.length === 1 ? '' : 's'} to look at${red ? `, ${red} overdue` : ''}.</p>
        <div class="due-list">${items.map(x => `<div class="banner updated-${x.level} row">
            <span><span class="due-where">${esc(x.where)}</span> ${x.text}</span>
            <span class="spacer"></span>
            ${x.checkId ? `<button type="button" class="small" data-activity-checked="${esc(x.checkId)}" title="You looked at the statement and there's nothing new to add. Saves today's date on the card; no activity row is added.">✓ Checked – no new activity</button>` : ''}
            ${x.href ? `<a class="ext-link" href="${x.href}">Open →</a>` : ''}
        </div>`).join('')}</div>`;
    el.querySelectorAll('[data-activity-checked]').forEach(b => b.onclick = async () => {
        b.disabled = true;
        try {
            await updateAccount(b.dataset.activityChecked, { activityChecked: today() });
            toast('Marked checked today', 'ok');
            renderUpdates(el);
        } catch (err) {
            b.disabled = false;
            toast(`Couldn't save it: ${err.message}`, 'bad');
        }
    });
}
