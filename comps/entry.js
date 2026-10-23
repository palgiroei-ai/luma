// stage A (2026-10-23): opened from the Palgi app. The app's button goes to /comps/#entry=<pass> (48 chars, one use, 5 min);
// POST /portal/entry (the app Worker, same origin app.palgitraining.com) answers { code, role, athlete } or a plain 404
// (expired / reused / forged pass). The hash is cleared at once, whatever the answer, so a reload or "back" never resends it.
// Pure apart from the injected fetch / location / history (tests/entry.test.mjs).
export const ENTRY_FAIL = 'פתחו שוב מהאפליקציה';
export const isEntry = hash => typeof hash === 'string' && hash.startsWith('#entry=');
export const readEntry = hash => (typeof hash === 'string' && /^#entry=([A-Za-z0-9]{48})$/.exec(hash)?.[1]) || null;
const ROLES = ['coach', 'athlete', 'viewer'];
const TIMEOUT_MS = 10000;
// → { code, role, athlete } or null; athlete only for an athlete entry with an app id (otherwise null: no "שלי")
function cleanEntry(b) {
  if (!b || typeof b !== 'object' || typeof b.code !== 'string' || !b.code || !ROLES.includes(b.role)) return null;
  const a = b.role === 'athlete' && b.athlete && typeof b.athlete.id === 'string' && b.athlete.id ? b.athlete : null;
  return { code: b.code, role: b.role, athlete: a && { id: a.id, name: String(a.name || ''), short: String(a.short || a.name || '') } };
}
export async function takeEntry(fetchImpl = globalThis.fetch, loc = globalThis.location, hist = globalThis.history) {
  const pass = readEntry(loc.hash);
  try { hist.replaceState(null, '', loc.pathname + loc.search); } catch { /* ignore */ }
  if (!pass) return null;
  let timer = null;
  try {
    const res = await Promise.race([
      fetchImpl('/portal/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass }), cache: 'no-store', credentials: 'same-origin' }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS); }),
    ]);
    return res && res.ok ? cleanEntry(await res.json()) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

// Web Push with a typed code on another host (the portal at app.palgitraining.com/comps/): the page shares that origin
// with the app, so `serviceWorker.ready` could hand back the APP's root worker → only the portal's own registration
// (scope …/comps/) may subscribe / unsubscribe; none → "can't enable". luma.palgitraining.com (and a local preview at /)
// keep the old path.
export const LUMA_HOST = 'luma.palgitraining.com';
export const pushNeedsCompsScope = (host, path) => host !== LUMA_HOST && typeof path === 'string' && path.startsWith('/comps/');
export const pushScopeOk = scope => typeof scope === 'string' && scope.endsWith('/comps/');
// the app's service worker posts { type: 'open', url } to an open window on a notification tap → same-origin url or null
export function openTarget(data, origin) {
  if (!data || data.type !== 'open' || typeof data.url !== 'string' || !data.url) return null;
  try { const u = new URL(data.url, origin); return u.origin === origin ? u.href : null; } catch { return null; }
}
