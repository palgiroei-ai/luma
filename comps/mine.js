// stage A (2026-10-23): "שלי" — one athlete's competition history from the decrypted payload (pure; tests/mine.test.mjs).
// The athlete = the Palgi app id: national rounds by DATA.mine[round][*].id (start-list slot k → bib), international by
// DATA.intlMine[*].id (World Climbing name → bib, Israelis only). Never anyone else's rows: no id → nothing.
// Places = what the results screen shows: national rankRows / rankInCats with the round-1 count-back (app.js rankedOf /
// prevRankOf / resByBib), in the athlete's own category chip when the round has one (U19 in seniors, U15 in U17), else
// the whole round; international = ifscRanked (IFSC's place) or leadRanked. International rounds count only from the
// saved ifscData in the payload — a live-only round (Worker /ifsc) appears once it is saved. National rounds also count
// from opts.locked (the coach's "קבע כתוצאות רשמיות" results, app.js LOCKED), after the results file.
import { catHe, roundTitle } from './labels.js';
import { rankRows, rankInCats, catOptions, catLabel, isLastRound, tzText, score, quota } from './results.js';
import { ifscAnyResults, ifscRanked, leadRanked, intlMineByBib, genderOf } from './ifsc.js';
import { toLeadResults } from './leadRank.js';
import { seasonsOf, seasonStart, seasonEnd, evMeta } from './seasons.js';

// 3.34.0 (athlete card seniors / youth): a competition's age group — 'Y' = a youth event (event age youth: youth
// championships, European Youth Cup, Youth Worlds), a national youth-league round (U17 / U15 round ids: u17-m, bl2-u17-w,
// lead1-u17-m-r1) or a World Climbing category with an age (w1494b-m19-q); everything else 'S' (seniors — also a senior
// league round climbed by a U19 athlete). Event without age (older payload) → seniors.
export const compAge = (event, roundId) => (event?.age === 'youth' || /(^|-)(u1\d|[mw]1\d)(-|$)/i.test(String(roundId || '')) ? 'Y' : 'S');

const EMPTY = () => ({ current: null, seasons: [] });
// 3.33.0 (athlete card): the history of whoever pick() selects. pick = { national(round, res), intl(round, res) } → Set of
// string bibs in that round's results rows. Same shape as myHistory; each comp also carries overall (place in the whole
// round), catPlace (place in his single-category chip, else null), catKey (raw national cat code, else null), disc 'B'|'L',
// intl, final (counted in current.finals), age 'S'|'Y' + type (event series, seasons.js TYPES keys; 3.34.0). myHistory = historyOf with today's "שלי" bibs, the extra fields stripped.
export function historyOf(data, pick, todayYmd, { locked } = {}) {
  if (!data || !pick) return EMPTY();
  const rounds = data.rounds || [], ids = rounds.map(r => r.id), byId = Object.fromEntries(rounds.map(r => [r.id, r]));
  // same order as app.js resultsOf: results file > (international: saved ifscData | national: locked = app.js LOCKED)
  const resultsOf = id => data.results?.[id] || (byId[id]?.ifsc ? (data.ifscData?.[id] ? ifscAnyResults(data.ifscData[id]) : null) : locked?.[id] || null);
  const cache = {};
  const rankedOf = id => { if (id in cache) return cache[id]; const res = resultsOf(id); if (!res) return (cache[id] = null);
    const v = res.lead ? leadRanked(res.rows) : rankRows(res.rows, prevRankOf(id)); return (cache[id] = res.intl && !res.lead ? ifscRanked(v) : v); };
  const prevRankOf = id => { const p = id.replace(/-r2$/, '-r1'), v = p !== id && resultsOf(p) ? rankedOf(p) : null; return v && Object.fromEntries(v.map(x => [x.bib, x.rank])); };
  const leadPrevOf = id => { const o = prevRankOf(id); return o && new Map(Object.entries(o).filter(([, v]) => v != null).map(([b, v]) => [isNaN(b) ? b : +b, v])); }; // app.js leadPrevRank (Map by bib)
  // → { place, overall, catPlace, catKey, line, score, cat, disc, intl } of the picked ranked row in round r, or null
  const resultIn = r => {
    const res = resultsOf(r.id); if (!res) return null;
    const bibs = (res.intl ? pick.intl : pick.national)?.(r, res) || new Set();
    const full = rankedOf(r.id), row = bibs.size ? full.find(x => bibs.has(String(x.bib)) && x.rank != null) : null; if (!row) return null;
    const g = genderOf(r.id), opt = res.intl ? null : catOptions(res.rows, g).find(o => o.cats?.length === 1 && o.cats[0] === row.cat);
    // 3.34.2: national LEAD = the results screen's category chip (app.js renderNatLead): the category's raw rows (res.file)
    // re-ranked by World Climbing lead rules, R2 counting back to R1. No raw rows (nothing to re-rank) → whole-round place.
    let shown = row;
    if (opt && res.lead && !res.intl) {
      const sub = res.file ? leadRanked(toLeadResults({ rows: res.file.filter(x => opt.cats.includes(x.cat)) }, r.id, leadPrevOf(r.id)).rows) : null;
      shown = sub?.find(x => x.bib === row.bib && x.rank != null) || row;
    } else if (opt) shown = rankInCats(res.rows, opt.cats, prevRankOf(r.id)).find(x => x.bib === row.bib);
    return { place: shown.rank, overall: row.rank, catPlace: opt && shown !== row ? shown.rank : null, catKey: res.intl ? null : row.cat || null,
      line: res.lead ? '' : tzText(row.bs), score: res.lead ? null : score(row.bs), cat: catLabel(row.cat, g), disc: res.lead ? 'L' : 'B', intl: !!res.intl };
  };
  // a final = World Climbing's '-f', or a national league's last round of 2+ ('sen-m-r2' — app.js: "seniors R2 = the final");
  // with '-f' alone no national final would ever count. A single-round competition (u17-m) is not a final.
  const isFinal = id => /-f$/.test(id) || (/-r[2-9]$/.test(id) && isLastRound(id, ids));
  // 3.34.1 not finished: the athlete's latest round has a later round of the same group (national '-r1' → '-r2'; World Climbing
  // q → s → f) WITHOUT results, and he could still be in it. Decided = the later round has results, or his round's official
  // results put him below the known cut (national boulder: ILCA quota of the started rows; national lead: info.quota; World
  // Climbing: r.adv) → finished (eliminated). Cut unknown → open until the later round has results. open = this round's number.
  const STAGE = { q: 1, s: 2, f: 3 };
  const openOf = (r, x) => {
    const id = r.id, m = id.match(/-r(\d)$/), q = id.match(/^(.*)-([qsf])$/);
    let nextIds = [], n = 0;
    if (m) { nextIds = [id.slice(0, -1) + (Number(m[1]) + 1)]; n = Number(m[1]); }
    else if (q) { nextIds = ['s', 'f'].filter(l => STAGE[l] > STAGE[q[2]]).map(l => `${q[1]}-${l}`); n = STAGE[q[2]]; }
    nextIds = nextIds.filter(i => ids.includes(i));
    if (!nextIds.length || nextIds.some(i => resultsOf(i))) return 0;
    const res = resultsOf(id), full = rankedOf(id);
    if (res && full && x?.overall != null) {
      const started = full.filter(y => y.rank != null).length;
      const cut = res.intl ? (r.adv || 0) : res.lead ? (r.info?.quota || 0) : quota(started);
      if (cut > 0 && x.overall > cut) return 0;
    }
    return n;
  };
  const comps = [];
  for (const e of data.events || []) {
    const rs = rounds.filter(r => (r.event || 'bl1') === e.id);
    let last = null;
    for (const r of rs) { const x = resultIn(r); if (x) last = { r, x }; }
    if (!last) continue;
    comps.push({ season: seasonsOf([e])[0].id, final: isFinal(last.r.id), c: { eventId: e.id, title: e.title, date: e.dates?.[0] || rs.map(r => r.date).sort()[0],
      cat: last.x.cat, roundId: last.r.id, roundLabel: last.r.title, place: last.x.place, line: last.x.line, score: last.x.score,
      overall: last.x.overall, catPlace: last.x.catPlace, catKey: last.x.catKey, disc: last.x.disc, intl: last.x.intl, final: isFinal(last.r.id), open: openOf(last.r, last.x),
      age: compAge(e, last.r.id), type: evMeta(e).type } });
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
  return { current: h.current, seasons: h.seasons.map(s => ({ ...s, comps: s.comps.map(({ overall, catPlace, catKey, disc, intl, final, age, type, open, ...c }) => c) })) };
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
