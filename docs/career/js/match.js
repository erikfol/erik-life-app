// Matching a job posting against your career, without AI: the posting's words (minus common English and job-ad
// filler) are its keywords, weighted by how often it uses them; a bullet, skill or certificate scores by the keywords
// it shares, plus extra for a skill named in the posting word for word. Words are compared by a rough stem, so
// "managed", "manager" and "management" all match.

const STOP = new Set(`a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing down during each either else etc even ever every few for from
further get gets getting had has have having he her here hers him his how however i if in into is it its itself just
like make makes many may me might more most much must my no nor not now of off on once one only or other our ours out
over own per please same shall she should so some such than that the their them then there these they this those
through to too under until up upon us very via was we were what when where which while who whom why will with within
without would yet you your yours
ability able across additional along applicant applicants apply area areas assist assists based benefit benefits best
candidate candidates center company daily day days demonstrated desired drive duties employee employees employer employment ensure
equal etc excellent experience experienced familiarity familiar full functions good great help helps highly ideal
include includes including individual job jobs join key knowledge looking methods minimum new opportunity opportunities
other others part plus position positions preferred preferably proficiency proficient proven qualification
qualifications related relevant required requirement requirements responsibilities responsibility responsible role
roles seeking skill skills strong successful support team teams time type use using various well work working year
years`.split(/\s+/));

const SUFFIXES = ['ational', 'ization', 'ations', 'ation', 'ments', 'ment', 'ings', 'ing', 'ies', 'ed', 'es', 's', 'er', 'or', 'ly'];
const SECOND = new Set(['ational', 'ization', 'ations', 'ation', 'ments', 'ment', 'er', 'or']); // what can come off after another ending

/**
 * A rough stem: 'managed', 'manager', 'management', 'managing' → 'manag'; 'hire', 'hired', 'hiring' → 'hir';
 * 'shipping', 'shipments' → 'ship'; 'supervised', 'supervisors' → 'supervis'. A second ending can come off after the
 * first ('implemented' → 'implement' → 'imple', 'managers' → 'manager' → 'manag').
 */
export function stem(word) {
    let w = word.toLowerCase();
    if (w.length <= 3 || /[^a-z]/.test(w)) return w; // short words and things like c++, node.js, 401k stay whole
    for (let pass = 0; pass < 2; pass++) {
        const s = SUFFIXES.find(x => (!pass || SECOND.has(x)) && w.endsWith(x) && w.length - x.length >= 3 && !(x === 's' && w.endsWith('ss')));
        if (!s) break;
        w = s === 'ies' ? w.slice(0, -3) + 'y' : w.slice(0, -s.length);
        if (/(ing|ed|er)$/.test(s) && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz|ff)$/.test(w)) w = w.slice(0, -1); // shipp → ship
    }
    return w.endsWith('e') && w.length >= 4 ? w.slice(0, -1) : w;
}

/** The words of a text worth matching: lower case, no stop words; keeps c++, c#, .net, node.js and the like (not "5+"). */
export function words(text) {
    return (String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) || [])
        .map(w => w.replace(/[.-]+$/, ''))
        .filter(w => w.length >= 2 && !STOP.has(w) && /[a-z]/.test(w) && (/[a-z].*[a-z]/.test(w) || /[+#]/.test(w)));
}

/** Does `phrase` (e.g. a skill: "Project Management", "Excel") appear in `text` as whole words? */
export function mentions(text, phrase) {
    const p = String(phrase || '').trim().toLowerCase();
    if (!p) return false;
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(String(text || ''));
}

/**
 * The posting's keywords: { terms: Map(stem → { word, count }) , top: [{ word, stem, count }] } — top: the 30 it uses
 * most (each shown as the form the posting uses most).
 */
export function readPosting(text) {
    const terms = new Map();
    for (const w of words(text)) {
        const s = stem(w);
        const t = terms.get(s) || { count: 0, forms: new Map() };
        t.count++;
        t.forms.set(w, (t.forms.get(w) || 0) + 1);
        terms.set(s, t);
    }
    const out = new Map([...terms].map(([s, t]) => [s, { word: [...t.forms].sort((a, b) => b[1] - a[1])[0][0], count: t.count }]));
    const top = [...out].map(([s, t]) => ({ stem: s, ...t })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)).slice(0, 30);
    return { terms: out, top };
}

/**
 * How well a piece of your career (a bullet, a skill…) matches the posting: the keywords it shares (each counting more
 * the more the posting uses it), plus 3 for each of `phrases` (your skills) that both name word for word. Divided by the
 * square root of its length so a long paragraph doesn't win just by being long. 0 = nothing in common.
 */
export function score(text, posting, postingText, phrases = []) {
    const stems = new Set(words(text).map(stem));
    let s = 0;
    for (const st of stems) {
        const t = posting.terms.get(st);
        if (t) s += 1 + Math.log(t.count);
    }
    for (const p of phrases) if (mentions(postingText, p) && mentions(text, p)) s += 3;
    return s ? s / Math.sqrt(Math.max(4, stems.size)) : 0;
}

/** The stems used anywhere in these texts (to tell which posting keywords your career covers). */
export const stemsIn = texts => new Set(texts.flatMap(t => words(t).map(stem)));
