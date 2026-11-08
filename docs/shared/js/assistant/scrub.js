// The privacy filter for the Home page's assistant: everything the assistant can see passes through here, on this
// device, before any of it can be sent to Claude. Passwords and sign-in details, and account, member and policy numbers
// never leave; other long numbers are cut down to their last four characters.
export const HIDDEN = '[hidden]';

// A field with one of these names (or labelled with one) is never sent.
const SECRET_FIELD = /pass ?word|pass ?code|passwd|\bpw\b|\bpwd\b|\bpin\b|\bhint\b|\bssn\b|social security|routing|account ?(number|num|no|#)|\bacct\b|member ?(id|number|num|no|#)|policy ?(number|num|no|#)|group ?(number|num|no|#)|\bvin\b|licen[cs]e|\bplate\b|reference no|user ?name|\blogin\b|sign.?in|api.?key|\btoken\b|\bsecret\b/i;
// A value that mentions a password is not sent at all, whatever its field is called.
const SECRET_TEXT = /\b(pw|pwd|passwd|passcode|password)\b|\bpin\b\s*[:=#-]?\s*\d/i;

/** 'accountNumber', 'account_number' → 'account Number', 'account number'. */
const spaced = name => String(name).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
const isSecretName = name => SECRET_FIELD.test(spaced(name));
const lastFour = s => `•••${s.replace(/[^A-Za-z0-9]/g, '').slice(-4)}`;

/** Social Security numbers go; card numbers and long codes (8+ letters and digits, 5+ of them digits) keep their last four. */
export function maskNumbers(s) {
    return s.replace(/(?<![A-Za-z0-9])\d{3}-\d{2}-\d{4}(?![A-Za-z0-9])/g, HIDDEN)
        .replace(/(?<![A-Za-z0-9])\d(?:[ -]?\d){12,18}(?![A-Za-z0-9])/g, lastFour)
        .replace(/(?<![A-Za-z0-9])[A-Za-z0-9]{8,}(?![A-Za-z0-9])/g, w => ((w.match(/\d/g)?.length ?? 0) >= 5 ? lastFour(w) : w));
}

function scrubPlain(v) {
    if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) >= 1e7 ? lastFour(String(v)) : v;
    if (typeof v !== 'string') return v;
    return SECRET_TEXT.test(v) ? HIDDEN : maskNumbers(v);
}

function scrubValue(name, v) {
    if (v == null || v === '') return v ?? '';
    return isSecretName(name) ? HIDDEN : scrubPlain(v);
}

/** Free text (an alert's sentence, say). */
export const scrubText = s => scrubPlain(String(s ?? ''));

/** One table row: { column: value }. */
export const scrubRow = row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, scrubValue(k, v)]));

/** A whole JSON document. Handles { label: 'Account Number', value: '…' } as well as { accountNumber: '…' }. */
export function scrubTree(node, name = '') {
    if (Array.isArray(node)) return node.map(x => scrubTree(x, name));
    if (node && typeof node === 'object') {
        const label = node.label ?? node.name;
        const labelled = typeof label === 'string' && isSecretName(label);
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, labelled && k === 'value' ? (v ? HIDDEN : v) : scrubTree(v, k)]));
    }
    return scrubValue(name, node);
}
