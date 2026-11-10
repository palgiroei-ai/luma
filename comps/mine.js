// stage A (2026-10-23): "שלי" — one athlete's competition history from the decrypted payload (pure; tests/mine.test.mjs).
// The athlete = the Palgi app id: national rounds by DATA.mine[round][*].id (start-list slot k → bib), international by
// DATA.intlMine[*].id (World Climbing name → bib, Israelis only). Never anyone else's rows: no id → nothing.
// Places = what the results screen shows: national rankRows / rankInCats with the round-1 count-back (app.js rankedOf /
// prevRankOf / resByBib), in the athlete's own category chip when the round has one (U19 in seniors, U15 in U17), else
// the whole round; international = ifscRanked (IFSC's place) or leadRanked. International rounds count only from the
// saved ifscData in the payload — a live-only round (Worker /ifsc) appears once it is saved. National rounds also count
// from opts.locked (the coach's "קבע כתוצאות רשמיות" results, app.js LOCKED), after the results file.
import { catHe, roundTitle } from './labels.js';
import { rankRows, rankInCats, catOptions, catLabel, isLastRound, tzText, score } from './results.js';
import { ifscAnyResults, ifscRanked, leadRanked, intlMineByBib, genderOf } from './ifsc.js';
import { seasonsOf, seasonStart, seasonEnd } from './seasons.js';

const EMPTY = () => ({ current: null, seasons: [] });
// 3.33.0 (athlete card): the history of whoever pick() selects. pick = { national(round, res), intl(round, res) } → Set of
// string bibs in that round's results rows. Same shape as myHistory; each comp also carries overall (place in the whole
// round), catPlace (place in his single-category chip, else null), catKey (raw national cat code, else null), disc 'B'|'L',
// intl, final (counted in current.finals). myHistory = historyOf with today's "שלי" bibs, the extra fields stripped.
export function historyOf(data, pick, todayYmd, { locked } = {}) {
  if (!data || !pick) return EMPTY();
  const rounds = data.rounds || [], ids = rounds.map(r => r.id), byId = Object.fromEntries(rounds.map(r => [r.id, r]));
  // same order as app.js resultsOf: results file > (international: saved ifscData | national: locked = app.js LOCKED)
  const resultsOf = id => data.results?.[id] || (byId[id]?.ifsc ? (data.ifscData?.[id] ? ifscAnyResults(data.ifscData[id]) : null) : locked?.[id] || null);
  const cache = {};
  const rankedOf = id => { if (id in cache) return cache[id]; const res = resultsOf(id); if (!res) return (cache[id] = null);
    const v = res.lead ? leadRanked(res.rows) : rankRows(res.rows, prevRankOf(id)); return (cache[id] = res.intl && !res.lead ? ifscRanked(v) : v); };
  const prevRankOf = id => { const p = id.replace(/-r2$/, '-r1'), v = p !== id && resultsOf(p) ? rankedOf(p) : null; return v && Object.fromEntries(v.map(x => [x.bib, x.rank])); };
  // → { place, overall, catPlace, catKey, line, score, cat, disc, intl } of the picked ranked row in round r, or null
  const resultIn = r => {
    const res = resultsOf(r.id); if (!res) return null;
    const bibs = (res.intl ? pick.intl : pick.national)?.(r, res) || new Set();
    const full = rankedOf(r.id), row = bibs.size ? full.find(x => bibs.has(String(x.bib)) && x.rank != null) : null; if (!row) return null;
    const g = genderOf(r.id), opt = res.intl ? null : catOptions(res.rows, g).find(o => o.cats?.length === 1 && o.cats[0] === row.cat);
    const shown = opt ? rankInCats(res.rows, opt.cats, prevRankOf(r.id)).find(x => x.bib === row.bib) : row;
    return { place: shown.rank, overall: row.rank, catPlace: opt ? shown.rank : null, catKey: res.intl ? null : row.cat || null,
      line: res.lead ? '' : tzText(row.bs), score: res.lead ? null : score(row.bs), cat: catLabel(row.cat, g), disc: res.lead ? 'L' : 'B', intl: !!res.intl };
  };
  // a final = World Climbing's '-f', or a national league's last round of 2+ ('sen-m-r2' — app.js: "seniors R2 = the final");
  // with '-f' alone no national final would ever count. A single-round competition (u17-m) is not a final.
  const isFinal = id => /-f$/.test(id) || (/-r[2-9]$/.test(id) && isLastRound(id, ids));
  const comps = [];
  for (const e of data.events || []) {
    const rs = rounds.filter(r => (r.event || 'bl1') === e.id);
    let last = null;
    for (const r of rs) { const x = resultIn(r); if (x) last = { r, x }; }
    if (!last) continue;
    comps.push({ season: seasonsOf([e])[0].id, final: isFinal(last.r.id), c: { eventId: e.id, title: e.title, date: e.dates?.[0] || rs.map(r => r.date).sort()[0],
      cat: last.x.cat, roundId: last.r.id, roundLabel: last.r.title, place: last.x.place, line: last.x.line, score: last.x.score,
      overall: last.x.overall, catPlace: last.x.catPlace, catKey: last.x.catKey, disc: last.x.disc, intl: last.x.intl, final: isFinal(last.r.id) } });
  }
  const seasons = seasonsOf((data.events || []).filter(e => comps.some(c => c.c.eventId === e.id))).reverse().map(({ id, label }) => ({ id, label,
    comps: comps.filter(c => c.season === id).map(c => c.c).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)) }));
  // current = a season running today (start..end contains todayYmd) — of those, the one with the newest competition; none → null
  const cur = todayYmd ? seasons.filter(s => seasonStart(s.id) <= todayYmd && todayYmd <= seasonEnd(s.id))
    .reduce((b, s) => (!b || s.comps[0].date > b.comps[0].date ? s : b), null) : null;
  return { current: cur ? { seasonId: cur.id, count: cur.comps.length, finals: comps.filter(c => c.season === cur.id && c.final).length,
    best: Math.min(...cur.comps.map(c => c.place)) } : null, seasons };
}

// "שלי" (stage A): today's athlete by the Palgi app id — national: DATA.mine[round][*].id (slot k → bib), international:
// DATA.intlMine[*].id (World Climbing name → bib, Israelis only). Output exactly as before 3.33.0 (extra fields stripped).
export function myHistory(data, athleteId, todayYmd, { locked } = {}) {
  if (!athleteId || !data) return EMPTY();
  const mineIntl = (data.intlMine || []).filter(a => a?.id === athleteId);
  const pick = {
    national: r => new Set((data.mine?.[r.id] || []).filter(m => m?.id === athleteId).map(m => r.slots?.[m.k]?.bib).filter(b => b != null).map(String)),
    intl: (r, res) => new Set(Object.keys(intlMineByBib(res.rows, mineIntl)).map(String)),
  };
  const h = historyOf(data, pick, todayYmd, { locked });
  return { current: h.current, seasons: h.seasons.map(s => ({ ...s, comps: s.comps.map(({ overall, catPlace, catKey, disc, intl, final, ...c }) => c) })) };
}

// one category style on every "שלי" row: [category, stage] → "נערים U19 · ראונד 2" (labels.js catHe / roundTitle).
// National: the age from the athlete's own category (U19 in a seniors round → never "בוגרים"); international: from the
// World Climbing round title. The stage = the round title after its first part; a one-part title (u17-m) has none.
export function catParts(c) {
  const label = roundTitle(c?.roundLabel || ''), segs = label.split(' · '), head = segs[0];
  const stage = segs.length > 1 ? segs.slice(1).join(' · ') : '';
  const age = /U\d+/.exec(c?.cat || '')?.[0] || /U\d+/.exec(head)?.[0] || '';
  const g = genderOf(c?.roundId || '');
  return [age ? catHe(age, g) : (/^בוגר/.test(head) ? head : (c?.cat || head)), stage].filter(Boolean);
}
