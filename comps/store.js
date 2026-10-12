// Local-first state: calibration offsets, notes, appeals, my-athlete changes, settings, fired alerts, unlock code.
// Every access is wrapped — private mode / blocked storage must never break the page.
// Simulation (?at=…) uses its own key so demo notes/offsets never mix with the real competition (and never sync).
// Shared between the coach's devices (sync.js ↔ Worker /sync): notes, appeals, offsets, my athletes, device names.
// Each shared change gets a time t and a "dirty" mark until the server has it; the newest t wins.
const KEY = new URLSearchParams(location.search).get('at') ? 'comps.sim.v1' : 'comps.v1';
const CODE_KEY = 'comps.code';
export const DEFAULT_SETTINGS = {
  alerts: { w2: false, w1: true, m2: false, m1: true, s10: false, s0: false, transfer: false },
  sound: { on: true, vol: 0.6, tone: 'chime' },
  step: 15,          // calibration step, seconds
  lock: true,        // calibration locked by default (Roei 2026-10-12); unlock in settings or the board
  theme: 'light',    // light | dark | auto
  dark: 'plum',      // dark style like Wingate: plum | charcoal | black
  homeView: 'detail', // home screen: detail (all rounds) | list (one row per event)
};
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const blank = () => ({ offsets: {}, notes: [], appeals: [], fired: {}, code: null, settings: {}, mineAdd: {}, mineDel: {}, push: { on: false, device: null },
  v: 0, device: null, devName: '', devices: {}, meta: {}, dirty: {}, rev: 0, lastSync: 0 });

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
function delItem(kind, id) {
  const x = listOf(kind).find(n => n.id === id); if (!x || x.del) return;
  x.del = 1; x.t = Math.max(Date.now(), x.t + 1); touch(kind, id, x.t);
}

export const store = {
  get code() { try { return localStorage.getItem(CODE_KEY) || state.code; } catch { return state.code; } },
  set code(v) { try { localStorage.setItem(CODE_KEY, v); } catch { /* ignore */ } },
  offset(roundId) { return state.offsets[roundId] || 0; },
  setOffset(roundId, ms) { state.offsets[roundId] = Math.round(ms); touch('offset', roundId); },
  notes(filter = () => true) { return live(state.notes).filter(filter); },
  addNote(n) { addItem('note', n); },
  deleteNote(id) { delItem('note', id); },
  appeals(filter = () => true) { return live(state.appeals).filter(filter); },
  addAppeal(a) { addItem('appeal', a); },
  deleteAppeal(id) { delItem('appeal', id); },
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
  resetOffsets() { for (const r of Object.keys(state.offsets)) if (state.offsets[r]) this.setOffset(r, 0); },
  clearNotesAppeals() { for (const n of [...state.notes]) delItem('note', n.id); for (const a of [...state.appeals]) delItem('appeal', a.id); },
  logout() { try { localStorage.removeItem(CODE_KEY); } catch { /* ignore */ } state.code = null; save(); },
  exportAll() {
    return JSON.stringify({ device: state.devName, notes: this.notes(), appeals: this.appeals(), offsets: state.offsets, mineAdd: state.mineAdd, mineDel: state.mineDel }, null, 2);
  },

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
        const data = kind === 'offset' ? { v: state.offsets[id] || 0 } : kind === 'mine' ? { add: this.mineAdd(id), del: this.mineDel(id) } : { name: state.devName };
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
    const changed = { any: false, offsets: [] };
    for (const r of items || []) {
      const key = r.kind + ':' + r.id;
      if (r.kind === 'note' || r.kind === 'appeal') {
        const list = listOf(r.kind); const x = list.find(n => n.id === r.id);
        if (!x) { if (!r.del) { list.push({ ...r.data, id: r.id, t: r.t, dev: r.dev }); changed.any = true; } }
        else if (r.del && !x.del) { x.del = 1; x.t = r.t; delete state.dirty[key]; changed.any = true; }
        continue;
      }
      if (r.t <= (state.meta[key] || 0)) continue; // ours is newer (or the same change echoed back)
      state.meta[key] = r.t; delete state.dirty[key]; changed.any = true;
      if (r.kind === 'offset') {
        if ((state.offsets[r.id] || 0) !== (r.data?.v || 0)) changed.offsets.push({ round: r.id, dev: r.dev });
        state.offsets[r.id] = Math.round(r.data?.v || 0);
      } else if (r.kind === 'mine') {
        state.mineAdd[r.id] = (r.data?.add || []).map(Number); state.mineDel[r.id] = (r.data?.del || []).map(Number);
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
