// Boulder rotation engine (pure, no DOM). One window = slotSec (climb + prep).
// Slot k starts boulder 1 at window k; boulder j (0-based) at window k+2j; rests in between.
// n = windows elapsed since T0 (after calibration offset).
import { leadPhase, leadEndMs, legStatus } from './lead.js';

// ---- time zone (3.0.0): every competition time is venue wall-clock time (Israel), whatever zone the device is in.
// Before, a viewer abroad parsed "10:00" as HIS 10:00 and saw the round hours late (feedback 2026-10-14).
export const TZ = 'Asia/Jerusalem';
// 3.22.0: a national lead round with a start list runs on web/lead.js (international lead: ifsc, empty slots → old path)
function isLead(round) { return !!(round.lead && round.slots && round.slots.length); }
const fmts = {};
const dtf = tz => (fmts[tz] = fmts[tz] || new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
// wall-clock parts of an instant in the zone
export function zoneParts(ms, tz = TZ) {
  const o = {};
  for (const p of dtf(tz).formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}
// 'YYYY-MM-DD' of an instant in a zone (3.11.0: an international competition's "today" = its venue's day)
export const dayIn = (ms, tz = TZ) => { const d = zoneParts(ms, tz); return `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };
// zone offset from UTC at that instant (ms; Israel +2 h / +3 h)
export function zoneOffset(ms, tz = TZ) {
  const p = zoneParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
// 'YYYY-MM-DDTHH:MM[:SS]' venue wall-clock → epoch ms (second pass fixes the hour around a DST change)
const zcache = new Map();
export function zonedMs(str, tz = TZ) {
  const key = tz + '|' + str;
  if (zcache.has(key)) return zcache.get(key);
  const [date, time = '00:00:00'] = str.split('T');
  const [y, mo, d] = date.split('-').map(Number), [h, mi, s = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess - zoneOffset(guess, tz);
  ms = guess - zoneOffset(ms, tz);
  zcache.set(key, ms);
  return ms;
}
// true when this device's clock is not on venue time (→ the app shows a small "שעון ישראל" label)
export const deviceOffZone = (ms = Date.now(), tz = TZ) => zoneOffset(ms, tz) !== -new Date(ms).getTimezoneOffset() * 60000;

// a round with its own `tz` (international, 3.11.1) keeps its start in venue time; shown in Israel time like the rest
export function roundStart(round) {
  return zonedMs(round.start, round.tz || TZ);
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
  if (isLead(round)) return { phase: leadPhase(round, nowMs, round.leadCtl || {}), boulders: [], next: [], n: 0 };
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
  if (isLead(round)) return leadAthleteStatus(round, k, nowMs);
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

// 3.22.0: lead — the earliest leg not done yet: on the wall → climbing, else waiting; all done → done
function leadAthleteStatus(round, k, nowMs) {
  const ctls = round.leadCtl || {};
  const legs = (round.routes || ['A', 'B']).map(r => legStatus(round, k, r, nowMs, ctls[r])).filter(l => l.kind !== 'none');
  const open = legs.filter(l => l.kind !== 'done').sort((a, b) => a.estMs - b.estMs)[0];
  if (!open) return { kind: 'done', startMs: legs.length ? Math.max(...legs.map(l => l.estMs)) : null };
  if (open.kind === 'wall') return { kind: 'climbing', startMs: open.estMs };
  return { kind: 'waiting', startMs: open.estMs, startsInMs: open.estMs - nowMs };
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

// End of the round: the last athlete's last window (incl. trailing rest), with the calibration offset.
export function roundEndMs(round, offsetMs = 0) {
  if (isLead(round)) return leadEndMs(round, round.leadCtl || {});
  return roundStart(round) + offsetMs + windowCount(round) * round.slotSec * 1000;
}

// portal consistency round (Roei: "15 דק אחרי סיום"): a national round's board, timer, calibration and next-up go away
// 15 minutes after its end. International rounds never show a board clock (always false); no start list → false.
export const BOARD_GONE_MS = 15 * 60000;
export function boardGone(round, nowMs, offsetMs = 0) {
  if (round.ifsc || !round.slots?.length) return false;
  if (isLead(round)) { const end = roundEndMs(round); return Number.isFinite(end) && nowMs >= end + BOARD_GONE_MS; } // 3.22.0
  if (!windowCount(round)) return false;
  return nowMs >= roundEndMs(round, offsetMs) + BOARD_GONE_MS;
}

// Slot k starts boulder 1 right now.
export function syncSlotNow(round, k, nowMs) {
  return nowMs - slotStartMs(round, k, 0);
}

// "השהיה" changed from d0 to d1 s per window (round.slotSec = base + d0 now) → new offset that keeps the current
// window's start where it is, so the delay counts from now on and never re-counts windows an earlier calibration fixed.
export function delayOffset(round, nowMs, offsetMs, d0, d1) {
  const n = Math.floor((nowMs - roundStart(round) - offsetMs) / (round.slotSec * 1000));
  return n > 0 ? offsetMs + n * (d0 - d1) * 1000 : offsetMs;
}

// The round (slot 0) starts at startMs.
export function syncManualStart(round, startMs) {
  return startMs - roundStart(round);
}

// ---- alerts ----
// prefs: { w2, w1, m2, m1, s10, s0, transfer } booleans. Each timed alert stays "due" until the next chosen one
// (so opening the app late shows only the most relevant alert), the last one until the athlete starts;
// s0 ("starting now", at the actual start) stays due for one minute after the start.
const LEADS = [['w2', r => 2 * r.slotSec * 1000], ['w1', r => r.slotSec * 1000], ['m2', () => 120000], ['m1', () => 60000], ['s10', () => 10000], ['s0', () => 0]];

export function alertPlan(round, k, offsetMs, prefs, transferMs = null) {
  if (isLead(round)) return [];
  const start = slotStartMs(round, k, offsetMs);
  const chosen = LEADS.filter(([t]) => prefs[t]).map(([t, f]) => ({ type: t, lead: f(round) })).sort((a, b) => b.lead - a.lead);
  const plan = chosen.map((c, i) => ({ type: c.type, at: start - c.lead, until: i + 1 < chosen.length ? start - chosen[i + 1].lead : c.lead === 0 ? start + 60000 : start }));
  if (prefs.transfer && transferMs != null) plan.unshift({ type: 'transfer', at: transferMs + offsetMs, until: Math.min(start, transferMs + offsetMs + 10 * 60000) });
  return plan;
}

// ---- overlaps: windows where 2+ of my athletes are climbing (on a boulder) at the same time ----
// Slot k climbs boulder j at window k+2j; resting / in transit between boulders does not count (Roei 2026-10-12).
export function climbOverlaps(round, ks, offsetMs = 0) {
  if (isLead(round)) return [];
  const byWindow = new Map();
  for (const k of ks) {
    for (let j = 0; j < round.boulders; j++) {
      const n = k + 2 * j;
      if (!byWindow.has(n)) byWindow.set(n, []);
      byWindow.get(n).push({ k, boulder: j + 1 });
    }
  }
  return [...byWindow.entries()].filter(([, c]) => c.length > 1).sort((a, b) => a[0] - b[0])
    .map(([n, climbers]) => ({ n, startMs: slotStartMs(round, n, offsetMs), endMs: slotStartMs(round, n + 1, offsetMs), climbers: climbers.sort((a, b) => a.k - b.k) }));
}
