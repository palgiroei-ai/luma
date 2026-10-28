// 3.29.0 (Roei): lead analysis — what my athlete needs on a route still to climb, and per-route statistics.
// Pure functions over manual-file rows ({ bib, A, B } score texts, as web/live.js and src/ build them). No DOM.
import { parseScore, cmpScore, rankQual, rankFinal } from './leadRank.js';

const txt = s => (s.top ? 'TOP' : `${s.hold}${s.plus ? '+' : ''}`);

// every score that can change a place on this route, worst first: 0, each score already there and its "+", TOP
function candidates(rows, route) {
  const seen = new Map([['0', parseScore('0')], ['TOP', parseScore('TOP')]]);
  for (const r of rows) {
    const s = parseScore(r[route]); if (!s || s.top) continue;
    seen.set(txt(s), s);
    if (!s.plus) { const p = { ...s, plus: true }; seen.set(txt(p), p); }
  }
  return [...seen.values()].sort((a, b) => cmpScore(b, a));
}

// lowest score on `route` that gives `bib` a place ≤ target, everyone else as now. → 'TOP' / '24+' / … ,
// '' = any score does it (already safe), null = not even TOP is enough. Round 1: two routes (World Climbing points);
// one route (round 2): by score, ties by round 1 places (prevRank).
export function neededOn(rows, bib, route, target, { prevRank = null, oneRoute = false } = {}) {
  const rankOf = rs => (oneRoute ? rankFinal(rs, prevRank, { medal: false }) : rankQual(rs)).find(x => x.bib === bib)?.rank;
  const cs = candidates(rows, route);
  for (const [i, c] of cs.entries()) {
    const rk = rankOf(rows.map(r => (r.bib === bib ? { ...r, [route]: txt(c) } : r)));
    if (rk != null && rk <= target) return i === 0 ? '' : txt(c);
  }
  return null;
}

// a route's numbers: who climbed, tops, median height, and the 4-hold band where most climbers fell (count ≥ 2)
export function routeStats(rows, route) {
  const ss = rows.map(r => parseScore(r[route])).filter(Boolean), n = ss.length;
  if (!n) return { n: 0, tops: 0, median: null, band: null };
  const tops = ss.filter(s => s.top).length;
  const sorted = ss.slice().sort((a, b) => cmpScore(b, a)), median = txt(sorted[Math.floor((n - 1) / 2)]);
  const falls = ss.filter(s => !s.top).map(s => Math.floor(s.hold));
  let band = null;
  for (const lo of new Set(falls)) {
    const c = falls.filter(h => h >= lo && h <= lo + 3).length;
    if (c >= 2 && (!band || c > band.count || (c === band.count && lo < band.from))) band = { from: lo, to: lo + 3, count: c };
  }
  return { n, tops, median, band };
}
