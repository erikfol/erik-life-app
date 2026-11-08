// The chat box along the bottom of the Home page. An answer is only ever put on the page as text, and only the app's
// own pages become links (chat.js PAGES), so nothing in an answer can run or send your data anywhere.
import * as fs from '../../../bills-etc/js/fs.js';

const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
};

const BILLING_URL = 'https://console.anthropic.com/settings/billing';
function billingLink() {
    const a = el('a', '', 'console.anthropic.com');
    a.href = BILLING_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
}
/** `text` (the app's own words, never an answer) in `target`, with console.anthropic.com as a link to your billing page. */
const linked = (target, text) => text.split('console.anthropic.com').forEach((part, i) => { if (i) target.append(billingLink()); target.append(part); });

const HINTS = [
    ['Good things to ask', [
        'What’s due or overdue right now?',
        'How much did we spend on groceries last month?',
        'When was the last oil change?',
        'Which credit card has the highest balance?',
    ]],
    ['Good to know', [
        'Follow-ups work, like “and last year?”',
        'After changing something in the app, press New chat so it reads the latest.',
        'It can only read. It can’t change anything in the app.',
        'It can’t see photos or scanned invoices.',
        'Passwords, account numbers and similar details are hidden from it on purpose.',
        'It can make mistakes, so check anything important on its page.',
    ]],
    ['If something goes wrong', [
        'Out of credits: add more at console.anthropic.com. It can’t see your balance, but that page shows it.',
        '“Rejected the API key”: press Change key and paste it again.',
        '“Busy” or “too many requests”: wait a minute, then ask again.',
    ]],
];

/** `alertsMap`: each section's alerts.js loader, as on the Home page. */
export function assistantPanel(root, alertsMap) {
    const inner = el('div', 'as-inner');
    const log = el('div', 'as-log');
    log.hidden = true;
    const head = el('div', 'as-head');
    head.append(el('span', 'as-note', 'Uses your data through Claude, and can make mistakes.'));
    const actions = el('span', 'as-actions');
    const newChat = el('button', '', 'New chat'), changeKey = el('button', '', 'Change key'), close = el('button', '', '✕');
    [newChat, changeKey, close].forEach(b => { b.type = 'button'; actions.append(b); });
    close.setAttribute('aria-label', 'Close');
    head.append(actions);
    const messages = el('div', 'as-messages');
    messages.setAttribute('aria-live', 'polite');
    log.append(head, messages);

    const form = el('form', 'as-bar');
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'Ask anything about your life app…';
    input.setAttribute('aria-label', 'Ask the assistant');
    input.autocomplete = 'off';
    input.maxLength = 2000;
    const send = el('button', 'primary', 'Ask');
    send.type = 'submit';
    form.append(input, send);
    const foot = el('div', 'as-foot');
    const credits = el('span');
    linked(credits, 'Out of credits? Check your balance or add more at console.anthropic.com.');
    const hintsButton = el('button', '', 'Hints');
    hintsButton.type = 'button';
    foot.append(credits, hintsButton);
    inner.append(log, form, foot);
    root.append(inner);

    let chat = null;    // chat.js, loaded with the first question
    let ctx = null;     // the data, read once per conversation
    let history = [];   // [{ q, a }]
    let busy = false;
    let waiting = '';   // a question waiting for the key to be saved

    const open = () => { log.hidden = false; };
    const toEnd = () => { messages.scrollTop = messages.scrollHeight; };
    const add = (cls, text) => { const m = el('div', `as-msg ${cls}`, text); messages.append(m); open(); toEnd(); return m; };
    const showError = text => { linked(add('error', ''), text); toEnd(); };

    function toggleHints() {
        const showing = messages.querySelector('.as-hints');
        if (showing) {
            showing.remove();
            if (!messages.childElementCount) log.hidden = true;
            return;
        }
        const box = el('div', 'as-hints');
        for (const [title, lines] of HINTS) {
            const list = el('ul');
            for (const line of lines) { const li = el('li'); linked(li, line); list.append(li); }
            box.append(el('strong', '', title), list);
        }
        messages.append(box);
        open();
        messages.scrollTop = box.offsetTop - messages.offsetTop; // from the first hint
    }

    /** An answer, as text, with [[code]] turned into a link if it's one of the app's pages (and dropped if it isn't). */
    function showAnswer(target, text) {
        const clean = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
        target.textContent = '';
        let at = 0;
        for (const m of clean.matchAll(/\[\[([^\]]*)\]\]/g)) {
            target.append(clean.slice(at, m.index));
            const page = chat.PAGES[m[1].trim().toLowerCase()];
            if (page) { const a = el('a', '', page[1]); a.href = page[0]; target.append(a); }
            at = m.index + m[0].length;
        }
        target.append(clean.slice(at));
    }

    function showSetup() {
        messages.querySelector('.as-setup')?.remove();
        const box = el('div', 'as-setup');
        box.append(el('strong', '', 'Connect Claude'));
        const steps = el('ol');
        const link = el('a', '', 'console.anthropic.com');
        link.href = 'https://console.anthropic.com/settings/keys';
        link.target = '_blank';
        link.rel = 'noopener';
        const one = el('li');
        one.append('Sign in at ', link, ' and buy a small amount of credits under Billing. Leave auto-reload off, so it can never charge you more.');
        steps.append(one, el('li', '', 'Under API keys, create a key and copy it.'), el('li', '', 'Paste it here. It’s saved in your data folder, so your tablet and phone can use it too.'));
        const row = el('form', 'as-keyrow');
        const key = el('input');
        key.type = 'password';
        key.placeholder = 'sk-ant-…';
        key.autocomplete = 'off';
        key.setAttribute('aria-label', 'Claude API key');
        const save = el('button', 'primary', 'Save key');
        save.type = 'submit';
        row.append(key, save);
        const msg = el('div', 'as-keymsg');
        box.append(steps, row, msg);
        row.onsubmit = async e => {
            e.preventDefault();
            const value = key.value.trim();
            if (!/^sk-ant-\S+$/.test(value)) { msg.textContent = 'That doesn’t look like a Claude API key. It starts with sk-ant-.'; return; }
            save.disabled = true;
            try {
                chat ??= await import('./chat.js');
                await chat.saveKey(value);
            } catch (err) {
                msg.textContent = `Couldn’t save it: ${err.message}`;
                save.disabled = false;
                return;
            }
            box.remove();
            const q = waiting;
            waiting = '';
            if (q) submit(q);
            else add('bot', 'Saved. Ask away.');
        };
        messages.append(box);
        open();
        toEnd();
        key.focus();
    }

    async function submit(question) {
        if (busy) return;
        if (!fs.folder()) {
            add('error', fs.isSupported() ? 'Your folder isn’t connected yet. Use the button near the top of this page, then ask again.' : 'Sign in with Dropbox at the bottom of this page first, then ask again.');
            return;
        }
        busy = true;
        send.disabled = true;
        input.value = '';
        let status = null;
        try {
            chat ??= await import('./chat.js');
            const settings = await chat.assistantSettings();
            if (!settings.key) {
                waiting = question;
                input.value = question;
                showSetup();
                return;
            }
            add('you', question);
            status = add('status', 'Reading your data…');
            if (!ctx) ctx = await (await import('./sources.js')).loadContext(alertsMap);
            status.textContent = 'Thinking…';
            const answer = await chat.ask({ settings, ctx, history, question, onStatus: s => { status.textContent = s; toEnd(); } });
            status.remove();
            status = null;
            showAnswer(add('bot', ''), answer);
            history.push({ q: question, a: answer });
            toEnd();
        } catch (e) {
            status?.remove();
            showError(e.message);
        } finally {
            busy = false;
            send.disabled = false;
        }
    }

    form.onsubmit = e => {
        e.preventDefault();
        const q = input.value.trim();
        if (q) submit(q);
    };
    input.addEventListener('focus', () => { if (messages.childElementCount) open(); });
    close.onclick = () => { messages.querySelector('.as-hints')?.remove(); log.hidden = true; };
    hintsButton.onclick = toggleHints;
    newChat.onclick = () => { if (busy) return; messages.textContent = ''; history = []; ctx = null; waiting = ''; input.focus(); };
    changeKey.onclick = () => { waiting = ''; showSetup(); };
    // Back from a section (the browser may show this page as it was): something may have changed.
    window.addEventListener('pageshow', e => { if (e.persisted) ctx = null; });
}
