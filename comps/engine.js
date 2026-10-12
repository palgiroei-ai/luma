// Boulder rotation engine (pure, no DOM). One window = slotSec (climb + prep).
// Slot k starts boulder 1 at window k; boulder j (0-based) at window k+2j; rests in between.
// n = windows elapsed since T0 (after calibration offset).

export function roundStart(round) {
  return new Date(round.start).getTime(); // local wall-clock string → device local time
}

const lastIndex = slots => {
  for (let i = slots.length - 1; i >= 0; i--) if (slots[i]) return i;
  return -1;
};

function windowAt(round, nowMs, offsetMs) {
  const S = round.slotSec * 1000;
  const rel = nowMs - roundStart(round) - offsetMs;
  const n = Math.floor(rel / S);
  return { n, S, slotEndMs: roundStart(round) + offsetMs + (n + 1) * S, slotLeftMs: (n + 1) * S - rel };
}

// Windows a slot occupies: climbs + rests (+ trailing rest).
const span = round => 2 * round.boulders - 1 + (round.trailingRest ? 1 : 0);

export function slotStartMs(round, k, offsetMs = 0) {
  return roundStart(round) + offsetMs + k * round.slotSec * 1000;
}

export function stateAt(round, nowMs, offsetMs = 0) {
  const { n, slotLeftMs, slotEndMs } = windowAt(round, nowMs, offsetMs);
  const B = round.boulders;
  const slots = round.slots;
  const last = lastIndex(slots);
  const pick = k => (k >= 0 && k < slots.length && slots[k] ? { k, ...slots[k] } : null);

  let phase = 'live';
  if (n < 0) phase = 'before';
  else if (last < 0 || n >= last + span(round)) phase = 'after';

  const boulders = Array.from({ length: B }, (_, j) => (phase === 'live' ? pick(n - 2 * j) : null));
  const rests = Array.from({ length: B - 1 }, (_, j) => (phase === 'live' ? pick(n - 2 * j - 1) : null));
  const trailing = phase === 'live' && round.trailingRest ? pick(n - (2 * B - 1)) : null;

  const next = [];
  for (let k = Math.max(0, n + 1); k < slots.length && next.length < 8; k++) {
    if (slots[k]) next.push({ ...pick(k), startMs: slotStartMs(round, k, offsetMs) });
  }
  return { phase, n, slotLeftMs, slotEndMs, boulders, rests, trailing, next };
}

export function athleteStatus(round, k, nowMs, offsetMs = 0) {
  const { n } = windowAt(round, nowMs, offsetMs);
  const startMs = slotStartMs(round, k, offsetMs);
  const d = n - k;
  const B = round.boulders;
  if (d < 0) return { kind: 'waiting', startMs, startsInMs: startMs - nowMs };
  if (d <= 2 * B - 2) {
    return d % 2 === 0
      ? { kind: 'boulder', boulder: d / 2 + 1, startMs }
      : { kind: 'rest', from: (d + 1) / 2, to: (d + 1) / 2 + 1, startMs };
  }
  if (round.trailingRest && d === 2 * B - 1) return { kind: 'trailing', startMs };
  return { kind: 'done', startMs };
}

// ---- calibration helpers → new offset (ms) ----
// Current window starts now. Before the start / during the first window it means "the round starts now"
// (late starts are common). Later it snaps to a window boundary, biased late: within the first 80% of a
// window → that window starts now (competition late), otherwise → the next window starts now (early).
export function syncWindowNow(round, nowMs, offsetMs = 0) {
  const S = round.slotSec * 1000;
  const relAll = nowMs - roundStart(round) - offsetMs;
  if (relAll < S) return nowMs - roundStart(round);
  const rel = ((relAll % S) + S) % S; // time since current window started
  return offsetMs + (rel < 0.8 * S ? rel : rel - S);
}

// Windows from the first start until the last athlete finished (incl. trailing rest).
export function windowCount(round) {
  let last = -1;
  round.slots.forEach((s, k) => { if (s) last = k; });
  return last < 0 ? 0 : last + span(round);
}

// Slot k starts boulder 1 right now.
export function syncSlotNow(round, k, nowMs) {
  return nowMs - slotStartMs(round, k, 0);
}

// The round (slot 0) starts at startMs.
export function syncManualStart(round, startMs) {
  return startMs - roundStart(round);
}
