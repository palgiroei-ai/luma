// 3.22.0: lead ranking — World Climbing Event Regulations 2026, Annex A §7. Pure functions, no DOM.
// Route rank: Top first, then the higher hold, "+" beats the same hold without; ties share the average place.
// Qualification points = geometric mean of the two route ranks (lower is better). R2/final: score, then count-back
// to the previous round, then (podium only) the lower climbing time.

// 3.22.0 review fix: whitespace before "+" ("32 +") and any-case "top" are scores; null = empty / not a score
export function parseScore(s) {
  // 3.26.0: intermediate holds carry decimals ("23.5", federation live data)
  const m = /^\s*(?:(top)|(\d+(?:[.,]\d+)?)\s*(\+)?)\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  return m[1] ? { top: true, hold: Infinity, plus: false } : { top: false, hold: +m[2].replace(',', '.'), plus: !!m[3] };
}
// negative = a better; no result is worse than any result
export function cmpScore(a, b) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  return (b.hold - a.hold) || (+b.plus - +a.plus) || 0;
}
const hasRes = (r, k) => parseScore(r[k]) != null;
const roundTo3 = x => Math.round(x * 1000) / 1000;

// fractional ranks among climbers with a result on this route; a starter (result on either route) with none = equal last
export function routeRanks(rows, route) {
  const other = route === 'A' ? 'B' : 'A';
  const starters = rows.filter(r => hasRes(r, route) || hasRes(r, other));
  const withRes = rows.filter(r => hasRes(r, route)).map(r => [r.bib, parseScore(r[route])]).sort((x, y) => cmpScore(x[1], y[1]));
  const out = new Map(), m = withRes.length, N = starters.length;
  for (let i = 0; i < m;) {
    let j = i;
    while (j + 1 < m && cmpScore(withRes[i][1], withRes[j + 1][1]) === 0) j++;
    for (let k = i; k <= j; k++) out.set(withRes[k][0], (i + j + 2) / 2);
    i = j + 1;
  }
  for (const r of starters) if (!out.has(r.bib)) out.set(r.bib, (m + 1 + N) / 2);
  return out;
}
export const qualPoints = ranks => roundTo3(Math.exp(ranks.reduce((s, x) => s + Math.log(x), 0) / ranks.length));

// qualification: ascending points, ties share the place (1,1,3); no result on either route = DNS, rank null, last
export function rankQual(rows) {
  const ra = routeRanks(rows, 'A'), rb = routeRanks(rows, 'B');
  const all = rows.map((r, i) => {
    if (!ra.has(r.bib)) return { ...r, rA: null, rB: null, qp: null, rank: null, i };
    const rA = ra.get(r.bib), rB = rb.get(r.bib);
    return { ...r, rA, rB, qp: qualPoints([rA, rB]), i };
  });
  const run = all.filter(x => x.qp != null).sort((a, b) => a.qp - b.qp || a.i - b.i);
  run.forEach((x, k) => { x.rank = k > 0 && run[k - 1].qp === x.qp ? run[k - 1].rank : k + 1; });
  return [...run, ...all.filter(x => x.qp == null)].map(({ i, ...x }) => x);
}

// R2 / final: by score; tie → lower rank in the previous round; still tied on the podium (place ≤ 3) → lower time
export function rankFinal(rows, prevRank, { medal = true } = {}) {
  const pv = b => prevRank?.get(b) ?? Infinity;
  const sc = rows.map((r, i) => ({ ...r, i, s: parseScore(r.A) }));
  const run = sc.filter(x => x.s).sort((a, b) => cmpScore(a.s, b.s) || pv(a.bib) - pv(b.bib) || a.i - b.i);
  const same = (a, b) => cmpScore(a.s, b.s) === 0 && pv(a.bib) === pv(b.bib);
  const out = [];
  for (let i = 0; i < run.length;) {
    let j = i;
    while (j + 1 < run.length && same(run[i], run[j + 1])) j++;
    const g = run.slice(i, j + 1), pos = i + 1;
    if (g.length > 1 && medal && pos <= 3 && g.every(x => x.time != null)) {
      g.sort((a, b) => a.time - b.time);
      let low = null; // 3.22.0 review fix: time decides podium places only — the rest of the group shares the first place below 3rd
      g.forEach((x, k) => out.push({ ...x, rank: k > 0 && g[k - 1].time === x.time ? out[out.length - 1].rank : pos + k <= 3 ? pos + k : (low ??= pos + k) }));
    } else g.forEach(x => out.push({ ...x, rank: pos }));
    i = j + 1;
  }
  return [...out, ...sc.filter(x => !x.s).map(x => ({ ...x, rank: null }))].map(({ i, s, ...x }) => x);
}

// everyone tied on the last qualifying place goes through
export function qualifiers(ranked, q) {
  const ok = ranked.filter(x => x.rank != null).sort((a, b) => a.rank - b.rank);
  if (!ok.length || q <= 0) return new Set();
  const cut = ok[Math.min(q, ok.length) - 1].rank;
  return new Set(ok.filter(x => x.rank <= cut).map(x => x.bib));
}

// manual file → the results shape web/ifsc.js renders (leadTableHtml / leadRanked). R2/final decided by roundId or the data, not by prevRank.
export function toLeadResults(file, roundId, prevRank) {
  const src = file?.rows || [];
  // R1 vs R2 from the round (lead1-…-r1 / -r2), else from the data: routes: 1 or no B scores = one-route round
  const fin = /-r2$/.test(roundId || '') ? true : /-r1$/.test(roundId || '') ? false : file?.routes === 1 || (src.length > 0 && !src.some(r => r.B));
  const ranked = fin ? rankFinal(src, prevRank ?? null) : rankQual(src);
  const rows = ranked.map(x => ({ bib: x.bib, name: x.name, club: x.club ?? null, country: null, cat: x.cat ?? null, ifscRank: x.rank,
    score: fin ? (x.A || null) : x.qp == null ? null : x.qp.toFixed(3),
    ...(fin ? {} : { rs: [[x.A || null, x.rA], [x.B || null, x.rB]] }), ...(fin && x.time != null ? { time: x.time } : {}), bs: [] }));
  const started = rows.filter(r => r.ifscRank != null).length;
  return { rows, live: false, complete: true, done: started, total: rows.length, started, lead: true, nR: fin ? 1 : 2, final: fin, round: roundId };
}
