// Pure destination logic for the glass bottom bar (לייב / תוצאות / שלי). No DOM, no globals.
import { seasonStart, seasonEnd } from './seasons.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// "לייב": the live round with most of mine → national first → earliest start → id; else the next round with a list
export function liveTarget(rounds, h) {
  const live = rounds.filter(r => h.isLive(r)), st = r => h.startOf(r) ?? Infinity;
  if (live.length) {
    live.sort((a, b) => h.mineCount(b) - h.mineCount(a) || Number(h.isIntl(a)) - Number(h.isIntl(b)) || st(a) - st(b) || cmp(a.id, b.id));
    return { kind: 'live', id: live[0].id };
  }
  let best = null;
  for (const r of rounds) {
    const at = h.startOf(r);
    if (at > h.now && h.hasList(r) && (!best || at < best.at || (at === best.at && cmp(r.id, best.id) < 0))) best = { id: r.id, at };
  }
  return best ? { kind: 'next', id: best.id, at: best.at } : { kind: 'none' };
}

// seasons running today; a kind with none running takes its latest-starting season
export function currentSeasonIds(seasonIds, todayYmd) {
  const out = new Set(), ids = [...new Set(seasonIds)];
  for (const id of ids) if (seasonStart(id) <= todayYmd && todayYmd <= seasonEnd(id)) out.add(id);
  for (const kind of ['nat', 'intl']) {
    const of = ids.filter(id => id.startsWith(kind + '-'));
    if (of.length && !of.some(id => out.has(id))) out.add(of.sort((a, b) => cmp(seasonStart(a), seasonStart(b)) || cmp(a, b)).at(-1));
  }
  return out;
}

// "תוצאות": current-season events with at least one round that has results (international: with an Israeli), newest first
export function resultsGroups(items, h) {
  const out = [];
  items.forEach((item, ei) => {
    const { event } = item;
    if (!h.seasons.has(event.season || 'nat-2026-27')) return;
    const kept = item.rounds.filter(r => { const res = h.resultsOf(r.id); return res && (!event.intl || h.hasIsraeli(r, res)); });
    if (!kept.length) return;
    out.push({
      eventId: event.id, ei, title: h.titleOf(item), lastDate: kept.reduce((m, r) => (r.date > m ? r.date : m), ''),
      rounds: kept.map(r => { const res = h.resultsOf(r.id); return { id: r.id, live: !!res.live && !res.saved }; }), finals: !event.intl && !!h.finalsReady(item),
    });
  });
  return out.sort((a, b) => cmp(b.lastDate, a.lastDate) || a.ei - b.ei);
}

// "שלי": one card per athlete (by name) across the competition's rounds; next-up first, finished-only last
export function compMine(item, h) {
  const cards = new Map();
  for (const r of item.rounds) {
    for (const m of h.mineOf(r.id)) {
      const name = h.slotName(r, m.k);
      if (!cards.has(name)) cards.set(name, { key: name, name, rounds: [] });
      cards.get(name).rounds.push({ id: r.id, title: h.titleOf(r), k: m.k, startMs: h.startOf(r, m.k), status: h.statusOf(r, m.k), result: h.resultOf(r, m.k) });
    }
  }
  const t = x => (x.startMs == null ? Infinity : x.startMs);
  // upcoming = no result yet and (still ahead, or on the wall / resting now); a past round without a result is not upcoming
  const up = x => x.result == null && x.startMs != null && (x.startMs >= h.now || x.status != null);
  const next = c => Math.min(Infinity, ...c.rounds.filter(up).map(x => (x.status != null ? -Infinity : x.startMs)));
  const list = [...cards.values()];
  for (const c of list) c.rounds.sort((a, b) => t(a) - t(b));
  return list.sort((a, b) => cmp(next(a), next(b)) || cmp(a.name, b.name));
}

// Shrink-on-scroll step (port of the app bar 13.5.1 shellBar_miniNext_): true = shrink, false = grow, null = no change.
// Overscroll (y < 0) and steps under 8px never change it; back at the top (y = 0) grows a small bar; down shrinks only past 30px.
export function barMiniNext(lastY, y, isMini) {
  if (typeof y !== 'number' || isNaN(y) || y < 0) return null;
  if (y === 0) return isMini ? false : null;
  const d = y - lastY;
  if (Math.abs(d) < 8) return null;
  const want = d > 0 ? (y > 30 ? true : null) : false;
  if (want === null || want === !!isMini) return null;
  return want;
}

// ---- press geometry + rim angles (glass bar feel Task 3: verbatim ports of the app bar 13.5.1, 17-shell-bar.html) ----
// The bubble under the finger: the touched tab's rect (`it`), its far edge trailing k (22%) of the way toward the old tab (`on`).
export function reachRect(on, it, k = 0.22) {
  if (k === undefined || k === null) k = 0.22;
  const itR = it.left + it.width, onR = on.left + on.width;
  const left = Math.min(it.left, it.left + k * (on.left - it.left));
  const right = Math.max(itR, itR + k * (onR - itR));
  return { left, width: right - left };
}
// Rim angle (deg) from the finger's x across the bar, and from the scroll position.
export const rimAngle = (x, width) => 150 + 120 * (width > 0 ? x / width : 0.5);
export const scrollAngle = y => 210 + 0.25 * (y || 0);
// The same angle as target, within 180deg of cur: --ang transitions, so a jump never sweeps more than half a turn.
export const unwrapAngle = (cur, target) => target + 360 * Math.round((cur - target) / 360);
// The lens chasing a new tab while the bar resizes (13.5.1 mockup chase): one damped spring step per 60 Hz frame.
export const BAR_CHASE = Object.freeze({ k: 0.22, damp: 0.62, maxMs: 1400 });
export function chaseStep(c, target) {
  c.v = (c.v + (target - c.x) * BAR_CHASE.k) * BAR_CHASE.damp;
  c.x += c.v;
  return c;
}
