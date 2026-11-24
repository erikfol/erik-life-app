import * as fs from '../../../shared/js/fs.js';
import { PATHS, loadConfig, DEFAULT_CONFIG } from '../data.js';
import { getCategories } from '../rules.js';
import { categoryUsage, addCategory, renameCategory, removeCategory, validateName, LOCKED } from '../categories.js';
import { esc, toast } from '../../../shared/js/util.js';
import { requireFolder } from '../app.js';
import { closeFilterMenu } from '../../../shared/js/datatable.js';
import { hasBills } from '../bills.js';
import { renderMerchants, merchantsCanLeave } from './merchantrules.js';

const TABS = [
    { id: 'categories', label: 'Categories' },
    { id: 'merchants', label: 'Merchants' },
];

export default {
    async render(el) {
        if (!requireFolder(el)) return;
        const tab = TABS.find(t => t.id === location.hash.split('/')[1]) || TABS[0];
        el.innerHTML = `
            <h1 class="page">Config</h1>
            <nav class="subnav">${TABS.map(t => `<a href="#config/${t.id}"${t === tab ? ' class="active"' : ''}>${esc(t.label)}</a>`).join('')}</nav>
            <div id="tab"></div>`;
        const body = el.querySelector('#tab');
        if (tab.id === 'merchants') return renderMerchants(body, () => this.render(el));
        return this.categories(body, el);
    },

    /** Variable categories (config.json `variable_categories`): the ones This Month projects to the end of the month. Saved on each tick. */
    async variable(box) {
        let cfg, error = null;
        try { cfg = await loadConfig(); } catch (e) { error = e.message; }
        if (error) {
            box.innerHTML = `<h2>Variable Categories</h2><div class="banner red">config.json isn't valid JSON (${esc(error)}). Fix it in a text editor, or delete it to start fresh here.</div>`;
            return;
        }
        const base = cfg || DEFAULT_CONFIG;
        const vars = new Set((base.variable_categories || []).filter(c => typeof c === 'string' && !c.startsWith('_')));
        const choices = [...getCategories().filter(c => c !== 'Income'), ...[...vars].filter(c => !getCategories().includes(c))];
        box.innerHTML = `
            <h2>Variable Categories <span class="sub">day-scaled to project the full month · saved as you tick</span></h2>
            ${cfg ? '' : '<div class="banner">No <code>config.json</code> yet. Tick your variable categories and it is created.</div>'}
            <div class="check-grid">${choices.map(c => `<label class="check"><input type="checkbox" value="${esc(c)}"${vars.has(c) ? ' checked' : ''}> ${esc(c)}</label>`).join('')}</div>
            <p class="note">This Month projects these to the end of the month from your pace so far and your average. ${hasBills(base) ? 'Scheduled bills are left out of this and added on top.' : 'Fixed expenses are added on top.'}</p>`;
        box.querySelector('.check-grid').addEventListener('change', async () => {
            const picked = [...box.querySelectorAll('.check-grid input:checked')].map(i => i.value);
            try {
                const now = (await loadConfig()) || structuredClone(DEFAULT_CONFIG);
                now.variable_categories = [...(now.variable_categories || []).filter(c => typeof c === 'string' && c.startsWith('_')), ...picked];
                await fs.writeText(PATHS.config, JSON.stringify(now, null, 2) + '\n');
                toast('Saved variable categories', 'ok');
            } catch (e) {
                toast(`Save failed: ${e.message}`, 'bad');
            }
        });
    },

    async categories(el, page) {
        el.innerHTML = `
            <section id="vars"><p class="muted">Loading…</p></section>
            <section id="cats">
                <h2>Categories <span class="sub">add, rename or merge; changes apply right away</span></h2>
                <div id="cat-list"><p class="muted">Counting…</p></div>
                <div class="row" style="margin-top:12px">
                    <input type="text" id="new-cat" placeholder="New category name" style="width:220px">
                    <button id="add-cat">+ Add category</button>
                </div>
                <p class="note">Renaming updates every transaction in your history and current month. Renaming into an existing category merges the two.
                Your merchant rules follow your renames. ${esc(LOCKED)} can't be renamed because the cash-flow totals depend on it.</p>
            </section>`;
        const drawCats = async () => {
            const usage = await categoryUsage();
            const cats = getCategories();
            const unknown = Object.keys(usage).filter(c => !cats.includes(c)).sort();
            const row = (c, known) => `
                <tr data-cat="${esc(c)}">
                    <td class="cat-name">${esc(c)}${known ? '' : ' <span class="badge badge-warn" title="Used by transactions but not in your category list">not in list</span>'}</td>
                    <td class="amt">${(usage[c] || 0).toLocaleString()}</td>
                    <td style="text-align:right;white-space:nowrap">
                        ${known ? '' : '<button class="small" data-act="adopt">Add to list</button>'}
                        ${c === LOCKED ? '<span class="muted" style="font-size:0.85em">locked</span>' : '<button class="small" data-act="rename">Rename</button>'}
                        ${known && c !== LOCKED && !usage[c] ? '<button class="small danger" data-act="remove">Remove</button>' : ''}
                    </td>
                </tr>`;
            el.querySelector('#cat-list').innerHTML = `<div class="table-wrap"><table class="summary-table">
                <thead><tr><th>Category</th><th class="num">Transactions</th><th></th></tr></thead>
                <tbody>${cats.map(c => row(c, true)).join('')}${unknown.map(c => row(c, false)).join('')}</tbody></table></div>`;
        };
        const catList = el.querySelector('#cat-list');
        catList.addEventListener('click', async e => {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const tr = btn.closest('tr'), name = tr.dataset.cat;
            try {
                if (btn.dataset.act === 'rename') {
                    tr.querySelector('.cat-name').innerHTML = `<input type="text" class="rename-to" value="${esc(name)}" style="width:200px">`;
                    tr.lastElementChild.innerHTML = '<button class="small primary" data-act="do-rename">Save</button> <button class="small" data-act="cancel">Cancel</button>';
                    const input = tr.querySelector('.rename-to');
                    input.focus(); input.select();
                    input.onkeydown = ev => {
                        if (ev.key === 'Enter') tr.querySelector('[data-act="do-rename"]').click();
                        if (ev.key === 'Escape') drawCats();
                    };
                } else if (btn.dataset.act === 'cancel') {
                    drawCats();
                } else if (btn.dataset.act === 'do-rename') {
                    const to = tr.querySelector('.rename-to').value.trim();
                    if (!to || to === name) return drawCats();
                    const merge = getCategories().find(c => c.toLowerCase() === to.toLowerCase() && c !== name);
                    if (merge && !confirm(`“${merge}” already exists. Merge “${name}” into “${merge}”? All its transactions move to “${merge}”.`)) return;
                    btn.disabled = true;
                    const n = await renameCategory(name, to);
                    toast(`${merge ? 'Merged' : 'Renamed'} “${name}” → “${merge || to}” (${n} transaction${n === 1 ? '' : 's'} updated)`, 'ok');
                    this.render(page);
                } else if (btn.dataset.act === 'remove') {
                    await removeCategory(name);
                    toast(`Removed “${name}”`, 'ok');
                    this.render(page);
                } else if (btn.dataset.act === 'adopt') {
                    await addCategory(name);
                    toast(`Added “${name}” to your categories`, 'ok');
                    this.render(page);
                }
            } catch (err) {
                toast(err.message, 'bad');
            }
        });
        el.querySelector('#add-cat').onclick = async () => {
            const input = el.querySelector('#new-cat');
            const err = validateName(input.value, getCategories());
            if (err) return toast(err, 'bad');
            try {
                await addCategory(input.value);
                toast(`Added “${input.value.trim()}”`, 'ok');
                this.render(page);
            } catch (e) { toast(e.message, 'bad'); }
        };
        el.querySelector('#new-cat').onkeydown = e => { if (e.key === 'Enter') el.querySelector('#add-cat').click(); };
        this.variable(el.querySelector('#vars'));
        drawCats();
    },

    destroy() {
        closeFilterMenu();
    },

    canLeave(unloading) {
        return merchantsCanLeave(unloading);
    },
};
