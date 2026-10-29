// 3.22.0: lead live board — timing engine (pure, no DOM; also imported by src/ build code).
// A route's queue: slots with a leg on it (leg.net set), by leg.pos. Auto = "not earlier than" (NET) times;
// manual = coach marks "הבאה על הקיר" (ctl.starts = start time of each climber in the order).
// Circular import with engine.js: function declarations only are read across (no top-level values at load).
import { zonedMs } from './engine.js';

export const LEAD_CLIMB_MS = 400000, ON_TIME_MS = 120000, DOUBLE_TAP_MS = 3000; // 6:00 climb + 0:40 observation
export const LEAD_GRACE_MS = 2700000; // 3.22.0 review fix: a manual route nobody tapped to the end → after, 45 min past its plan end

// 0-based B index for the climber at 0-based A index `aIndex` among n: B starts half a field later (offset rule)
export function offsetPos(n, aIndex) { return (aIndex - Math.floor(n / 2) + n) % n; }

// slot indexes on that route, by position; a withdrawn climber (no leg / no NET) is not in the order
export function legOrder(round, route) {
  return round.slots.map((s, k) => ({ k, leg: s && s[route] }))
    .filter(x => x.leg && x.leg.net).sort((a, b) => a.leg.pos - b.leg.pos).map(x => x.k);
}

export function netMs(round, k, route) {
  return zonedMs(`${round.date}T${round.slots[k][route].net}:00`);
}

function median(xs) {
  if (!xs.length) return LEAD_CLIMB_MS;
  const s = xs.slice().sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

export function routeState(round, route, nowMs, ctl = { manual: false, starts: [] }) {
  const order = legOrder(round, route), nets = order.map(k => netMs(round, k, route));
  const last = order.length - 1, step = median(nets.slice(1).map((t, i) => t - nets[i]));
  const at = (cur, curStart, phase, paceMs, behindMs, estMs, planMs, endMs) =>
    ({ order, cur, curK: cur >= 0 ? order[cur] : null, curStart, phase, paceMs, behindMs, estMs, planMs, endMs });
  if (!ctl || !ctl.manual) {
    // 3.31.0: ctl.sched / ctl.plan (withPair) = the paired round's estimates in place of the calculated times
    const est = ctl?.sched ? i => ctl.sched[i] ?? nets[i] : i => nets[i], plan = ctl?.plan ? i => ctl.plan[i] ?? nets[i] : est;
    let cur = -1;
    while (cur < last && est(cur + 1) <= nowMs) cur++;
    const endMs = est(last) + LEAD_CLIMB_MS, phase = cur < 0 ? 'before' : nowMs >= endMs ? 'after' : 'live';
    return { mode: 'auto', ...at(cur, cur >= 0 ? est(cur) : null, phase, step, null, est, plan, endMs) };
  }
  const starts = ctl.starts || [], cur = Math.min(starts.length, order.length) - 1;
  const curStart = cur >= 0 ? starts[cur] : null;
  const paceMs = cur >= 1 ? (starts[cur] - starts[0]) / cur : step;
  const floor = i => (round.netEst ? -Infinity : nets[i]); // 3.31.0: a calculated time (R2 lists without times) is no "not earlier than"
  const estMs = i => (cur < 0 ? nets[i] : i < cur ? starts[i] : i === cur ? curStart
    : Math.max(floor(i), curStart + (i - cur) * paceMs, nowMs + (i - cur - 1) * paceMs)); // 3.22.0: a forgotten tap never leaves estimates in the past
  // 3.22.0 Task 8 fix: clock-free plan (marks + pace + NET only) — alerts must not follow the clock between taps
  const planMs = i => (cur < 0 ? nets[i] : i <= cur ? starts[i] : Math.max(floor(i), curStart + (i - cur) * paceMs));
  // 3.22.0 review fix: last climber tapped → her slot end; otherwise the plan end + LEAD_GRACE_MS (a forgotten last tap never stays live)
  // 3.27.0: the last climber's live result came in (ctl.endAt) → the route is over then
  const endMs = ctl.endAt != null ? ctl.endAt : cur === last && cur >= 0 ? curStart + LEAD_CLIMB_MS : planMs(last) + LEAD_CLIMB_MS + LEAD_GRACE_MS;
  const phase = nowMs >= endMs ? 'after' : cur < 0 ? 'before' : 'live';
  // 3.22.0 fix: late = the current climber started after her NET, or the next NET passed without a tap (chip agrees with estimates)
  const behindMs = cur < 0 ? null : Math.max(curStart - nets[cur], cur < last && nowMs > nets[cur + 1] ? nowMs - nets[cur + 1] : -Infinity);
  return { mode: 'manual', ...at(cur, curStart, phase, paceMs, behindMs, estMs, planMs, endMs) };
}

// 3.27.0 (Roei): live results move a route on, also over the coach's marks. A climber with a result (also 0, once the
// judge marked her started) has finished, and so has everyone before her; the next one is on the wall since that result
// came in (in lead she starts about when the judge enters the previous score). Only ever forward — marks or a schedule
// already further on stay. resAt: Map slot k → when her result on this route arrived. → a derived manual ctl, never
// stored: { manual, starts, live: true, fromAuto, endAt? } (the last climber's result = the route is over), or ctl itself.
// 3.27.1: onAt = Map k → climb start of a climber whose record is open (on the wall now) — she is the current one.
export function withLive(round, route, ctl, resAt, nowMs, onAt = null) {
  if ((!resAt || !resAt.size) && (!onAt || !onAt.size)) return ctl;
  const s = routeState(round, route, nowMs, ctl), order = s.order, last = order.length - 1;
  let done = -1, on = -1;
  order.forEach((k, i) => { if (resAt?.has(k)) done = i; if (onAt?.has(k)) on = i; });
  if (done < 0 && on < 0) return ctl;
  const want = on > done ? on : Math.min(done + 1, last), endAt = done === last && on < 0 ? resAt.get(order[last]) : null;
  if (want <= s.cur && endAt == null) return ctl;
  const starts = ctl && ctl.manual ? (ctl.starts || []).slice(0, order.length) : order.slice(0, s.cur + 1).map(k => netMs(round, k, route));
  for (let j = starts.length; j <= want; j++) {
    const prev = j > 0 ? starts[j - 1] : -Infinity;
    const t = j === on ? onAt.get(order[on]) : resAt?.get(order[j - 1]) ?? (done >= 0 ? resAt.get(order[done]) : onAt.get(order[on]));
    starts.push(Math.min(nowMs, Math.max(prev, t)));
  }
  return { manual: true, starts, live: true, fromAuto: !(ctl && ctl.manual), ...(endAt != null ? { endAt } : {}) };
}
// 3.31.0 (ILCA 28/10, lead1 R2): girls climb in parallel to the boys — girl i starts with boy off + i (round.pair = { id, off }),
// so the boys and girls finish together. Derived, never stored, and only while the girls' route has no marks / live results
// of its own: boys' marks reached the first girl → the girls started with them (live ctl like withLive); before that → the
// girls' schedule = the boys' estimates (an auto ctl with sched / plan), so a faster or slower boys' pace moves the girls too.
export function withPair(round, route, ctl, partner, pctl, nowMs) {
  const off = round.pair?.off;
  if ((ctl && ctl.manual) || !partner || off == null || !pctl?.manual) return ctl;
  const ps = routeState(partner, route, nowMs, pctl), n = legOrder(round, route).length;
  if (ps.order.length < off + n) return ctl;
  if (ps.cur >= off) {
    const starts = []; for (let i = 0; i < n && off + i <= ps.cur; i++) starts.push(ps.estMs(off + i));
    return { manual: true, starts, live: true, fromAuto: !(ctl && ctl.manual), pair: true };
  }
  const idx = [...Array(n).keys()];
  return { manual: false, starts: [], sched: idx.map(i => ps.estMs(off + i)), plan: idx.map(i => ps.planMs(off + i)), pair: true };
}
// 3.31.1 (lead1 R2 seniors 29/10): a judge marked the first girl "started" at 09:56, 2 h before the round → withLive took it
// as her climb, the route ran from 09:56 with zero pace and showed "הסתיים". Live records from before the round's start
// (minus LIVE_EARLY_MS) are not part of this round's climbing order. Map k → t, filtered (null stays null).
export const LIVE_EARLY_MS = 900000;
export function dropEarly(round, m) {
  if (!m) return m;
  const from = zonedMs(round.start) - LIVE_EARLY_MS;
  return new Map([...m].filter(([, t]) => t >= from));
}
// the coach taps over a derived ctl → it becomes her own marks (the live flags dropped)
export const ownCtl = c => (c && c.live ? { manual: true, starts: c.starts.slice() } : c);

// "הבאה על הקיר": a second tap within DOUBLE_TAP_MS is the same start (Review Focus 2); no marks past the last climber.
// Callers switch with toManual first — markNext on a non-manual ctl returns it unchanged.
export function markNext(round, route, ctl, nowMs) {
  if (!ctl || !ctl.manual) return ctl;
  const starts = ctl.starts || [], lastMark = starts[starts.length - 1];
  if (starts.length >= legOrder(round, route).length) return ctl;
  if (lastMark != null && nowMs - lastMark < DOUBLE_TAP_MS) return ctl;
  return { ...ctl, manual: true, starts: [...starts, nowMs] };
}
export function undoMark(ctl) { return { ...ctl, starts: ((ctl && ctl.starts) || []).slice(0, -1) }; }
// switch to manual at the auto state's climber, who "has not started yet" → the previous one stays on the wall
export function toManual(round, route, nowMs) {
  const s = routeState(round, route, nowMs);
  return { manual: true, starts: s.order.slice(0, Math.max(s.cur, 0)).map(k => netMs(round, k, route)) };
}
export function toAuto() { return { manual: false, starts: [] }; }

export function legStatus(round, k, route, nowMs, ctl) {
  const s = routeState(round, route, nowMs, ctl || undefined), i = s.order.indexOf(k);
  if (i < 0) return { kind: 'none', ahead: 0, netMs: null, estMs: null, late: false };
  const net = netMs(round, k, route), est = s.estMs(i), ahead = i - s.cur;
  const kind = s.phase === 'after' || ahead < 0 ? 'done' : ahead === 0 ? 'wall' : ahead <= 2 ? 'prep' : 'wait';
  return { kind, ahead, netMs: net, estMs: est, late: est - net >= ON_TIME_MS };
}

const routesOf = round => (round.routes || ['A', 'B']).filter(r => legOrder(round, r).length);

export function leadPhase(round, nowMs, ctls = {}) {
  const ph = routesOf(round).map(r => routeState(round, r, nowMs, ctls[r] || undefined).phase);
  if (!ph.length || ph.every(p => p === 'before')) return 'before';
  return ph.every(p => p === 'after') ? 'after' : 'live';
}

export function leadEndMs(round, ctls = {}) {
  let end = -Infinity;
  for (const r of routesOf(round)) {
    end = Math.max(end, routeState(round, r, 0, ctls[r] || undefined).endMs); // = the moment the route turns 'after'
  }
  return end;
}

// two different athletes of `ks` on different routes, both not done, starting within one climb slot of each other
export function leadOverlaps(round, ks, nowMs, ctls = {}) {
  const legs = [];
  for (const route of routesOf(round)) for (const k of ks) {
    const st = legStatus(round, k, route, nowMs, ctls[route]);
    if (st.kind !== 'none' && st.kind !== 'done') legs.push({ k, route, at: st.estMs });
  }
  legs.sort((a, b) => a.at - b.at);
  const out = [];
  for (let i = 0; i < legs.length; i++) for (let j = i + 1; j < legs.length && legs[j].at - legs[i].at < LEAD_CLIMB_MS; j++) {
    if (legs[i].k !== legs[j].k && legs[i].route !== legs[j].route) out.push({ a: legs[i], b: legs[j] });
  }
  return out;
}

// pref n2/n3 = when the climber N places ahead starts; m10 = 10 min before the estimate; due until her slot ends
// 3.22.0 Task 8 fix: never from the clock-floored estMs (it moves every tick between taps → re-armed alerts, a new push plan every 5 s).
// Manual n2/n3 = trigger based: due once the climber N ahead (the first climber at the head) has a start mark, at = that mark,
// `trig` = her index (the alert key). m10 / auto = the clock-free plan (planMs). est = planMs of her leg (alert text, until).
export function leadAlertTimes(round, k, route, nowMs, ctl, pref) {
  const st = legStatus(round, k, route, nowMs, ctl);
  if (st.kind === 'none' || st.kind === 'done') return null;
  const s = routeState(round, route, nowMs, ctl || undefined), i = s.order.indexOf(k), est = s.planMs(i), until = est + LEAD_CLIMB_MS;
  if (pref === 'm10') return { at: est - 600000, until, est, trig: null };
  const N = pref === 'n3' ? 3 : 2;
  if (s.mode === 'manual') {
    const j = Math.max(i - N, 0);
    if (j > s.cur) return null; // the climber N ahead has not started yet
    return { at: ctl.starts[j], until, est, trig: j };
  }
  return { at: i - N >= 0 ? s.planMs(i - N) : est - N * s.paceMs, until, est, trig: null };
}
