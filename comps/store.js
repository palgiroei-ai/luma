// Device-local state (iPad): calibration offsets, notes, appeals, fired alerts, unlock code.
// Every access is wrapped — private mode / blocked storage must never break the page.
// Simulation (?at=…) uses its own key so demo notes/offsets never mix with the real competition.
const KEY = new URLSearchParams(location.search).get('at') ? 'comps.sim.v1' : 'comps.v1';
const CODE_KEY = 'comps.code';
export const DEFAULT_SETTINGS = {
  alerts: { w2: false, w1: true, m2: false, m1: true, s10: false, s0: false, transfer: false },
  sound: { on: true, vol: 0.6, tone: 'chime' },
  step: 15,          // calibration step, seconds
  lock: true,        // calibration locked by default (Roei 2026-10-12); unlock in settings or the board
  theme: 'light',    // light | dark | auto
  dark: 'plum',      // dark style like Wingate: plum | charcoal | black
};
const blank = () => ({ offsets: {}, notes: [], appeals: [], fired: {}, code: null, settings: {}, mineAdd: {}, mineDel: {}, push: { on: false, device: null } });

let state = blank();
try { state = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* keep blank */ }

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export const store = {
  get code() { try { return localStorage.getItem(CODE_KEY) || state.code; } catch { return state.code; } },
  set code(v) { try { localStorage.setItem(CODE_KEY, v); } catch { /* ignore */ } },
  offset(roundId) { return state.offsets[roundId] || 0; },
  setOffset(roundId, ms) { state.offsets[roundId] = Math.round(ms); save(); },
  notes(filter = () => true) { return state.notes.filter(filter); },
  addNote(n) { state.notes.push({ id: Date.now() + Math.random().toString(36).slice(2, 6), ...n }); save(); },
  deleteNote(id) { state.notes = state.notes.filter(n => n.id !== id); save(); },
  appeals(filter = () => true) { return state.appeals.filter(filter); },
  addAppeal(a) { state.appeals.push({ id: Date.now() + Math.random().toString(36).slice(2, 6), ...a }); save(); },
  deleteAppeal(id) { state.appeals = state.appeals.filter(a => a.id !== id); save(); },
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
    state.mineAdd[roundId] = [...add]; state.mineDel[roundId] = [...del]; save();
  },
  // lock-screen alerts (Web Push): a random id for this iPad + whether the coach turned it on
  get push() { return state.push || { on: false, device: null }; },
  setPush(on) {
    const device = state.push?.device || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    state.push = { on, device }; save();
  },
  resetOffsets() { state.offsets = {}; save(); },
  clearNotesAppeals() { state.notes = []; state.appeals = []; save(); },
  logout() { try { localStorage.removeItem(CODE_KEY); } catch { /* ignore */ } state.code = null; save(); },
  exportAll() { return JSON.stringify({ notes: state.notes, appeals: state.appeals, offsets: state.offsets }, null, 2); },
};
