// Device-local state (iPad): calibration offsets, notes, appeals, fired alerts, unlock code.
// Every access is wrapped — private mode / blocked storage must never break the page.
// Simulation (?at=…) uses its own key so demo notes/offsets never mix with the real competition.
const KEY = new URLSearchParams(location.search).get('at') ? 'comps.sim.v1' : 'comps.v1';
const CODE_KEY = 'comps.code';
const blank = () => ({ offsets: {}, notes: [], appeals: [], fired: {}, code: null });

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
  exportAll() { return JSON.stringify({ notes: state.notes, appeals: state.appeals, offsets: state.offsets }, null, 2); },
};
