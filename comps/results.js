// Round results — pure scoring/ranking (World Climbing boulder, 2025+ points system). Used by app.js and tests.
// Points per boulder: top 25, zone (no top) 10, minus 0.1 per failed attempt before it (never below 0).
// Ranking (World Climbing Event Regulations Jan 2026 v3, Annex C §7.1; Roei 2026-10-13):
//   points → count-back to the previous round's ranking (if given) → fewer attempts on the topped boulders
//   → fewer attempts to zone, counted on EVERY boulder where the zone was reached (topped ones too —
//   checked on 412 broken ties in IFSC 2025–26 qualifications: this explains all of them).
// Quota for the next round (ILCA "אמות המידה ליגת העל 2026"): ≥30 started → 24; 8–29 → max(8, 50%); <8 → everyone.
// Anyone tied on the last qualifying place advances (Event Regulations §2.4).

export const r1 = x => Math.round(x * 10) / 10;
export const pts = ([t, z]) => t ? Math.max(0, 25 - 0.1 * (t - 1)) : z ? Math.max(0, 10 - 0.1 * (z - 1)) : 0;
export const score = bs => r1(bs.reduce((s, b) => s + pts(b), 0));
export const topAttempts = bs => bs.reduce((s, [t]) => s + (t || 0), 0);
export const zoneAttempts = bs => bs.reduce((s, [, z]) => s + (z || 0), 0);
export const tops = bs => bs.filter(b => b[0]).length;
export const zones = bs => bs.filter(b => b[0] || b[1]).length;
export const kind = ([t, z]) => (t ? 't' : z ? 'z' : 'n');

export function quota(n) { return n >= 30 ? 24 : n >= 8 ? Math.max(8, Math.ceil(n / 2)) : n; }

// rows: [{ bib, bs, total:'DNS'|… }]; prevRank: optional { bib: rank } of the preceding round (count-back).
// → started rows sorted best first with { score, rank } (ties share a rank), then DNS rows (rank null).
export function rankRows(rows, prevRank = null) {
  const dns = r => r.total === 'DNS' || !r.bs.length;
  const started = rows.filter(r => !dns(r)).map(r => ({ ...r, score: score(r.bs), ta: topAttempts(r.bs), za: zoneAttempts(r.bs) }));
  const cb = r => (prevRank && prevRank[r.bib] != null ? prevRank[r.bib] : Infinity);
  const cmp = (a, b) => (b.score - a.score) || (prevRank ? cb(a) - cb(b) : 0) || (a.ta - b.ta) || (a.za - b.za);
  started.sort(cmp);
  started.forEach((r, i) => { r.rank = i && cmp(started[i - 1], r) === 0 ? started[i - 1].rank : i + 1; });
  return [...started, ...rows.filter(dns).map(r => ({ ...r, score: null, rank: null }))];
}

// Everything the athlete card shows. ranked = rankRows() output (the whole round or one category), row = one of its
// started rows. full = the whole round's ranking: advancing to the next round is always by the overall ranking.
export function analyze(ranked, row, full = ranked) {
  const ok = ranked.filter(r => r.rank != null), n = ok.length;
  const all = full.filter(r => r.rank != null), q = quota(all.length), cutScore = all[q - 1].score;
  const overall = all.find(x => x.bib === row.bib) || row;
  const i = ok.indexOf(row);
  const above = ok.slice(0, i).reverse().find(x => x.score > row.score) || null;
  const below = ok.slice(i + 1).find(x => x.score < row.score) || null;
  const lost = r1(row.bs.reduce((s, [t, z]) => s + (t ? 0.1 * (t - 1) : z ? 0.1 * (z - 1) : 0), 0));
  // best boulder = best place among everyone on one boulder, only where he scored;
  // same place → the one fewer athletes shared (alone on a top beats a shared 1st; Roei 2026-10-14)
  let strong = null;
  row.bs.forEach((b, j) => {
    const p = pts(b); if (!p) return;
    const place = 1 + ok.filter(x => pts(x.bs[j]) > p).length;
    const shared = ok.filter(x => pts(x.bs[j]) === p).length;
    if (!strong || place < strong.place || (place === strong.place && shared < strong.shared)) strong = { boulder: j + 1, place, shared, b };
  });
  // what if — one more top / zone, if there was room for it (place by points; equal points = same place)
  const rankWith = s => 1 + ok.filter(x => x !== row && x.score > s).length;
  const zOnly = row.bs.filter(b => !b[0] && b[1]).sort((x, y) => x[1] - y[1]);
  const empty = row.bs.some(b => !b[0] && !b[1]);
  const opts = [];
  if (zOnly.length) opts.push({ key: 'topFromZone', gain: r1(25 - 0.1 * (zOnly[0][1] - 1) - pts(zOnly[0])) });
  if (empty) opts.push({ key: 'topFromEmpty', gain: 25 }, { key: 'zoneFromEmpty', gain: 10 });
  const overallWith = s => 1 + all.filter(x => x.bib !== row.bib && x.score > s).length;
  for (const o of opts) { o.score = r1(row.score + o.gain); o.rank = rankWith(o.score); o.advances = overall.rank > q && overallWith(o.score) <= q; }
  return { n, quota: q, cutScore, overallRank: overall.rank, advances: overall.rank <= q, missing: overall.rank <= q ? 0 : r1(cutScore - row.score + 0.1),
    above, below, lost, strong, opts, tops: tops(row.bs), zones: zones(row.bs) };
}

// Per boulder: how many topped / reached only the zone, average attempts to top and to zone.
export function boulderStats(ranked, nBoulders) {
  const ok = ranked.filter(r => r.rank != null);
  const avg = a => (a.length ? r1(a.reduce((s, x) => s + x, 0) / a.length) : null);
  return Array.from({ length: nBoulders }, (_, j) => {
    const cells = ok.map(r => r.bs[j]);
    return { boulder: j + 1, n: ok.length, tops: cells.filter(b => b[0]).length, zoneOnly: cells.filter(b => !b[0] && b[1]).length,
      avgTop: avg(cells.filter(b => b[0]).map(b => b[0])), avgZone: avg(cells.filter(b => b[1]).map(b => b[1])) };
  });
}

// Category filter (Roei 2026-10-13). cat codes in the data: S = open seniors, U21, U19 | U17, U15.
// Seniors rounds: everyone (default) | U21 | U19 — no chip for open seniors alone. U17 rounds: U17 alone (default) |
// U15 alone | both. Labels = U<age> + M/W.
export function catOptions(rows, gender) {
  const has = c => rows.some(r => r.cat === c);
  if (has('U15') || has('U17')) return [
    { key: 'U17', label: `U17${gender}`, cats: ['U17'] }, { key: 'U15', label: `U15${gender}`, cats: ['U15'] },
    { key: 'U17+U15', label: `U17${gender} + U15${gender}`, cats: ['U17', 'U15'] }].filter(o => o.cats.some(has));
  if (!rows.some(r => r.cat)) return [];
  return [{ key: 'all', label: gender === 'W' ? 'בוגרות' : 'בוגרים', cats: null },
    ...['U21', 'U19'].filter(has).map(c => ({ key: c, label: c + gender, cats: [c] }))];
}
export const catLabel = (cat, gender) => (!cat ? '' : cat === 'S' ? (gender === 'W' ? 'בוגרות' : 'בוגרים') : cat + gender);
// the round's ranking inside one option (places re-numbered, ties + count-back as in the whole round)
export function rankInCats(rows, cats, prevRank = null) {
  return rankRows(cats ? rows.filter(r => cats.includes(r.cat)) : rows, prevRank);
}
