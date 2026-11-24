// Walks the app: the Home page, then every section and every page, tab and pill reachable from its links (#…). For each
// it keeps the visible text, the menu (with its red / yellow colours), the Home page's counts, any errors, and a
// screenshot. Also tries the "unsaved edits" question in each section with a record table on its first page.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { open, settle, sleep } from './browser.mjs';

export const SECTIONS = ['', 'bills-etc/', '401k/', 'taxes/', 'health/', 'vehicles/', 'house/', 'pets/', 'insurance/',
    'dinner-planner/', 'kid-lunches/', 'gifts/', 'career/'];
const MAX_PER_SECTION = 80;

const SNAPSHOT = `(() => {
    const nav = [...document.querySelectorAll('#nav a, nav.subnav a, nav.pillnav a')].map(a => a.textContent.trim()
        + (a.classList.contains('bad') ? ' [red]' : a.classList.contains('warn') ? ' [yellow]' : '') + (a.classList.contains('active') ? ' *' : '')).join(' | ');
    const counts = [...document.querySelectorAll('.count')].map(c => c.closest('.app')?.getAttribute('href') + ' ' + c.className + ': ' + c.title).join('\\n');
    const main = document.getElementById('view') || document.querySelector('main') || document.body;
    return { hash: location.hash, nav, counts, text: main.innerText };
})()`;
const LINKS = `[...new Set([...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1))]`;

/** Put the data copy into this origin's browser storage. */
export async function seed(browser, base) {
    await browser.send('Page.navigate', { url: base + '__seed.html' });
    for (let i = 0; i < 1200; i++) {
        await sleep(250);
        if ((await browser.evaluate('document.title').catch(() => '')) === 'seeded') return;
    }
    throw new Error('Copying the data into the test browser didn\'t finish');
}

/** Every page: { 'section/#hash': { hash, nav, counts, text, errors, shot: { hash, file } } }. Screenshots go in shotsDir. */
export async function crawl(browser, base, { sections = SECTIONS, shotsDir, log = () => {} }) {
    mkdirSync(shotsDir, { recursive: true });
    let errors = [], shotNo = 0;
    const off = browser.on(m => {
        if (m.method === 'Runtime.exceptionThrown') errors.push(`exception: ${(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]}`);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ').split('\n')[0]}`);
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`log: ${m.params.entry.text.split('\n')[0]} ${m.params.entry.url || ''}`);
        if (m.method === 'Page.javascriptDialogOpening') {
            errors.push(`dialog: ${m.params.message}`);
            browser.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
        }
    });
    const shot = async () => {
        // Wait for pictures (up to 8 s), then take the whole page from the top.
        await browser.evaluate(`Promise.race([new Promise(r => setTimeout(r, 8000)), Promise.all([...document.images].filter(i => !i.complete)
            .map(i => new Promise(r => { i.addEventListener('load', r); i.addEventListener('error', r); })))])`);
        await browser.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
        const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const file = path.join(shotsDir, `${String(++shotNo).padStart(3, '0')}.png`);
        writeFileSync(file, Buffer.from(data, 'base64'));
        return { hash: createHash('sha1').update(data).digest('hex').slice(0, 12), file };
    };

    const out = {};
    for (const section of sections) {
        errors = [];
        await open(browser, base + section);
        const first = await browser.evaluate(SNAPSHOT);
        out[section + first.hash] = { ...first, shot: await shot(), errors };
        if (!section) { log('home: 1 page'); continue; } // the Home page: one page
        const seen = new Set([first.hash]), queue = await browser.evaluate(LINKS);
        while (queue.length && seen.size < MAX_PER_SECTION) {
            const h = queue.shift();
            if (seen.has(h)) continue;
            seen.add(h);
            errors = [];
            await browser.evaluate(`location.hash = ${JSON.stringify(h)}`);
            await settle(browser);
            const snap = await browser.evaluate(SNAPSHOT);
            seen.add(snap.hash);
            out[section + h] = { ...snap, shot: await shot(), errors };
            for (const l of await browser.evaluate(LINKS)) if (!seen.has(l) && !queue.includes(l)) queue.push(l);
        }
        log(`${section.replace(/\/$/, '')}: ${seen.size} pages`);
    }
    off();
    return out;
}

/**
 * The "unsaved edits" question: in each section, start editing its first record table (adding an entry if it's
 * empty), change a cell, go to another page and answer Cancel (it should stay), then go again and answer OK (it
 * should leave). Nothing is saved. Returns { section: 'one line' }.
 */
export async function editPrompts(browser, base, sections = SECTIONS.filter(s => s && s !== 'bills-etc/' && s !== 'dinner-planner/' && s !== 'kid-lunches/')) {
    let answer = true, asked = [];
    const off = browser.on(m => {
        if (m.method !== 'Page.javascriptDialogOpening') return;
        asked.push(m.params.message);
        browser.send('Page.handleJavaScriptDialog', { accept: answer }).catch(() => {});
    });
    const out = {};
    for (const section of sections) {
        await open(browser, base + section);
        const state = await browser.evaluate(`(() => {
            const b = document.querySelector('#view [data-tools] [data-edit]');
            if (!b) return 'no record table on the first page';
            const box = b.closest('[data-tools]').parentElement;
            b.click();
            let inp = box.querySelector('table.editing [data-k]');
            if (!inp) { box.querySelector('[data-add]').click(); inp = box.querySelector('table.editing [data-k]'); }
            if (!inp) return 'no cell to change';
            inp.value += ' x';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            return 'editing';
        })()`);
        if (state !== 'editing') { out[section] = state; continue; }
        const start = await browser.evaluate('location.hash');
        const other = await browser.evaluate(`[...document.querySelectorAll('#nav a, nav.subnav a, nav.pillnav a')].map(a => a.getAttribute('href')).find(h => h && h.startsWith('#') && h !== location.hash)`);
        asked = []; answer = false;
        await browser.evaluate(`location.hash = ${JSON.stringify(other)}`);
        await sleep(800);
        const stayed = (await browser.evaluate('location.hash')) === start && await browser.evaluate(`!!document.querySelector('#view table.editing [data-k]')`);
        const askedFirst = asked.length;
        asked = []; answer = true;
        await browser.evaluate(`location.hash = ${JSON.stringify(other)}`);
        await sleep(1200);
        const left = (await browser.evaluate('location.hash')) !== start;
        out[section] = askedFirst && stayed && asked.length && left ? 'asks; Cancel keeps the edits; OK leaves'
            : `asked ${askedFirst ? 'yes' : 'no'}, Cancel kept the edits ${stayed ? 'yes' : 'no'}, asked again ${asked.length ? 'yes' : 'no'}, OK left ${left ? 'yes' : 'no'}`;
    }
    off();
    return out;
}
