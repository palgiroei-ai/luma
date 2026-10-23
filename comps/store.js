// Local-first state: calibration offsets, notes, appeals, my-athlete changes, settings, fired alerts, unlock code.
// Every access is wrapped — private mode / blocked storage must never break the page.
// Simulation (?at=…) uses its own key so demo notes/offsets never mix with the real competition (and never sync).
// Shared between the coach's devices (sync.js ↔ Worker /sync): notes, appeals, offsets, my athletes, device names.
// Each shared change gets a time t and a "dirty" mark until the server has it; the newest t wins.
import { normTag } from './tags.js';
const KEY = new URLSearchParams(location.search).get('at') ? 'comps.sim.v1' : 'comps.v1';
const CODE_KEY = 'comps.code';
// stage A: opened from the Palgi app → { role, athlete } (web/entry.js). On app.palgitraining.com localStorage is shared with
// the app: every portal key starts with 'comps.' / 'comp-' — the app's keys are wa-*, sched.*, season.*, tplan.*, tlogIntro:*, wingateAcademyHub*.
const ENTRY_KEY = 'comps.appEntry';
export const DEFAULT_SETTINGS = {
  alerts: { w2: false, w1: true, m2: false, m1: false, s10: true, s0: false, transfer: false }, // default: one round + 10 s before (Roei 2026-10-12)
  sound: { on: true, vol: 0.6, tone: 'chime' },
  step: 15,          // calibration step, seconds
  lock: true,        // calibration locked by default (Roei 2026-10-12); unlock in settings or the board
  theme: 'light',    // light | dark | auto
  dark: 'plum',      // dark style like Wingate: plum | charcoal | black
  swipeMine: true,   // swipe between rounds: only rounds with my athletes (3.2.0, Roei); off = every round of the competition
  autoArm: true,     // 3.6.0: sound + screen-on start on the first touch (no start button; bell in the header)
  homeView: 'list',  // home screen: list (one row per competition, default — Roei 2026-10-12) | detail
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const blank = () => ({ offsets: {}, delays: {}, notes: [], appeals: [], fired: {}, code: null, settings: {}, mineAdd: {}, mineDel: {}, push: { on: false, device: null },
  v: 0, device: null, devName: '', devices: {}, meta: {}, dirty: {}, rev: 0, lastSync: 0, photos: {}, tags: {} });

export function defaultDeviceName(ua = navigator.userAgent || '', touch = navigator.maxTouchPoints > 1) {
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) return 'אייפד';
  if (/iPhone/.test(ua)) return 'אייפון';
  if (/Android/.test(ua)) return 'טלפון';
  return 'מחשב';
}

let state = blank();
try { state = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* keep blank */ }

// v2 (sync): give this device an id + name and queue everything already here for upload. Calibration and my-athlete
// changes made before sync get t = 1, so they only fill an empty server and never override what another device shared.
if (state.v < 2) {
  state.device = state.device || state.push?.device || newId();
  state.devName = state.devName || defaultDeviceName();
  for (const list of [state.notes, state.appeals]) for (const n of list) { n.t = n.t || n.at || Date.now(); n.dev = n.dev || state.device; state.dirty[(list === state.notes ? 'note:' : 'appeal:') + n.id] = 1; }
  for (const [r, v] of Object.entries(state.offsets)) if (v) { state.meta['offset:' + r] = 1; state.dirty['offset:' + r] = 1; }
  for (const r of new Set([...Object.keys(state.mineAdd), ...Object.keys(state.mineDel)])) { state.meta['mine:' + r] = 1; state.dirty['mine:' + r] = 1; }
  state.meta['device:' + state.device] = Date.now(); state.dirty['device:' + state.device] = 1;
  state.v = 2; save();
}
// v3 (2.1.0 photos): 2.0.x ignored 'photo' rows but still moved rev past them and kept their t in meta → forget those
// and pull everything again once (re-pulling is harmless: newest t wins, notes match by id).
if (state.v < 3) {
  for (const k of Object.keys(state.meta || {})) if (k.startsWith('photo:')) delete state.meta[k];
  state.photos = {}; state.rev = 0; state.v = 3; save();
}
// v4 (3.7.0 boulder tags): same story — ≤3.6 skipped 'tag' rows but moved rev past them → forget + pull again once.
if (state.v < 4) {
  for (const k of Object.keys(state.meta || {})) if (k.startsWith('tag:')) delete state.meta[k];
  state.tags = {}; state.rev = 0; state.v = 4; save();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
const listeners = new Set();
function touch(kind, id, t = Date.now()) {
  t = Math.max(t, (state.meta[kind + ':' + id] || 0) + 1); // strictly newer than our last edit, even within the same ms
  state.meta[kind + ':' + id] = t; state.dirty[kind + ':' + id] = 1; save();
  for (const fn of listeners) fn();
}
const live = list => list.filter(x => !x.del).sort((a, b) => a.at - b.at);
const listOf = kind => (kind === 'note' ? state.notes : state.appeals);
const STRIP = ({ id, t, dev, del, ...data }) => data;
function addItem(kind, x) {
  const t = Date.now();
  const item = { id: t + Math.random().toString(36).slice(2, 6), ...x, t, dev: state.device };
  listOf(kind).push(item); touch(kind, item.id, t);
}
// 3.1.0: notes can be edited, appeals get a status (+ outcome line) — a newer version of the same item (newest t wins)
function editItem(kind, id, patch) {
  const x = listOf(kind).find(n => n.id === id); if (!x || x.del) return;
  Object.assign(x, patch); x.t = Math.max(Date.now(), x.t + 1); touch(kind, id, x.t);
}
function delItem(kind, id) {
  const x = listOf(kind).find(n => n.id === id); if (!x || x.del) return;
  x.del = 1; x.t = Math.max(Date.now(), x.t + 1); touch(kind, id, x.t);
}

export const store = {
  get code() { try { return localStorage.getItem(CODE_KEY) || state.code; } catch { return state.code; } },
  set code(v) { try { localStorage.setItem(CODE_KEY, v); } catch { /* ignore */ } },
  offset(roundId) { return state.offsets[roundId] || 0; },
  setOffset(roundId, ms) { state.offsets[roundId] = Math.round(ms); touch('offset', roundId); },
  // extra seconds the federation clock adds at every window change (3.0.0, 0/1/2) — shared with the offset (same item)
  delay(roundId) { return state.delays?.[roundId] || 0; },
  setDelay(roundId, sec) { state.delays = state.delays || {}; state.delays[roundId] = sec; touch('offset', roundId); },
  notes(filter = () => true) { return live(state.notes).filter(filter); },
  addNote(n) { addItem('note', n); },
  deleteNote(id) { delItem('note', id); },
  editNote(id, text, at = Date.now()) { editItem('note', id, { text, edited: at }); }, // at = the app clock (simulation)
  appeals(filter = () => true) { return live(state.appeals).filter(filter); },
  addAppeal(a) { addItem('appeal', a); },
  deleteAppeal(id) { delItem('appeal', id); },
  setAppeal(id, patch) { editItem('appeal', id, patch); }, // { status: 'pending' | 'ok' | 'no', outcome }
  wasFired(key) { return !!state.fired[key]; },
  markFired(key) { state.fired[key] = Date.now(); save(); },
  get settings() {
    const st = state.settings || {};
    return { ...DEFAULT_SETTINGS, ...st, alerts: { ...DEFAULT_SETTINGS.alerts, ...st.alerts }, sound: { ...DEFAULT_SETTINGS.sound, ...st.sound } };
  },
  setSetting(path, value) {
    const [a, b] = path.split('.');
    state.settings = state.settings || {};
    if (b) state.settings[a] = { ...(state.settings[a] || {}), [b]: value }; else state.settings[a] = value;
    save();
  },
  // per-round adjustments to "my athletes": slot indexes added / removed by the coach
  mineAdd(roundId) { return state.mineAdd[roundId] || []; },
  mineDel(roundId) { return state.mineDel[roundId] || []; },
  toggleMine(roundId, k, isMineNow, isBase) {
    const add = new Set(this.mineAdd(roundId)), del = new Set(this.mineDel(roundId));
    if (isMineNow) { add.delete(k); if (isBase) del.add(k); } else { del.delete(k); if (!isBase) add.add(k); }
    state.mineAdd[roundId] = [...add]; state.mineDel[roundId] = [...del]; touch('mine', roundId);
  },
  // lock-screen alerts (Web Push): this device's id + whether the coach turned it on
  get push() { return state.push || { on: false, device: null }; },
  setPush(on) { state.push = { on, device: state.push?.device || state.device }; save(); },
  resetOffsets() {
    for (const r of new Set([...Object.keys(state.offsets), ...Object.keys(state.delays || {})])) {
      if (state.offsets[r] || this.delay(r)) { state.offsets[r] = 0; if (state.delays) state.delays[r] = 0; touch('offset', r); }
    }
  },
  get appEntry() { try { const v = JSON.parse(localStorage.getItem(ENTRY_KEY) || 'null'); return v && typeof v === 'object' && v.role ? v : null; } catch { return null; } },
  set appEntry(v) { try { if (v) localStorage.setItem(ENTRY_KEY, JSON.stringify(v)); else localStorage.removeItem(ENTRY_KEY); } catch { /* ignore */ } },
  logout() { try { localStorage.removeItem(CODE_KEY); localStorage.removeItem(ENTRY_KEY); } catch { /* ignore */ } state.code = null; save(); },
  exportAll() {
    return JSON.stringify({ device: state.devName, notes: this.notes(), appeals: this.appeals(), offsets: state.offsets, delays: state.delays, mineAdd: state.mineAdd, mineDel: state.mineDel }, null, 2);
  },

  // feedback this device sent (ids) → "המשובים שלי"
  get fbIds() { return state.fbIds || []; },
  addFbId(id) { state.fbIds = [id, ...(state.fbIds || [])].slice(0, 100); save(); },

  // boulder photos (2.1.0): version per "round:b" (0 = none). Set only by the server (upload goes straight to /photo).
  photoV(roundId, b) { return state.photos?.[roundId + ':' + b] || 0; },

  // boulder tags (3.7.0): one per "round:b", shared between the coach's devices (newest t wins); viewers get wall + style
  tag(roundId, b) { return state.tags?.[roundId + ':' + b] || null; },
  setTag(roundId, b, tag) { const id = roundId + ':' + b; state.tags = state.tags || {}; state.tags[id] = normTag(tag); touch('tag', id); },
  clearTag(roundId, b) { const id = roundId + ':' + b; if (state.tags) delete state.tags[id]; touch('tag', id); },

  // ---- sync ----
  get device() { return state.device; },
  get devName() { return state.devName; },
  setDevName(name) { state.devName = String(name).trim().slice(0, 40) || defaultDeviceName(); touch('device', state.device); },
  deviceName(id) { return id === state.device ? state.devName : state.devices[id] || ''; },
  deviceNames() { return Object.entries(state.devices).filter(([id, name]) => id !== state.device && name).map(([, name]) => name); },
  get deviceCount() { return new Set([state.device, ...Object.keys(state.devices)]).size; },
  get rev() { return state.rev; },
  get lastSync() { return state.lastSync; },
  onChange(fn) { listeners.add(fn); },
  pendingCount() { return Object.keys(state.dirty).length; },
  // the changes the server does not have yet, in the /sync item format
  pendingItems(limit = 400) {
    const out = [];
    for (const key of Object.keys(state.dirty).slice(0, limit)) {
      const i = key.indexOf(':'); const kind = key.slice(0, i), id = key.slice(i + 1);
      if (kind === 'note' || kind === 'appeal') {
        const x = listOf(kind).find(n => n.id === id);
        if (x) out.push({ kind, id, t: x.t, del: x.del ? 1 : 0, data: STRIP(x) }); else delete state.dirty[key];
      } else {
        if (kind === 'tag') { const tg = state.tags?.[id]; out.push({ kind, id, t: state.meta[key] || 1, del: tg ? 0 : 1, data: tg || null }); continue; }
        const data = kind === 'offset' ? { v: state.offsets[id] || 0, d: this.delay(id) } : kind === 'mine' ? { add: this.mineAdd(id), del: this.mineDel(id) } : { name: state.devName };
        out.push({ kind, id, t: state.meta[key] || 1, del: 0, data });
      }
    }
    return out;
  },
  // the server stored these; anything changed again meanwhile (newer t) stays dirty
  markSynced(items) {
    for (const x of items) {
      const key = x.kind + ':' + x.id;
      const cur = x.kind === 'note' || x.kind === 'appeal' ? listOf(x.kind).find(n => n.id === x.id)?.t : state.meta[key];
      if (cur === x.t) delete state.dirty[key];
    }
    save();
  },
  // rows from the server (newest wins). Returns what changed so the UI can re-render / tell the coach.
  applyRemote(items, rev) {
    const changed = { any: false, offsets: [], photos: [], tags: [] };
    for (const r of items || []) {
      const key = r.kind + ':' + r.id;
      if (r.kind === 'note' || r.kind === 'appeal') {
        const list = listOf(r.kind); const x = list.find(n => n.id === r.id);
        if (!x) { if (!r.del) { list.push({ ...r.data, id: r.id, t: r.t, dev: r.dev }); changed.any = true; } }
        else if (r.del && !x.del) { x.del = 1; x.t = r.t; delete state.dirty[key]; changed.any = true; }
        else if (!r.del && !x.del && r.t > x.t) { Object.assign(x, r.data, { t: r.t, dev: x.dev }); delete state.dirty[key]; changed.any = true; } // edited elsewhere
        continue;
      }
      if (r.t <= (state.meta[key] || 0)) continue; // ours is newer (or the same change echoed back)
      state.meta[key] = r.t; delete state.dirty[key]; changed.any = true;
      if (r.kind === 'offset') {
        if ((state.offsets[r.id] || 0) !== (r.data?.v || 0) || this.delay(r.id) !== (r.data?.d || 0)) changed.offsets.push({ round: r.id, dev: r.dev });
        state.offsets[r.id] = Math.round(r.data?.v || 0);
        state.delays = state.delays || {}; state.delays[r.id] = Number(r.data?.d) || 0;
      } else if (r.kind === 'mine') {
        state.mineAdd[r.id] = (r.data?.add || []).map(Number); state.mineDel[r.id] = (r.data?.del || []).map(Number);
      } else if (r.kind === 'photo') {
        state.photos = state.photos || {};
        if (r.del) delete state.photos[r.id]; else state.photos[r.id] = r.data?.v || r.t;
        changed.photos.push(r.id);
      } else if (r.kind === 'tag') {
        state.tags = state.tags || {};
        const tg = r.del ? null : normTag(r.data);
        if (tg) state.tags[r.id] = tg; else delete state.tags[r.id];
        changed.tags.push(r.id);
      } else if (r.kind === 'device') {
        if (r.id === state.device) state.devName = r.data?.name || state.devName;
        else state.devices[r.id] = String(r.data?.name || '');
      }
    }
    if (Number.isFinite(rev)) state.rev = rev;
    state.lastSync = Date.now();
    save();
    return changed;
  },
};
