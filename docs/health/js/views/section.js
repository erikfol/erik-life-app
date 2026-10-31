// One Health section (General Health, Dental, Eye, HSA): the shared record table over the section's CSV. General Health,
// Dental and Eye also have a General information box (shared/js/infobox.js, like a pet's) and future appointments with a
// banner like a pet's above it. A section with
// accounts (the HSA: FLORES, WealthCare…) has a box per account instead, like a Loan/CC card: the account's title,
// sign-in hint, website and total balance above its own table of entries.
import { esc, toast, money } from '../../../bills-etc/js/util.js';
import { recordTable, closeFilterMenu, showDate } from '../../../shared/js/recordtable.js';
import { infoBox } from '../../../shared/js/infobox.js';
import { infoLinks, cleanUrl } from '../../../shared/js/infolinks.js';
import { appointmentStatus } from '../../../pets/js/pets.js';
import { staleAccounts, STALE_DAYS, VERY_STALE_DAYS } from '../alerts.js';
import {
    HEALTH_DIR, INFO_PATH, loadRecords, saveRecords, loadLocations, saveLocations, loadAccounts, saveAccounts, newAccount,
    accountSection, appointmentsSection, notesSection, loadInfo, saveInfo, invoicesDir, PAID_CHOICES, owedRecords,
} from '../records.js';

let checks = []; // one "has unsaved edits?" per table and account box on the page

export const hasUnsavedEdits = () => checks.some(f => f());
export const forget = () => { checks = []; closeFilterMenu(); };

const inDays = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** Red while Records have an I Owe amount not marked Paid: the total and each one. */
const owedBanner = rows => {
    const o = owedRecords(rows);
    if (!o.rows.length) return '';
    const each = o.rows.map(r => `${esc(showDate(r.Date) || 'undated')}${r.Description ? ` ${esc(r.Description)}` : ''}: ${esc(money(o.owe(r)))}`);
    return `<div class="banner bad"><strong>You owe ${esc(money(o.total))}</strong> · not paid yet: ${each.join('; ')}. Set Paid? to Paid in Records once it's paid.</div>`;
};

/** Like a pet's (pets/js/views/pet.js): red with no future appointment, yellow when the next is within 2 weeks, else green. */
const appointmentBanner = rows => {
    const s = appointmentStatus(rows);
    if (s.level === 'none') return '<div class="banner bad"><strong>No future appointment.</strong> Add one under Future appointments.</div>';
    const r = s.next;
    const what = `${esc(showDate(r.Date))}${r.Time ? ` at ${esc(r.Time)}` : ''}${r.Description ? ` — ${esc(r.Description)}` : ''}`;
    return s.level === 'soon'
        ? `<div class="banner"><strong>Appointment coming up ${inDays(s.days)}:</strong> ${what}</div>`
        : `<div class="banner ok"><strong>Next appointment ${inDays(s.days)}:</strong> ${what}</div>`;
};

export async function renderSection(el, section) {
    el.innerHTML = '<p class="muted">Loading…</p>';
    if (section.accounts) return renderAccounts(el, section);
    const appts = section.appointments && appointmentsSection(section), notes = section.notes && notesSection(section);
    const [rows, locations, apptRows, allInfo, noteRows] = await Promise.all([loadRecords(section), loadLocations(),
        appts ? loadRecords(appts) : null, section.info ? loadInfo() : null, notes ? loadRecords(notes) : null]);
    // "Information in …, appointments in …, records in … in your folder." (just "Saved in …" with only records)
    const files = [section.info && ['information', INFO_PATH], appts && ['appointments', appts.path], ['records', section.path],
        notes && [notes.label.toLowerCase(), notes.path]].filter(Boolean);
    const where = files.length === 1 ? `Saved in <code>${esc(section.path)}</code>`
        : files.map(([what, path]) => `${what} in <code>${esc(path)}</code>`).join(', ').replace(/^./, c => c.toUpperCase());
    const box = (id, title) => `<section><h2>${title}</h2><div id="${id}"></div></section>`;
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <div id="owed-banner"></div>
        ${appts ? '<div id="appt-banner"></div>' : ''}
        <p class="lead">${where} in your folder.</p>
        ${section.info ? '<section><h2 class="info-head" id="info-head"></h2><div id="info-links"></div><div id="info"></div></section>' : ''}
        ${appts ? box('appointments', 'Future appointments') : ''}
        ${section.info || appts ? box('records', 'Records') : '<section id="records"></section>'}
        ${notes ? box('notes', esc(notes.label)) : ''}`;
    if (section.info) {
        // Re-read the file before each save, so another section's box or link saved since this page loaded stays.
        const changeInfo = async change => {
            const latest = await loadInfo();
            change(latest);
            await saveInfo(latest);
            Object.assign(allInfo, latest);
        };
        const info = infoBox(el.querySelector('#info'), {
            info: allInfo.sections[section.id],
            save: newInfo => changeInfo(d => { d.sections[section.id] = newInfo; }),
        });
        const links = infoLinks(el.querySelector('#info-head'), el.querySelector('#info-links'), allInfo.links[section.id] || [],
            list => changeInfo(d => { if (list.length) d.links[section.id] = list; else delete d.links[section.id]; }));
        checks.push(() => info.hasUnsavedEdits() || links.hasUnsavedEdits());
    }
    if (appts) {
        const drawBanner = r => { el.querySelector('#appt-banner').innerHTML = appointmentBanner(r); };
        drawBanner(apptRows);
        // Where it is: also offers the offices in the Records (a body Location, a choice, isn't one).
        const offices = section.columns.some(c => c.name === 'Location' && c.kind === 'suggest')
            ? [...new Set(rows.map(r => (r.Location || '').trim()).filter(Boolean))] : [];
        // "→ Records": the appointment becomes a record — the columns they share (a Location that's a body location, a
        // choice, is left blank) — at the top of Records, and leaves Future appointments.
        const moveToRecords = async appt => {
            if (hasUnsavedEdits()) return toast('Save or cancel the edits on this page first', 'bad');
            if (!confirm(`Move the ${showDate(appt.Date) || 'undated'} appointment${appt.Description ? ` (${appt.Description})` : ''} to Records?`)) return;
            const skip = section.columns.some(c => c.name === 'Location' && c.kind === 'choice') ? ['Location'] : [];
            const record = Object.fromEntries(section.columns.map(c => [c.name, !skip.includes(c.name) && appt[c.name] != null ? appt[c.name] : '']));
            try {
                await saveRecords(section, [record, ...await loadRecords(section)]);
                const left = await loadRecords(appts);
                const i = left.findIndex(r => appts.columns.every(c => (r[c.name] || '') === (appt[c.name] || '')));
                if (i >= 0) left.splice(i, 1);
                await saveRecords(appts, left);
                toast('Moved to Records: fill in anything left blank with ✎ Edit', 'ok');
                forget();
                renderSection(el, section);
            } catch (err) { toast(`Couldn't move it: ${err.message}`, 'bad'); }
        };
        const apptTable = recordTable(el.querySelector('#appointments'), {
            columns: appts.columns.map(c => (c.name === 'Location' ? { ...c, suggestions: offices } : c)),
            rows: apptRows,
            save: async r => { await saveRecords(appts, r); drawBanner(r); },
            rowActions: [{ label: '→ Records', title: 'Move this appointment down to Records: the columns Records has are filled in from it, the rest is left blank to fill in', run: moveToRecords }],
        });
        checks.push(() => apptTable.hasUnsavedEdits());
    }
    const location = { list: locations, noun: 'location', add: name => saveLocations([...location.list, name]) };
    // A red "You owe" banner while a record has an I Owe amount not marked Paid.
    const drawOwed = r => { el.querySelector('#owed-banner').innerHTML = owedBanner(r); };
    drawOwed(rows);
    const table = recordTable(el.querySelector('#records'), {
        columns: section.columns,
        rows,
        save: async rows => { await saveRecords(section, rows); drawOwed(rows); },
        choices: { Location: location, ...PAID_CHOICES },
        filesDir: invoicesDir(section),
    });
    checks.push(() => table.hasUnsavedEdits());
    if (notes) { // General Health's Personal Notes: its body Location list is the same as the old Records'
        const notesTable = recordTable(el.querySelector('#notes'), {
            columns: notes.columns,
            rows: noteRows,
            save: rows => saveRecords(notes, rows),
            choices: { Location: location },
            filesDir: notes.filesDir,
        });
        checks.push(() => notesTable.hasUnsavedEdits());
    }
}

const pad = n => String(n).padStart(2, '0');
const isoToday = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The yellow / red "Activity not updated" banners (staleAccounts, shared with the Home page); entries: { account id: rows }. */
function staleBanners(list, entries) {
    const stale = staleAccounts(list, entries);
    const item = x => `<div class="row" style="gap:8px;margin-top:4px">
            <span><strong>${esc(x.a.title)}</strong>: ${[
                x.lastEntry ? `last entry ${esc(showDate(x.lastEntry))}` : 'no entries yet',
                x.checked ? `checked ${esc(showDate(x.checked))}` : '',
            ].filter(Boolean).join(', ')}${Number.isFinite(x.days) ? ` <span class="muted">(${x.days} days)</span>` : ''}</span>
            <button type="button" class="small" data-activity-checked="${esc(x.a.id)}" title="You looked at the account and there's nothing new to add. Saves today's date on the account; no entry is added.">✓ Checked – no new activity</button>
        </div>`;
    const banner = (l, level, head) => (l.length ? `<div class="banner updated-${level}"><strong>${head}</strong>${l.map(item).join('')}</div>` : '');
    return banner(stale.filter(x => x.days >= VERY_STALE_DAYS), 'stale', `Activity not updated in ${VERY_STALE_DAYS}+ days`)
        + banner(stale.filter(x => x.days < VERY_STALE_DAYS), 'aging', `Activity not updated in ${STALE_DAYS}+ days`);
}

/** The activity banners, every account's box, then ＋ Add account. */
async function renderAccounts(el, section) {
    const list = await loadAccounts(section);
    const rows = await Promise.all(list.map(a => loadRecords(accountSection(section, a))));
    el.innerHTML = `
        <h1 class="page">${esc(section.label)}</h1>
        <div data-stale></div>
        <p class="lead">Saved in <code>${esc(HEALTH_DIR)}/</code> in your folder: the accounts in <code>${esc(section.accounts.split('/').pop())}</code>,
            and each one's entries in a file of its own (its ✎ Edit says which).</p>
        <div data-accounts></div>
        <div class="row" data-add-row><button type="button" data-add-account>＋ Add account</button></div>`;
    const boxes = el.querySelector('[data-accounts]');
    const addRow = el.querySelector('[data-add-row]');
    const entries = Object.fromEntries(list.map((a, i) => [a.id, rows[i]])); // kept up to date as tables are saved
    const staleEl = el.querySelector('[data-stale]');
    const drawStale = () => { staleEl.innerHTML = staleBanners(list, entries); };
    const ctx = {
        list,
        save: async next => { await saveAccounts(section, next); list.splice(0, list.length, ...next); drawStale(); },
        entriesSaved: (id, r) => { entries[id] = r; drawStale(); },
    };
    staleEl.onclick = async e => {
        const b = e.target.closest('[data-activity-checked]');
        if (!b) return;
        const account = list.find(a => a.id === b.dataset.activityChecked);
        b.disabled = true;
        try {
            await ctx.save(list.map(a => (a.id === account.id ? { ...a, activityChecked: isoToday() } : a)));
            toast(`${account.title}: marked checked today`, 'ok');
        } catch (err) {
            b.disabled = false;
            toast(`Couldn't save it: ${err.message}`, 'bad');
        }
    };
    drawStale();
    const addBox = (account, accountEntries) => {
        entries[account.id] = accountEntries;
        const box = document.createElement('section');
        boxes.appendChild(box);
        accountBox(box, section, account, accountEntries, ctx);
        drawStale();
    };
    list.forEach((a, i) => addBox(a, rows[i]));
    if (!list.length) boxes.innerHTML = '<p class="muted" data-none>No accounts yet. Press ＋ Add account.</p>';

    // Its own name: each account's table has a ＋ Add entry button called data-add, and the first of those comes before this one.
    el.querySelector('[data-add-account]').onclick = () => {
        addRow.hidden = true;
        const box = document.createElement('section');
        boxes.appendChild(box);
        let changed = () => false, gone = false;
        checks.push(() => !gone && changed());
        const close = () => { gone = true; box.remove(); addRow.hidden = false; };
        accountForm(box, {}, {
            heading: 'New account',
            saveLabel: 'Add account',
            onChange: f => { changed = f; },
            onCancel: close,
            onSave: async v => {
                const account = { ...newAccount(section, list, v.title), ...v };
                await ctx.save([...list, account]);
                close();
                boxes.querySelector('[data-none]')?.remove();
                addBox(account, await loadRecords(accountSection(section, account))); // [] unless the file is left from before
                toast(`Added “${account.title}”`, 'ok');
            },
        });
    };
}

/** The "Total balance" card (like Bills Etc → Loan/CC → Credit Cards), over every entry whatever the table's filters. */
const balanceCard = b => `
    <div class="cards kpis balance-cards"><div class="card"><div class="label">Total balance</div>
        <div class="value" style="color:var(${b.balance < 0 ? '--red' : '--green'})">${esc(money(b.balance))}</div>
        <div class="sub cmp"><span class="muted">${esc(money(b.deposits))} deposits − ${esc(money(b.charges))} charges${b.other
            ? `<br>${b.other} entr${b.other === 1 ? 'y' : 'ies'} of another type not counted` : ''}</span></div></div></div>`;

/** One account's box: its header (read-only until ✎ Edit), total balance and table. */
function accountBox(box, section, account, rows, ctx) {
    const sec = accountSection(section, account);
    box.innerHTML = '<div class="acct-box"></div><div data-balance></div><div data-records></div>';
    const head = box.querySelector('.acct-box');
    const showBalance = rows => { box.querySelector('[data-balance]').innerHTML = balanceCard(section.balance(rows)); };
    let changed = () => false, gone = false;
    const show = () => {
        changed = () => false;
        const a = account;
        head.innerHTML = `
            <h2>${esc(a.title)}
                ${a.accountNumber ? `<span class="acct-num" title="Account number">Account: ${esc(a.accountNumber)}</span>` : ''}
                <span class="spacer"></span>
                ${a.url ? `<a class="ext-link" href="${esc(a.url)}" target="_blank" rel="noopener" title="${esc(a.url)}">${esc(a.linkText || 'Website')} ↗</a>` : ''}
                <button type="button" class="small" data-edit>✎ Edit</button></h2>
            ${a.hint ? `<p class="acct-hint">${esc(a.hint)}</p>` : ''}`;
        head.querySelector('[data-edit]').onclick = () => accountForm(head, account, {
            heading: 'Account',
            note: `Its entries are kept in <code>${esc(sec.path)}</code>.`,
            onChange: f => { changed = f; },
            onCancel: show,
            onSave: async v => {
                const { activityChecked } = ctx.list.find(x => x.id === account.id) || account; // set by the activity banner
                const updated = { id: account.id, file: account.file, ...(activityChecked ? { activityChecked } : {}), ...v };
                await ctx.save(ctx.list.map(x => (x.id === account.id ? updated : x)));
                account = updated;
                toast('Saved', 'ok');
                show();
            },
            onRemove: async () => {
                if (table.hasUnsavedEdits()) return toast('Save or cancel the edits to its entries first', 'bad');
                if (!confirm(`Remove “${account.title}” from the HSA?\n\nIts entries file (${sec.path}) is kept in your folder.`)) return;
                await ctx.save(ctx.list.filter(x => x.id !== account.id));
                gone = true;
                box.remove();
                toast(`Removed “${account.title}”`, 'ok');
            },
        });
    };
    show();
    showBalance(rows);
    const table = recordTable(box.querySelector('[data-records]'), {
        columns: section.columns,
        rows,
        filesDir: invoicesDir(section, account),
        save: async rows => { await saveRecords(sec, rows); showBalance(rows); ctx.entriesSaved(account.id, rows); },
    });
    checks.push(() => !gone && (changed() || table.hasUnsavedEdits()));
}

const ACCOUNT_FIELDS = [
    { key: 'title', label: 'Title', placeholder: 'e.g. HealthEquity' },
    { key: 'accountNumber', label: 'Account number', placeholder: 'optional' },
    { key: 'hint', label: 'Hint', placeholder: 'optional: e.g. [UN: …] [PW: …]' },
    { key: 'linkText', label: 'Link text', placeholder: 'e.g. HealthEquity Online' },
    { key: 'url', label: 'Link', placeholder: 'optional: https://…' },
];

/**
 * The account fields in `el` (filled from `values`). onSave gets the fields that aren't blank, the link made a full web
 * address; onRemove (if given) adds a Remove account button; onChange gets a "changed since it opened?" check.
 */
function accountForm(el, values, { heading, note = '', saveLabel = 'Save', onSave, onCancel, onRemove, onChange }) {
    el.innerHTML = `
        <h2>${esc(heading)}</h2>
        <div class="add-grid">${ACCOUNT_FIELDS.map(f => `<label class="field">${f.label}<input type="text" name="${f.key}"
            value="${esc(values[f.key] || '')}" placeholder="${esc(f.placeholder)}"${f.key === 'url' ? ' inputmode="url"' : ''}></label>`).join('')}</div>
        ${note ? `<p class="muted" style="margin-bottom:10px">${note}</p>` : ''}
        <div class="row">${onRemove ? '<button type="button" class="danger" data-remove>Remove account</button>' : ''}
            <span class="spacer"></span>
            <button type="button" data-cancel>Cancel</button>
            <button type="button" class="primary" data-save>${esc(saveLabel)}</button></div>`;
    const read = () => Object.fromEntries(ACCOUNT_FIELDS.map(f => [f.key, el.querySelector(`[name=${f.key}]`).value.trim()]));
    const before = JSON.stringify(read());
    onChange(() => JSON.stringify(read()) !== before);
    el.querySelector('[data-cancel]').onclick = onCancel;
    if (onRemove) el.querySelector('[data-remove]').onclick = () => onRemove().catch(err => toast(`Couldn't save: ${err.message}`, 'bad'));
    el.querySelector('[data-save]').onclick = async () => {
        const v = read();
        if (!v.title) return toast('Give the account a title', 'bad');
        const url = cleanUrl(v.url);
        if (url === null) return toast('The link should be a web address, like https://…', 'bad');
        try {
            await onSave(Object.fromEntries(Object.entries({ ...v, url }).filter(([, x]) => x))); // blank fields left out
        } catch (err) { toast(`Couldn't save: ${err.message}`, 'bad'); }
    };
    el.querySelector('[name=title]').focus();
}
