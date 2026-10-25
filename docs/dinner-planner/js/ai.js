// Optional AI meal ideas from Claude, ported from the old Node app. Off until inputs/dinner-planner/.env has a line
// ANTHROPIC_API_KEY=… (optionally DINNER_AI_MODEL=…). The key stays on this computer except in the request to Anthropic.
import * as fs from '../../bills-etc/js/fs.js';
import { DIR, localDate, normalizeMeal, cleanStr, mealsOf } from './store.js';

export const ENV_PATH = `${DIR}/.env`;
const DEFAULT_MODEL = 'claude-opus-5-5';
// Models that take fallbacks: "default" (a declined request is re-run on another model instead of failing).
const FALLBACK_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5'];

/** { key, model } from the .env file (KEY=value lines); key is '' when there isn't one. */
export async function aiSettings() {
    const env = {};
    for (const line of (await fs.readText(ENV_PATH) ?? '').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
    return { key: env.ANTHROPIC_API_KEY || '', model: env.DINNER_AI_MODEL || DEFAULT_MODEL };
}

// The shape every idea comes back in (structured output, so the reply is always this JSON).
const IDEAS_SCHEMA = {
    type: 'object',
    properties: {
        meals: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    why: { type: 'string', description: 'One sentence tying this idea to meals the family already eats.' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Lowercase, e.g. cuisine, main protein, "quick".' },
                    prepMinutes: { type: 'integer' },
                    ingredients: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: { name: { type: 'string' }, quantity: { type: 'string' } },
                            required: ['name', 'quantity'],
                            additionalProperties: false,
                        },
                    },
                    notes: { type: 'string', description: 'Short numbered cooking steps.' },
                },
                required: ['name', 'why', 'tags', 'prepMinutes', 'ingredients', 'notes'],
                additionalProperties: false,
            },
        },
    },
    required: ['meals'],
    additionalProperties: false,
};

function buildPrompt(db, request) {
    const today = localDate();
    const daysAgo = d => Math.round((Date.parse(today) - Date.parse(d)) / 86400000);
    const eaten = Object.entries(db.plan)
        .filter(([d, e]) => d < today && !e.skipped)
        .sort(([a], [b]) => a.localeCompare(b));

    const stats = {};
    for (const [d, e] of eaten) {
        for (const id of mealsOf(e)) {
            const s = (stats[id] ||= { count: 0, last: d });
            s.count++;
            s.last = d;
        }
    }

    const mealLines = db.meals.map(m => {
        const s = stats[m.id];
        const history = s ? `had ${s.count}x, last ${daysAgo(s.last)} days ago` : 'not logged yet';
        return `- ${m.name}${m.favorite ? ' (FAVORITE)' : ''} [${m.tags.join(', ')}] — ${m.ingredients.map(i => i.name).join(', ')} — ${history}`;
    });

    const recent = eaten
        .filter(([d]) => daysAgo(d) <= 28)
        .map(([d, e]) => `- ${d}: ${mealsOf(e).map(id => db.meals.find(m => m.id === id)?.name).filter(Boolean).join(' + ') || e.note}`);

    const avoid = [...db.aiRejected.slice(-60), ...db.aiIdeas.map(i => i.name)];

    return [
        `Today is ${today}. Suggest 6 new dinner ideas for this family.`,
        '',
        "## The family's regular meals",
        mealLines.join('\n') || '(none yet)',
        '',
        '## Dinners from the last 4 weeks',
        recent.join('\n') || '(no history logged yet)',
        '',
        '## Already suggested or rejected (do not suggest these or close variants)',
        avoid.join(', ') || '(none)',
        '',
        request ? `## What they asked for this time\n${request}\n` : '',
        'Guidelines:',
        '- Base the ideas on the styles, proteins and ingredients they clearly enjoy; weight favorites and frequently eaten meals most.',
        '- Mix it up: a few that feel familiar, and one or two that stretch a little into something new.',
        "- Don't repeat their existing meals or simple renames of them.",
        '- Realistic weeknight home cooking with ingredients from a normal grocery store. Quantities for about 4 servings.',
        '- "why" should mention a specific meal they already eat.',
        '- Keep "notes" to 3-6 short numbered steps.',
    ].join('\n');
}

/** Ask Claude for new ideas; resolves to meals (with `why`) ready for store.addAiIdeas. Throws with a readable message. */
export async function suggestMeals(db, request, { key, model }) {
    if (!key) throw new Error(`No API key set. Add ANTHROPIC_API_KEY=… to ${ENV_PATH} and reload the page.`);
    const fallback = FALLBACK_MODELS.includes(model);
    let res;
    try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true', // this page calls the API itself; there's no server
                ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
            },
            body: JSON.stringify({
                model,
                max_tokens: 16000,
                system: 'You are a practical, friendly family dinner planner. You suggest dinners that busy families will actually cook and enjoy.',
                messages: [{ role: 'user', content: buildPrompt(db, cleanStr(request, 500)) }],
                output_config: { effort: 'medium', format: { type: 'json_schema', schema: IDEAS_SCHEMA } },
                ...(fallback ? { fallbacks: 'default' } : {}),
            }),
            signal: AbortSignal.timeout(180000),
        });
    } catch (err) {
        if (err.name === 'TimeoutError') throw new Error('The AI took too long to respond. Try again.');
        throw new Error("Couldn't reach the AI service. Check your internet connection.");
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const detail = body.error?.message || res.statusText;
        throw new Error(res.status === 401 ? `The API key was rejected. Check ANTHROPIC_API_KEY in ${ENV_PATH}.`
            : res.status === 429 ? 'Rate limited by the API. Wait a minute and try again.'
                : `AI request failed (${res.status}): ${detail}`);
    }
    if (body.stop_reason === 'refusal') throw new Error('Claude declined this request. Try asking differently.');
    if (body.stop_reason === 'max_tokens') throw new Error('The AI reply was cut off. Try again.');

    let ideas;
    try {
        ideas = JSON.parse((body.content || []).find(c => c.type === 'text')?.text || '').meals;
    } catch { /* falls through to the check below */ }
    if (!Array.isArray(ideas)) throw new Error('The AI response did not include any meals. Try again.');

    return ideas
        .map(m => ({ ...normalizeMeal(m), why: cleanStr(m.why, 300), source: 'AI suggestion' }))
        .filter(m => m.name);
}
