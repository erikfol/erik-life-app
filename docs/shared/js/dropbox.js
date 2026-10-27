// Dropbox, for devices that can't open a local folder (an Android tablet or phone): the app signs in to Dropbox and
// reads and writes the same files in Dropbox's app folder, which Dropbox on the PC keeps in sync with the PC's copy.
// The app can only see that one folder. Sign-in is OAuth with PKCE, so there's no secret in this code; the tokens
// are kept only in this browser, and Sign out revokes them.

export const APP_KEY = 't3mgd1ihbxnz2js';       // from dropbox.com/developers/apps → ErikLifeApp → Settings (public; no secret is used)
export const FOLDER_LABEL = 'Apps/ErikLifeApp'; // where the app folder is in Dropbox

const STORE = 'dropbox';          // localStorage: {access, expires, refresh, account}
const PENDING = 'dropbox-signin'; // sessionStorage while signing in: {verifier, state, returnTo}
const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';

const redirectUri = () => new URL('../dropbox.html', import.meta.url).href; // docs/shared/dropbox.html

function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
}
const save = t => localStorage.setItem(STORE, JSON.stringify(t));
const forget = () => { try { localStorage.removeItem(STORE); } catch { /* fine */ } };

/** True if this browser is signed in to Dropbox (no network check). */
export const signedIn = () => !!load()?.refresh;

// ── Signing in and out ───────────────────────────────────────────────────────────────────────────────────────────
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Go to Dropbox to sign in; it comes back to docs/shared/dropbox.html, which then opens `returnTo`. */
export async function signIn(returnTo = location.href) {
    if (!APP_KEY) throw new Error('Dropbox isn’t set up in this copy of the app yet (no app key).');
    const verifier = random(48);
    const state = random(16);
    sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, returnTo }));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const q = new URLSearchParams({
        client_id: APP_KEY, response_type: 'code', redirect_uri: redirectUri(), state,
        code_challenge: challenge, code_challenge_method: 'S256', token_access_type: 'offline',
    });
    location.assign(`https://www.dropbox.com/oauth2/authorize?${q}`);
}

/** On dropbox.html: swap Dropbox's code for tokens. Returns the page to go back to. */
export async function finishSignIn() {
    const q = new URLSearchParams(location.search);
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING)); } catch { /* none */ }
    sessionStorage.removeItem(PENDING);
    if (q.get('error')) throw new Error(q.get('error_description') || q.get('error')); // e.g. Cancel on Dropbox's page
    if (!pending || !q.get('code') || q.get('state') !== pending.state) {
        throw new Error('This sign-in is out of date. Go back and press “Sign in with Dropbox” again.');
    }
    const t = await token({ grant_type: 'authorization_code', code: q.get('code'), code_verifier: pending.verifier, redirect_uri: redirectUri() });
    save({ access: t.access_token, expires: Date.now() + t.expires_in * 1000, refresh: t.refresh_token, account: t.account_id });
    const back = new URL(pending.returnTo || '../', location.href);
    return back.origin === location.origin ? back.href : new URL('../', location.href).href;
}

/** Sign this browser out and revoke its access (the PC's Dropbox and other devices are not affected). */
export async function signOut() {
    const access = await accessToken().catch(() => null);
    forget();
    if (access) await fetch(`${API}/2/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${access}` } }).catch(() => {});
}

// ── Tokens ───────────────────────────────────────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function net(url, init) {
    for (let tries = 0; ; tries++) {
        try { return await fetch(url, init); } catch {
            if (tries) throw new Error('Couldn’t reach Dropbox. Check the internet connection and try again.');
            await sleep(800); // a dropped connection (Wi-Fi): try once more
        }
    }
}

function signedOutError() {
    const e = new Error('You’re signed out of Dropbox on this device. Reload the page and sign in again.');
    e.name = 'DropboxSignedOut';
    return e;
}

async function token(params) {
    const res = await net(`${API}/oauth2/token`, { method: 'POST', body: new URLSearchParams({ ...params, client_id: APP_KEY }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new Error(`Dropbox sign-in failed: ${body.error_description || body.error || res.status}`);
        e.code = body.error;
        throw e;
    }
    return body;
}

let refreshing = null; // one refresh at a time
async function accessToken(force = false) {
    const t = load();
    if (!t?.refresh) throw signedOutError();
    if (!force && t.access && t.expires - Date.now() > 5 * 60000) return t.access;
    refreshing ??= (async () => {
        try {
            const r = await token({ grant_type: 'refresh_token', refresh_token: t.refresh });
            save({ ...t, access: r.access_token, expires: Date.now() + r.expires_in * 1000 });
            return r.access_token;
        } catch (e) {
            if (e.code === 'invalid_grant') { forget(); throw signedOutError(); } // revoked, e.g. from dropbox.com
            throw e;
        } finally {
            refreshing = null;
        }
    })();
    return refreshing;
}

// ── Calls ────────────────────────────────────────────────────────────────────────────────────────────────────────
// The Dropbox-API-Arg header must be plain ASCII, so names like “Erik’s” are sent as \uXXXX.
const headerJson = v => JSON.stringify(v).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** 'inputs/health/x.json' → '/inputs/health/x.json'; the app folder itself is ''. */
const dbxPath = path => { const p = path.split('/').filter(Boolean).join('/'); return p ? '/' + p : ''; };

async function apiError(res) {
    const text = await res.text().catch(() => '');
    let summary = text;
    try { summary = JSON.parse(text).error_summary || text; } catch { /* plain text */ }
    const e = new Error(`Dropbox: ${summary || res.status}`);
    e.status = res.status;
    e.summary = summary;
    return e;
}

/** Nothing there (or a folder where a file was expected, or the other way round). */
const missing = e => e.status === 409 && /not_found|not_file|not_folder/.test(e.summary);

async function call(url, { arg, body, headers = {} } = {}) {
    let refreshed = false, refreshNow = false;
    for (let tries = 0; ; tries++) {
        const h = { Authorization: `Bearer ${await accessToken(refreshNow)}`, ...headers };
        refreshNow = false;
        if (arg !== undefined) h['Dropbox-API-Arg'] = headerJson(arg);
        const res = await net(url, { method: 'POST', headers: h, body });
        if (res.status === 401 && !refreshed) { refreshed = refreshNow = true; continue; } // token expired early: refresh once
        if (res.status === 429 && tries < 3) { await sleep(1000 * (Number(res.headers.get('Retry-After')) || 1)); continue; } // too many at once
        if (!res.ok) throw await apiError(res);
        return res;
    }
}

const rpc = async (endpoint, args) =>
    (await call(`${API}/2/${endpoint}`, { body: JSON.stringify(args), headers: { 'Content-Type': 'application/json' } })).json();

/** {blob, meta} for the file at `path`, or null if there isn't one. */
export async function download(path) {
    try {
        const res = await call(`${CONTENT}/2/files/download`, { arg: { path: dbxPath(path) } });
        let meta = {};
        try { meta = JSON.parse(res.headers.get('Dropbox-API-Result')) || {}; } catch { /* not exposed */ }
        return { blob: await res.blob(), meta };
    } catch (e) {
        if (missing(e)) return null;
        throw e;
    }
}

/** Save text or a Blob/File at `path`, replacing what's there. Folders are made as needed. */
export async function upload(path, data) {
    const res = await call(`${CONTENT}/2/files/upload`, {
        arg: { path: dbxPath(path), mode: 'overwrite', mute: true },
        headers: { 'Content-Type': 'application/octet-stream' },
        body: typeof data === 'string' ? new Blob([data]) : data,
    });
    return res.json();
}

/** Metadata for `path` ('.tag' file/folder, server_modified, …), or null if there's nothing there. */
export async function metadata(path) {
    try { return await rpc('files/get_metadata', { path: dbxPath(path) }); } catch (e) {
        if (missing(e)) return null;
        throw e;
    }
}

/** Everything in the folder at `path`, or null if there's no such folder. */
export async function list(path) {
    try {
        let r = await rpc('files/list_folder', { path: dbxPath(path), limit: 2000 });
        const entries = [...r.entries];
        while (r.has_more) {
            r = await rpc('files/list_folder/continue', { cursor: r.cursor });
            entries.push(...r.entries);
        }
        return entries;
    } catch (e) {
        if (missing(e)) return null;
        throw e;
    }
}

export async function remove(path) {
    await rpc('files/delete_v2', { path: dbxPath(path) });
}

/** A JPEG of the image at `path`, at most 1024×768 (Dropbox turns it the right way up). Throws if it can't make one. */
export async function thumbnail(path) {
    const res = await call(`${CONTENT}/2/files/get_thumbnail_v2`, {
        arg: { resource: { '.tag': 'path', path: dbxPath(path) }, format: 'jpeg', size: 'w1024h768' },
    });
    return res.blob();
}
