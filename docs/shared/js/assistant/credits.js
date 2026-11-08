// An estimate of the Claude credits left. Anthropic has no way for an app to read the balance, so you enter what its
// Billing page shows and each question's cost (from the token counts Claude reports) is taken off that, in
// inputs/assistant/credits.json: { balance, setOn: 'YYYY-MM-DD', spent, questions }. Entering the balance again starts over.
import * as fs from '../../../bills-etc/js/fs.js';

const CREDITS_PATH = 'inputs/assistant/credits.json';

// Dollars per million tokens: [input, cache write (5 minutes), cache read, output], from Anthropic's pricing page.
const PRICES = {
    'claude-haiku-5-5': [0.10, 0.125, 0.01, 0.50],
    'claude-sonnet-5-5': [2, 2.5, 0.10, 10],
    'claude-sonnet-5': [2, 2.5, 0.20, 10],
    'claude-opus-5-5': [4, 5, 0.20, 20],
    'claude-opus-5': [5, 6.25, 0.50, 25],
    'claude-fable-5-1': [10, 12.5, 0.25, 50],
};
const HAIKU_LONG = [0.50, 0.625, 0.05, 2.50]; // Haiku 5.5, a request whose whole prompt is over 100,000 tokens
const IF_UNKNOWN = PRICES['claude-opus-5-5']; // a model not listed here: better to count too much than nothing

/** What one reply cost in dollars, from its `usage`. */
export function costOf(model, usage) {
    if (!usage) return 0;
    const input = usage.input_tokens || 0, write = usage.cache_creation_input_tokens || 0;
    const read = usage.cache_read_input_tokens || 0, output = usage.output_tokens || 0;
    const p = model === 'claude-haiku-5-5' && input + write + read > 100000 ? HAIKU_LONG : PRICES[model] || IF_UNKNOWN;
    return (input * p[0] + write * p[1] + read * p[2] + output * p[3]) / 1e6;
}

const save = c => fs.writeText(CREDITS_PATH, `${JSON.stringify(c, null, 2)}\n`);

/** The saved estimate, or null before a balance has been entered. */
export async function loadCredits() {
    const text = await fs.readText(CREDITS_PATH);
    if (text == null) return null;
    try {
        const c = JSON.parse(text);
        return Number.isFinite(c.balance) ? c : null;
    } catch { return null; }
}

/** Start counting from `balance` dollars, today. */
export async function setBalance(balance) {
    const t = new Date();
    const setOn = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    const c = { balance, setOn, spent: 0, questions: 0 };
    await save(c);
    return c;
}

/** Take one question's cost off. Nothing to do before a balance has been entered (Billing's number will include it). */
export async function addSpend(cost) {
    const c = await loadCredits();
    if (!c) return null;
    c.spent = (Number(c.spent) || 0) + cost;
    c.questions = (Number(c.questions) || 0) + 1;
    await save(c);
    return c;
}

export const creditsLeft = c => Math.max(0, c.balance - (Number(c.spent) || 0));
