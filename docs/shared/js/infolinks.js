// Links with sign-in hints on a heading (Health's General information, 401(k)'s Balance history): each shows as a
// "Name ↗" button that opens the site in a new tab; ✎ Links (or ＋ Link) edits the list.
import { esc, toast } from '../../bills-etc/js/util.js';
import { moveButtons, moveItem } from './infobox.js';

/** 'flores247.com' → 'https://flores247.com'; '' stays ''; null if it isn't a web address. */
export function cleanUrl(url) {
    let u = url.trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return /^https?:\/\//i.test(u) ? u : null;
}

export const LINK_FIELDS = [
    { key: 'linkText', label: 'Link text', placeholder: 'e.g. My-DH' },
    { key: 'url', label: 'Link', placeholder: 'https://…' },
    { key: 'hint', label: 'Hint', placeholder: 'optional: e.g. UN: … PW: …' },
];

/**
 * Websites on the right of a heading (`head`, after its `title` html) with their sign-in hints under it in `area`, like a
 * Loan/CC card's (Bills Etc). ✎ Links edits them all in a list like an information box's: change, add, remove, ↑ ↓ to
 * reorder. save(links) writes them ([] = none); example: a link text shown as the hint while editing. Used by Health's
 * General information and 401(k)'s Balance history.
 * Returns { hasUnsavedEdits() }.
 */
export function infoLinks(head, area, links, save, { title = 'General information', example = 'My-DH' } = {}) {
    let draft = null; // { start, read } while editing
    const name = l => esc(l.linkText || 'Website');
    const show = () => {
        draft = null;
        head.innerHTML = `${title}<span class="spacer"></span>
            ${links.map(l => `<a class="ext-link" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url)}">${name(l)} ↗</a>`).join('')}
            <button type="button" class="small" data-links-edit title="${links.length ? 'Change, add, remove or reorder the links and their sign-in hints' : 'Add a website and its sign-in hint'}">${links.length ? '✎ Links' : '＋ Link'}</button>`;
        // With more than one link, each hint says which link it's for.
        const hints = links.filter(l => l.hint).map(l => `<p class="acct-hint">${links.length > 1 ? `<strong>${name(l)}:</strong> ` : ''}${esc(l.hint)}</p>`);
        area.innerHTML = hints.length ? `<div class="info-hints">${hints.join('')}</div>` : '';
        head.querySelector('[data-links-edit]').onclick = edit;
    };

    // Its own button names: the information box below has data-edit, data-add, data-save and data-cancel.
    const edit = () => {
        head.querySelector('[data-links-edit]').hidden = true;
        area.innerHTML = `<div class="links-editor">
            <div class="row table-tools"><span class="muted edit-hint">Editing links — nothing is written until you press Save links. ↑ ↓ move a link.</span></div>
            <div class="table-wrap"><table class="info-edit links-edit">
                <thead><tr><th></th>${LINK_FIELDS.map(f => `<th>${f.label}</th>`).join('')}<th></th></tr></thead>
                <tbody></tbody>
            </table></div>
            <div class="row" style="margin-top:14px">
                <button type="button" data-link-add>＋ Add link</button>
                <span class="spacer"></span>
                <button type="button" data-links-cancel>Cancel</button>
                <button type="button" class="primary" data-links-save>Save links</button>
            </div></div>`;
        const body = area.querySelector('tbody');
        const linkRow = l => `<tr><td class="move">${moveButtons()}</td>${LINK_FIELDS.map(f => `<td><input type="text" data-f="${f.key}"
            value="${esc(l[f.key] || '')}" placeholder="${esc(f.key === 'linkText' ? `e.g. ${example}` : f.placeholder)}" aria-label="${f.label}"${f.key === 'url' ? ' inputmode="url"' : ''}></td>`).join('')}
            <td class="remove"><button type="button" class="danger" data-link-remove title="Remove this link" aria-label="Remove this link">✕</button></td></tr>`;
        const addRow = () => {
            body.insertAdjacentHTML('beforeend', linkRow({}));
            body.lastElementChild.querySelector('input').focus();
        };
        body.innerHTML = links.map(linkRow).join('');
        if (!links.length) addRow(); // ＋ Link: start with an empty one
        const read = () => [...body.rows].map(tr => Object.fromEntries(LINK_FIELDS.map(f => [f.key, tr.querySelector(`[data-f=${f.key}]`).value.trim()])));
        const json = () => JSON.stringify(read());
        draft = { start: json(), read: json };

        body.addEventListener('click', e => {
            if (moveItem(e, 'tr')) return;
            if (e.target.closest('[data-link-remove]')) e.target.closest('tr').remove();
        });
        area.querySelector('[data-link-add]').onclick = addRow;
        area.querySelector('[data-links-cancel]').onclick = () => {
            if (draft.read() !== draft.start && !confirm('Discard your changes to the links?')) return;
            show();
        };
        area.querySelector('[data-links-save]').onclick = async () => {
            const filled = read().filter(l => l.linkText || l.url || l.hint); // empty rows are dropped
            if (filled.some(l => !l.url)) return toast('Every link needs its web address — fill it in or remove the row, then Save links.', 'bad');
            const next = filled.map(l => ({ ...l, url: cleanUrl(l.url) }));
            if (next.some(l => l.url === null)) return toast('A link should be a web address, like https://…', 'bad');
            const saved = next.map(l => Object.fromEntries(Object.entries(l).filter(([, x]) => x))); // blank fields left out
            try {
                await save(saved);
            } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
            links = saved;
            toast('Saved', 'ok');
            show();
        };
    };

    show();
    return { hasUnsavedEdits: () => !!draft && draft.read() !== draft.start };
}
