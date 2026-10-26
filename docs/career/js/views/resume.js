// Resume Builder: paste a job posting and it picks the parts of your career that match it — skills the posting names,
// the bullet points (Work History → Accomplishments) that share its keywords, matching certifications and achievements —
// and lays them out as a resume you can adjust (every part has a checkbox), print / save as PDF, copy as text, and save
// with the posting it was made for. No AI and nothing sent anywhere: see js/match.js for how matching works.
import { esc, toast } from '../../../bills-etc/js/util.js';
import { loadAll, loadResumes, saveResumes, RESUMES_PATH } from '../career.js';
import { readPosting, score, mentions, words, stem, stemsIn } from '../match.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BULLETS_PER_JOB = 5; // the most matching bullets picked for each position
const LEVELS = ['expert', 'advanced', 'intermediate', 'beginner'];

// Kept while the page is closed, so going to Work History to add something and coming back keeps the draft.
const draft = { position: '', company: '', posting: '', summary: null, picks: null, dirty: false };
let el = null;
let career = null; // loadAll(): profile, work, skills, education, certifications, achievements
let items = null; // the career as pickable items (see buildItems)
let match = null; // { posting, text } once there's a posting
let resumes = [];

/** True while there's a resume in progress that hasn't been saved (the page warns before the tab is closed). */
export const hasDraft = () => draft.dirty && !!draft.posting.trim();

const field = (info, re) => (info.find(f => re.test(f.label))?.value || '').trim();
const monthYear = v => { const m = /^(\d{4})-(\d{2})/.exec(v || ''); return m ? `${MON[+m[2] - 1]} ${m[1]}` : String(v || ''); };
const year = v => (/^(\d{4})/.exec(v || '') || [])[1] || String(v || '');
const lines = t => String(t || '').split('\n').map(s => s.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);
const commaList = t => String(t || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean);

/** The career as items with keys (picks are kept by key), in the order a resume lists them. */
function buildItems(c) {
    const jobs = [...c.work].sort((a, b) => (b.Start || '').localeCompare(a.Start || '')).map(r => {
        const key = `${r.Start}|${r.Company}|${r.Title}`;
        return { key, row: r, bullets: lines(r.Accomplishments).map(text => ({ key: `${key}|${text}`, text })) };
    });
    // Skills: the Skills table, then any "Skills Used" in Work History that isn't in it.
    const skills = c.skills.filter(r => r.Skill.trim()).map(r => ({ key: r.Skill.trim().toLowerCase(), name: r.Skill.trim(), row: r }));
    for (const r of c.work) {
        for (const name of commaList(r['Skills Used'])) {
            if (!skills.some(s => s.key === name.toLowerCase())) skills.push({ key: name.toLowerCase(), name, row: null });
        }
    }
    const byLevel = s => { const i = LEVELS.indexOf((s.row?.Level || '').toLowerCase()); return i < 0 ? LEVELS.length : i; };
    skills.sort((a, b) => byLevel(a) - byLevel(b));
    return {
        jobs,
        skills,
        education: [...c.education].sort((a, b) => (b.End || b.Start || '9').localeCompare(a.End || a.Start || '9'))
            .map(r => ({ key: `${r.School}|${r.Degree}|${r['Field of Study']}`, row: r })),
        certifications: [...c.certifications].sort((a, b) => (b['Date Earned'] || '').localeCompare(a['Date Earned'] || ''))
            .map(r => ({ key: `${r.Name}|${r.Issuer}`, row: r })),
        achievements: [...c.achievements].sort((a, b) => (b.Date || '').localeCompare(a.Date || ''))
            .map(r => ({ key: `${r.Date}|${r.Title}`, row: r })),
    };
}

const certText = r => [r.Name, r.Issuer, r.Notes].join(' ');
const achievementText = r => [r.Title, r.Type, r.Description, r.Results, r['Skills Used']].join(' ');

/** Score every item against the posting (0 for all when there's none). */
function scoreItems() {
    const phrases = items.skills.map(s => s.name);
    const sc = text => (match ? score(text, match.posting, match.text, phrases) : 0);
    for (const s of items.skills) s.score = match && mentions(match.text, s.name) ? 10 : sc(s.name);
    for (const j of items.jobs) {
        j.score = sc([j.row.Title, j.row.Summary, j.row['Skills Used']].join(' '));
        for (const b of j.bullets) b.score = sc(b.text);
    }
    for (const x of items.certifications) x.score = sc(certText(x.row));
    for (const x of items.achievements) x.score = sc(achievementText(x.row));
    for (const x of items.education) x.score = sc([x.row.Degree, x.row['Field of Study'], x.row.Notes].join(' '));
}

/** What a fresh resume includes: with a posting, what matches it; without one, a bit of everything. */
function defaultPicks() {
    const p = { skills: new Set(), jobs: new Set(), bullets: new Set(), education: new Set(), certifications: new Set(), achievements: new Set() };
    const hits = items.skills.filter(s => s.score > 0);
    (hits.length ? hits : items.skills.slice(0, 15)).forEach(s => p.skills.add(s.key));
    for (const j of items.jobs) {
        p.jobs.add(j.key);
        const ranked = j.bullets.filter(b => b.score > 0).sort((a, b) => b.score - a.score).slice(0, BULLETS_PER_JOB);
        (ranked.length ? ranked : j.bullets.slice(0, match ? 2 : 4)).forEach(b => p.bullets.add(b.key));
    }
    items.education.forEach(x => p.education.add(x.key));
    items.certifications.forEach(x => p.certifications.add(x.key));
    items.achievements.filter(x => !match || x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).forEach(x => p.achievements.add(x.key));
    return p;
}

/** The posting keywords an item shares (as the posting writes them), for its "matches …" note. */
function shared(text) {
    if (!match) return [];
    const mine = new Set(words(text).map(stem));
    return match.posting.top.filter(t => mine.has(t.stem)).map(t => t.word).slice(0, 4);
}

export async function renderResume(container) {
    el = container;
    el.innerHTML = '<p class="muted">Loading…</p>';
    [career, resumes] = await Promise.all([loadAll(), loadResumes()]);
    items = buildItems(career);
    match = draft.posting.trim() ? { posting: readPosting(draft.posting), text: draft.posting } : null;
    scoreItems();
    if (!draft.picks) draft.picks = defaultPicks();
    if (draft.summary === null) draft.summary = field(career.profile, /summary/i);

    el.innerHTML = `
        <h1 class="page no-print">Resume Builder</h1>
        <p class="lead no-print">Paste a job posting and press <b>Match my experience</b>: the resume on the right gets the skills,
            bullet points and certificates from your other pages that fit it best. Check or uncheck anything, then print it (or
            save it as a PDF) or copy it as text. It all happens on this computer — nothing is sent anywhere.</p>
        <div class="rb">
            <div class="rb-controls no-print">
                <section>
                    <h2>Job posting</h2>
                    <div class="add-grid">
                        <label class="field">Position<input type="text" id="rb-position" placeholder="e.g. Operations Manager"></label>
                        <label class="field">Company<input type="text" id="rb-company"></label>
                    </div>
                    <label class="field">The posting<textarea id="rb-posting" rows="9" placeholder="Paste the job description here: duties, requirements, qualifications…"></textarea></label>
                    <div class="row"><button type="button" class="primary" id="rb-match">Match my experience</button>
                        <span class="spacer"></span><button type="button" id="rb-new">Start over</button></div>
                </section>
                <section id="rb-keywords"></section>
                <section id="rb-picks"></section>
                <section id="rb-saved"></section>
            </div>
            <div class="rb-preview">
                <div class="row no-print rb-actions">
                    <button type="button" id="rb-print">🖨 Print / Save as PDF</button>
                    <button type="button" id="rb-copy">📋 Copy as text</button>
                    <span class="spacer"></span>
                    <button type="button" class="primary" id="rb-save">💾 Save this resume</button>
                </div>
                <article class="resume" id="rb-resume"></article>
            </div>
        </div>`;
    el.querySelector('#rb-position').value = draft.position;
    el.querySelector('#rb-company').value = draft.company;
    el.querySelector('#rb-posting').value = draft.posting;
    el.querySelector('#rb-position').oninput = e => { draft.position = e.target.value; draft.dirty = true; };
    el.querySelector('#rb-company').oninput = e => { draft.company = e.target.value; draft.dirty = true; };
    el.querySelector('#rb-posting').oninput = e => { draft.posting = e.target.value; draft.dirty = true; };
    el.querySelector('#rb-match').onclick = () => {
        if (!draft.posting.trim()) return toast('Paste a job posting first', 'bad');
        match = { posting: readPosting(draft.posting), text: draft.posting };
        scoreItems();
        draft.picks = defaultPicks();
        draft.dirty = true;
        drawAll();
        toast('Picked what matches the posting', 'ok');
    };
    el.querySelector('#rb-new').onclick = () => {
        if (hasDraft() && !confirm('Start over? The posting and your picks are cleared (saved resumes stay).')) return;
        Object.assign(draft, { position: '', company: '', posting: '', summary: field(career.profile, /summary/i), dirty: false });
        el.querySelector('#rb-position').value = el.querySelector('#rb-company').value = el.querySelector('#rb-posting').value = '';
        match = null;
        scoreItems();
        draft.picks = defaultPicks();
        drawAll();
    };
    el.querySelector('#rb-print').onclick = () => window.print();
    el.querySelector('#rb-copy').onclick = () => copyText(resumeText());
    el.querySelector('#rb-save').onclick = saveResume;
    el.querySelector('#rb-picks').addEventListener('change', e => {
        const box = e.target.closest('[data-pick]');
        if (box) {
            draft.picks[box.dataset.pick][box.checked ? 'add' : 'delete'](box.dataset.key);
            draft.dirty = true;
            drawResume();
        }
    });
    el.querySelector('#rb-picks').addEventListener('input', e => {
        if (e.target.id !== 'rb-summary') return;
        draft.summary = e.target.value;
        draft.dirty = true;
        drawResume();
    });
    el.querySelector('#rb-saved').addEventListener('click', e => {
        const b = e.target.closest('[data-saved]');
        if (b) savedAction(b.dataset.saved, b.dataset.id);
    });
    drawAll();
}

function drawAll() {
    drawKeywords();
    drawPicks();
    drawSaved();
    drawResume();
}

/** The posting's keywords, green where your career mentions them. */
function drawKeywords() {
    const box = el.querySelector('#rb-keywords');
    if (!match) { box.hidden = true; return; }
    box.hidden = false;
    const c = career;
    const mine = stemsIn([...c.profile.map(f => f.value), ...c.work.flatMap(r => Object.values(r)), ...c.skills.flatMap(r => Object.values(r)),
        ...c.education.flatMap(r => Object.values(r)), ...c.certifications.flatMap(r => Object.values(r)), ...c.achievements.flatMap(r => Object.values(r))]);
    const top = match.posting.top;
    const have = top.filter(t => mine.has(t.stem)).length;
    box.innerHTML = `
        <h2>What the posting asks for <span class="sub">${have} of ${top.length} in your career info</span></h2>
        <p class="muted rb-hint">Its most-used words. <span class="kw have">Green</span>: somewhere in your career info.
            <span class="kw">Gray</span>: not yet — if you have that experience, add it to Work History or Skills and match again.</p>
        <div class="kws">${top.map(t => `<span class="kw${mine.has(t.stem) ? ' have' : ''}" title="Used ${t.count}× in the posting">${esc(t.word)}</span>`).join('')}</div>`;
}

const check = (kind, key, on) => `<input type="checkbox" data-pick="${kind}" data-key="${esc(key)}"${on ? ' checked' : ''}>`;
const matchNote = text => { const s = shared(text); return s.length ? `<span class="hit" title="Shares these words with the posting">matches ${esc(s.join(', '))}</span>` : ''; };

/** The checkboxes: what goes in the resume. */
function drawPicks() {
    const p = draft.picks;
    const none = what => `<p class="muted">None yet — add some on the ${what} page.</p>`;
    const dates = r => `${monthYear(r.Start)} – ${r.End ? monthYear(r.End) : 'Present'}`;
    el.querySelector('#rb-picks').innerHTML = `
        <h2>What goes in</h2>
        <label class="field">Summary (from your Profile; change it for this job if you like)
            <textarea id="rb-summary" rows="4"></textarea></label>
        <h3 class="rb-h3">Skills</h3>
        ${items.skills.length ? `<div class="pick-skills">${items.skills.map(s => `<label class="pick-skill${s.score > 0 && match ? ' hit-skill' : ''}"
            title="${s.score > 0 && match ? 'The posting mentions this' : ''}">${check('skills', s.key, p.skills.has(s.key))} ${esc(s.name)}</label>`).join('')}</div>` : none('Skills')}
        <h3 class="rb-h3">Experience</h3>
        ${items.jobs.length ? items.jobs.map(j => `<div class="pick-job">
            <label class="pick-line">${check('jobs', j.key, p.jobs.has(j.key))} <b>${esc(j.row.Title || 'Position')}</b> — ${esc(j.row.Company)}
                <span class="muted">${esc(dates(j.row))}</span></label>
            ${j.bullets.length ? `<ul>${(match ? [...j.bullets].sort((a, b) => b.score - a.score) : j.bullets).map(b => `<li><label class="pick-line">
                ${check('bullets', b.key, p.bullets.has(b.key))} <span>${esc(b.text)} ${matchNote(b.text)}</span></label></li>`).join('')}</ul>`
                : '<p class="muted pick-empty">No accomplishments written for this position yet (Work History → Accomplishments, one per line).</p>'}
        </div>`).join('') : none('Work History')}
        <h3 class="rb-h3">Education</h3>
        ${items.education.length ? items.education.map(x => `<label class="pick-line">${check('education', x.key, p.education.has(x.key))}
            ${esc([x.row.Degree, x.row['Field of Study']].filter(Boolean).join(', ') || x.row.School)} <span class="muted">${esc(x.row.School)}</span></label>`).join('') : none('Education')}
        <h3 class="rb-h3">Certifications &amp; training</h3>
        ${items.certifications.length ? items.certifications.map(x => `<label class="pick-line">${check('certifications', x.key, p.certifications.has(x.key))}
            <span>${esc(x.row.Name)} <span class="muted">${esc(x.row.Issuer)}</span> ${matchNote(certText(x.row))}</span></label>`).join('') : none('Education')}
        <h3 class="rb-h3">Achievements</h3>
        ${items.achievements.length ? items.achievements.map(x => `<label class="pick-line">${check('achievements', x.key, p.achievements.has(x.key))}
            <span>${esc(x.row.Title)} ${matchNote(achievementText(x.row))}</span></label>`).join('') : none('Achievements')}`;
    el.querySelector('#rb-summary').value = draft.summary || '';
}

/** The picked parts, in resume order. */
function picked() {
    const p = draft.picks;
    const info = career.profile;
    const jobs = items.jobs.filter(j => p.jobs.has(j.key)).map(j => ({
        row: j.row,
        bullets: (match ? [...j.bullets].sort((a, b) => b.score - a.score) : j.bullets).filter(b => p.bullets.has(b.key)).map(b => b.text),
    }));
    const skills = items.skills.filter(s => p.skills.has(s.key)).sort((a, b) => (b.score > 0) - (a.score > 0)).map(s => s.name);
    return {
        name: field(info, /^name$/i),
        headline: field(info, /headline/i),
        contact: [field(info, /e-?mail/i), field(info, /phone/i), field(info, /location|city/i), field(info, /linkedin/i), field(info, /website|portfolio|github/i)].filter(Boolean),
        summary: (draft.summary || '').trim(),
        skills,
        jobs,
        education: items.education.filter(x => p.education.has(x.key)).map(x => x.row),
        certifications: items.certifications.filter(x => p.certifications.has(x.key)).map(x => x.row),
        achievements: items.achievements.filter(x => p.achievements.has(x.key)).map(x => x.row),
    };
}

const jobDates = r => `${monthYear(r.Start)} – ${r.End ? monthYear(r.End) : 'Present'}`;
const eduLine = r => [[r.Degree, r['Field of Study']].filter(Boolean).join(', '), r.School, r.Location].filter(Boolean).join(' — ');
const eduWhen = r => (r.End ? year(r.End) : r.Start ? `${year(r.Start)} – Present` : '');
const certLine = r => `${r.Name}${r.Issuer ? ` — ${r.Issuer}` : ''}${r['Date Earned'] ? ` (${year(r['Date Earned'])})` : ''}`;
const achLine = r => [r.Title, r.Results || r.Description].filter(Boolean).join(': ');

function drawResume() {
    const r = picked();
    const sec = (title, body) => (body ? `<section><h2>${title}</h2>${body}</section>` : '');
    el.querySelector('#rb-resume').innerHTML = `
        <header>
            <h1>${esc(r.name || 'Your name (Profile → Name)')}</h1>
            ${r.headline ? `<p class="headline">${esc(r.headline)}</p>` : ''}
            ${r.contact.length ? `<p class="contact">${r.contact.map(esc).join(' · ')}</p>` : ''}
        </header>
        ${sec('Summary', r.summary ? `<p>${esc(r.summary).replace(/\n/g, '<br>')}</p>` : '')}
        ${sec('Skills', r.skills.length ? `<p>${r.skills.map(esc).join(' · ')}</p>` : '')}
        ${sec('Experience', r.jobs.map(j => `<div class="job">
            <div class="job-head"><span><b>${esc(j.row.Title)}</b>${j.row.Company ? `, ${esc(j.row.Company)}` : ''}${j.row.Location ? ` — ${esc(j.row.Location)}` : ''}</span>
                <span class="dates">${esc(jobDates(j.row))}</span></div>
            ${j.bullets.length ? `<ul>${j.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`).join(''))}
        ${sec('Education', r.education.map(x => `<div class="job-head"><span>${esc(eduLine(x))}</span><span class="dates">${esc(eduWhen(x))}</span></div>`).join(''))}
        ${sec('Certifications', r.certifications.length ? `<ul>${r.certifications.map(x => `<li>${esc(certLine(x))}</li>`).join('')}</ul>` : '')}
        ${sec('Achievements', r.achievements.length ? `<ul>${r.achievements.map(x => `<li>${esc(achLine(x))}</li>`).join('')}</ul>` : '')}`;
}

/** The resume as plain text, for pasting into an application form. */
function resumeText() {
    const r = picked();
    const out = [];
    const head = t => { out.push('', t.toUpperCase()); };
    if (r.name) out.push(r.name);
    if (r.headline) out.push(r.headline);
    if (r.contact.length) out.push(r.contact.join(' | '));
    if (r.summary) { head('Summary'); out.push(r.summary); }
    if (r.skills.length) { head('Skills'); out.push(r.skills.join(', ')); }
    if (r.jobs.length) {
        head('Experience');
        for (const j of r.jobs) {
            out.push(`${j.row.Title}${j.row.Company ? `, ${j.row.Company}` : ''}${j.row.Location ? ` — ${j.row.Location}` : ''} (${jobDates(j.row)})`);
            j.bullets.forEach(b => out.push(`• ${b}`));
            out.push('');
        }
        out.pop();
    }
    if (r.education.length) { head('Education'); r.education.forEach(x => out.push(`${eduLine(x)}${eduWhen(x) ? ` (${eduWhen(x)})` : ''}`)); }
    if (r.certifications.length) { head('Certifications'); r.certifications.forEach(x => out.push(`• ${certLine(x)}`)); }
    if (r.achievements.length) { head('Achievements'); r.achievements.forEach(x => out.push(`• ${achLine(x)}`)); }
    return out.join('\n').trim() + '\n';
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        toast('Copied the resume as text', 'ok');
    } catch {
        toast("Couldn't copy (the browser blocked it)", 'bad');
    }
}

// ---------- saved resumes ----------

const pickLists = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v]]));

async function saveResume() {
    if (!draft.position.trim() && !draft.company.trim()) return toast('Fill in the Position or Company first, so you can tell your saved resumes apart', 'bad');
    const entry = {
        id: Date.now().toString(36),
        saved: new Date().toISOString(),
        position: draft.position.trim(),
        company: draft.company.trim(),
        posting: draft.posting,
        summary: draft.summary || '',
        picks: pickLists(draft.picks),
        text: resumeText(), // exactly what it said, even if Work History changes later
    };
    try {
        await saveResumes([entry, ...resumes]);
    } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
    resumes = [entry, ...resumes];
    draft.dirty = false;
    drawSaved();
    toast(`Saved in ${RESUMES_PATH.split('/').pop()}`, 'ok');
}

function drawSaved() {
    el.querySelector('#rb-saved').innerHTML = `
        <h2>Saved resumes</h2>
        ${resumes.length ? resumes.map(s => `<div class="saved-row">
            <span class="saved-name"><b>${esc(s.position || 'Resume')}</b>${s.company ? ` at ${esc(s.company)}` : ''}
                <span class="muted">· saved ${esc(new Date(s.saved).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}</span></span>
            <button type="button" class="small" data-saved="open" data-id="${esc(s.id)}" title="Open it again (posting and picks)">Open</button>
            <button type="button" class="small" data-saved="copy" data-id="${esc(s.id)}" title="Copy it as it was saved">📋 Copy</button>
            <button type="button" class="small danger" data-saved="remove" data-id="${esc(s.id)}">✕</button>
        </div>`).join('') : '<p class="muted">None yet. Make one for a job and press 💾 Save this resume — it keeps the posting with it.</p>'}`;
}

async function savedAction(action, id) {
    const s = resumes.find(x => x.id === id);
    if (!s) return;
    if (action === 'copy') return copyText(s.text);
    if (action === 'remove') {
        if (!confirm(`Remove the saved resume for ${s.position || 'this job'}${s.company ? ` at ${s.company}` : ''}?`)) return;
        const next = resumes.filter(x => x.id !== id);
        try {
            await saveResumes(next);
        } catch (err) { return toast(`Couldn't save: ${err.message}`, 'bad'); }
        resumes = next;
        return drawSaved();
    }
    if (hasDraft() && !confirm('Open this saved resume? The one you\'re working on hasn\'t been saved.')) return;
    Object.assign(draft, { position: s.position, company: s.company, posting: s.posting, summary: s.summary, dirty: false });
    el.querySelector('#rb-position').value = s.position;
    el.querySelector('#rb-company').value = s.company;
    el.querySelector('#rb-posting').value = s.posting;
    match = s.posting.trim() ? { posting: readPosting(s.posting), text: s.posting } : null;
    scoreItems();
    draft.picks = Object.fromEntries(Object.entries(defaultPicks()).map(([k]) => [k, new Set(s.picks?.[k] || [])]));
    drawAll();
    toast('Opened. Anything changed in your career info since then shows as it is now.', 'ok');
}
