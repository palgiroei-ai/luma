// Sync with the comp-push Worker (/sync): send this device's pending changes, receive everyone else's.
// Local-first: the app never waits for it. Runs right after a change (short debounce), every 10 s while the app is
// on screen, and when the connection comes back. Offline = changes wait (marked dirty) and go up on reconnect.
import { store } from './store.js';

export const SYNC_URL = location.hostname === 'localhost' ? 'http://localhost:8787' : 'https://comp-push.palgiacademy.workers.dev';
const POLL_MS = 10000, RETRY_MS = 30000, DEBOUNCE_MS = 400, TIMEOUT_MS = 8000;

export const syncState = { ok: null, at: 0, error: '' }; // ok: null = not tried yet
let key = null, inflight = null, again = false, timer = null, nextPoll = 0, hooks = {};

export async function apiKey() {
  if (!key) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('comp-push:' + store.code));
    key = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return key;
}

async function post(body) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SYNC_URL + '/sync', { method: 'POST', signal: ctl.signal, body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-Comp-Key': await apiKey() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || String(res.status));
    return data;
  } finally { clearTimeout(to); }
}

async function runOnce() {
  const offsets = []; let any = false;
  for (let guard = 0; guard < 20; guard++) {
    const items = store.pendingItems();
    const d = await post({ device: store.device, rev: store.rev, items });
    store.markSynced(items);
    const ch = store.applyRemote(d.items, d.rev);
    any = any || ch.any; offsets.push(...ch.offsets);
    if (!d.more && !store.pendingItems(1).length) break;
  }
  return { any, offsets };
}

export function syncNow() {
  if (inflight) { again = true; return inflight; }
  inflight = (async () => {
    try {
      do {
        again = false;
        const ch = await runOnce();
        Object.assign(syncState, { ok: true, at: Date.now(), error: '' });
        if (ch.any) hooks.onRemote?.(ch);
      } while (again);
      nextPoll = Date.now() + POLL_MS;
    } catch (e) {
      Object.assign(syncState, { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message });
      nextPoll = Date.now() + RETRY_MS;
    } finally {
      inflight = null;
      hooks.onStatus?.();
    }
  })();
  return inflight;
}

export function startSync(h = {}) {
  hooks = h;
  store.onChange(() => { clearTimeout(timer); timer = setTimeout(syncNow, DEBOUNCE_MS); hooks.onStatus?.(); });
  addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() >= nextPoll && !inflight) syncNow(); }, 1000);
  syncNow();
}
