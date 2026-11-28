// The before-and-after check: loads every page of the app as it was (a git commit, HEAD by default) and as it is now
// (this folder, uncommitted changes included), on a copy of your data, and reports what's different. See README.md.
//
//   node tools/check/run.mjs [--base main] [--only home,bills-etc,house] [--data <data folder>] [--keep] [--no-edits]
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { serve } from './server.mjs';
import { SECTIONS, seed, crawl, editPrompts } from './crawl.mjs';
import { diff } from './png.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_ITEMS = ['config.json', 'inputs', 'output_master_data', 'backups.json'];
const say = text => process.stderr.write(text + '\n');

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const base = opt('--base') || 'HEAD';
const keep = args.includes('--keep'), withEdits = !args.includes('--no-edits');
const sections = opt('--only') ? opt('--only').split(',').map(s => (s === 'home' ? '' : s.replace(/\/?$/, '/'))) : SECTIONS;

/** The data folder: --data, else where this repo's inputs/ link points (or the main checkout's, from a worktree). */
function dataFolder() {
    if (opt('--data')) return path.resolve(opt('--data'));
    const mainRepo = path.dirname(path.resolve(REPO, execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim()));
    for (const root of [REPO, mainRepo]) {
        const inputs = path.join(root, 'inputs');
        if (existsSync(inputs)) return path.dirname(realpathSync(inputs));
    }
    throw new Error('Couldn\'t find your data folder. Pass it with --data <folder> (the one with inputs/ and config.json).');
}

/** Times of day ("8:40 AM") change between runs, so they don't count as a difference. */
const steady = s => String(s ?? '').replace(/\b\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)\b/g, 'h:mm');

async function side(name, docs, data, tmp) {
    say(`── ${name}: ${docs}`);
    const server = await serve(docs, data);
    const browser = await launch(path.join(tmp, `profile-${name}`));
    try {
        const url = `http://127.0.0.1:${server.port}/`;
        await seed(browser, url);
        const pages = await crawl(browser, url, { sections, shotsDir: path.join(tmp, `shots-${name}`), log: t => say(`   ${t}`) });
        const edits = withEdits ? await editPrompts(browser, url, sections.filter(s => !['', 'bills-etc/', 'dinner-planner/', 'kid-lunches/'].includes(s))) : {};
        return { pages, edits };
    } finally {
        await browser.close();
        await server.close();
    }
}

function report(before, after) {
    const keys = [...new Set([...Object.keys(before.pages), ...Object.keys(after.pages)])].sort();
    const changed = [], looks = [], onlyOne = [], newErrors = [];
    for (const k of keys) {
        const a = before.pages[k], b = after.pages[k];
        if (!a || !b) { onlyOne.push(`${k} (only ${a ? 'before' : 'now'})`); continue; }
        const lines = [];
        for (const f of ['hash', 'nav', 'counts']) if (steady(a[f]) !== steady(b[f])) lines.push(`    ${f}: ${a[f] || '—'}\n      → ${b[f] || '—'}`);
        if (steady(a.text) !== steady(b.text)) {
            const la = steady(a.text).split('\n'), lb = steady(b.text).split('\n'), sa = new Set(la), sb = new Set(lb);
            const gone = la.filter(l => !sb.has(l)), added = lb.filter(l => !sa.has(l));
            lines.push(`    text: ${gone.length} line(s) gone, ${added.length} new`, ...gone.slice(0, 6).map(l => `      - ${l.slice(0, 160)}`),
                ...added.slice(0, 6).map(l => `      + ${l.slice(0, 160)}`));
        }
        if (lines.length) changed.push(`  ${k}\n${lines.join('\n')}`);
        else if (a.shot.hash !== b.shot.hash) {
            const d = diff(a.shot.file, b.shot.file);
            looks.push(`  ${k}: ${d.size ? `page size ${d.size}` : `${d.pixels} pixels, x ${d.box[0]}–${d.box[2]}, y ${d.box[1]}–${d.box[3]}, strongest ${d.strongest}/255`}`);
        }
        const fresh = b.errors.filter(e => !a.errors.includes(e));
        if (fresh.length) newErrors.push(`  ${k}: ${fresh.slice(0, 3).join(' | ').slice(0, 300)}`);
    }
    const edits = Object.keys({ ...before.edits, ...after.edits }).map(s => (before.edits[s] === after.edits[s]
        ? `  ${s.padEnd(12)} ${after.edits[s]}` : `  ${s.padEnd(12)} CHANGED: ${before.edits[s]} → ${after.edits[s]}`));
    const same = keys.length - changed.length - looks.length - onlyOne.length;
    const out = [
        `${keys.length} pages: ${same} the same, ${changed.length} with different text, ${looks.length} that only look different, ${onlyOne.length} on one side only.`,
        ...(changed.length ? ['', 'Different text, menu or counts:', ...changed] : []),
        ...(onlyOne.length ? ['', 'On one side only:', ...onlyOne.map(x => `  ${x}`)] : []),
        ...(newErrors.length ? ['', 'New errors:', ...newErrors] : []),
        ...(looks.length ? ['', 'Same text, different pixels (look at the screenshots; charts and colour fades can differ by timing):', ...looks] : []),
        ...(edits.length ? ['', 'Unsaved-edits question:', ...edits] : []),
    ];
    const failed = changed.length || onlyOne.length || newErrors.length || edits.some(l => l.includes('CHANGED'));
    return { text: out.join('\n'), failed };
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'life-app-check-'));
const beforeDir = path.join(tmp, 'before');
let worktree = false;
try {
    const source = dataFolder();
    say(`Copying the data from ${source} (the copy is deleted afterwards${keep ? ', unless --keep' : ''})`);
    for (const item of DATA_ITEMS) if (existsSync(path.join(source, item))) cpSync(path.join(source, item), path.join(tmp, 'data', item), { recursive: true });
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', beforeDir, base], { cwd: REPO, stdio: 'inherit' });
    worktree = true;
    const before = await side(`before (${base})`.replace(/[^\w()-]+/g, '-'), path.join(beforeDir, 'docs'), path.join(tmp, 'data'), tmp);
    const after = await side('now', path.join(REPO, 'docs'), path.join(tmp, 'data'), tmp);
    const { text, failed } = report(before, after);
    console.log(`\nBefore: ${base} · Now: this folder\n${text}`);
    if (keep) {
        writeFileSync(path.join(tmp, 'results.json'), JSON.stringify({ before, after }, null, 1));
        console.log(`\nKept in ${tmp} (screenshots, results.json, the data copy). Delete it when done: it holds your data.`);
    }
    process.exitCode = failed ? 1 : 0;
} catch (e) {
    console.error(e.message);
    process.exitCode = 2;
} finally {
    if (worktree) execFileSync('git', ['worktree', 'remove', '--force', beforeDir], { cwd: REPO });
    if (!keep) rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
