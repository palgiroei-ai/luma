// 3.33.0 athlete card: anyone's competition history (pure; tests/athlete.test.mjs). Identity rules (spec):
// national = gender + the exact normalised name tokens (never nameMatches — "show less, never guess"); international =
// World Climbing athlete id (row.aid), or — only for a row saved without an aid — the World Climbing name + country.
// data.wcAlias { personKey → aid } joins an Israeli's national and international results; data.nameMerges / opts.merges
// [[keyA, keyB], ...] join two national spellings of one person. Places / comps come from mine.js historyOf.
import { historyOf, compAge } from './mine.js';
export { compAge };
import { genderOf, wcKey } from './ifsc.js';

// Name → whole tokens (parentheses dropped, geresh/quote variants unified, hyphens split). Shared with src/match.mjs
// (Hub ↔ start-list matching), which re-exports it: only web/ ships to the browser.
export const tokens = s => s.replace(/\([^)]*\)/g, ' ').replace(/[׳'`"״]/g, "'").replace(/[-–־]/g, ' ')
  .split(/\s+/).filter(Boolean);
export const personKey = (name, gender) => gender + ':' + tokens(String(name ?? '')).join(' ');

// key + every key joined to it through merges (transitively). A pair whose two keys differ in gender ('M:' vs 'W:') is
// ignored: a bad merge never joins a man and a woman.
const genderPart = k => String(k).split(':')[0];
export function keysOf(key, merges) {
  const out = new Set(key ? [key] : []);
  for (let grew = true; grew;) {
    grew = false;
    for (const [a, b] of merges || []) {
      if (!a || !b || genderPart(a) !== genderPart(b)) continue;
      if (out.has(a) && !out.has(b)) { out.add(b); grew = true; }
      if (out.has(b) && !out.has(a)) { out.add(a); grew = true; }
    }
  }
  return out;
}

// who = { key?, aid?, wcName?, country?, gender } → historyOf shape (seasons newest first, current season)
export function athleteHistory(data, who, todayYmd, { locked, merges = [] } = {}) {
  const keys = keysOf(who?.key, merges), aid = who?.aid != null ? Number(who.aid) : null;
  const name = who?.wcName ? wcKey(who.wcName) : null, country = who?.country || null;
  const bibs = rows => new Set(rows.map(x => String(x.bib)));
  const pick = {
    national: (r, res) => (keys.size ? bibs((res.rows || []).filter(x => keys.has(personKey(x.name, genderOf(r.id))))) : new Set()),
    intl: (r, res) => bibs((res.rows || []).filter(x => (x.aid != null ? aid != null && Number(x.aid) === aid
      : !!name && !!country && x.country === country && wcKey(x.name) === name && (!who.gender || genderOf(r.id) === who.gender)))),
  };
  return historyOf(data, who ? pick : null, todayYmd, { locked });
}

// comps (historyOf comps, any order) → { count, best, avg, finals, trend } over the comps with a numeric place:
// overall place, or with cat: true the category place (comps without one skipped). avg 1 decimal; trend oldest first.
export function seasonSummary(comps, { cat = false } = {}) {
  const placeOf = c => (cat ? c.catPlace : c.overall ?? c.place);
  const ok = (comps || []).filter(c => typeof placeOf(c) === 'number' && Number.isFinite(placeOf(c)));
  const places = ok.map(placeOf);
  return { count: ok.length, best: ok.length ? Math.min(...places) : null,
    avg: ok.length ? Math.round((places.reduce((s, p) => s + p, 0) / ok.length) * 10) / 10 : null,
    finals: ok.filter(c => c.final).length,
    trend: ok.map((c, i) => [c, i]).sort(([a, i], [b, j]) => (a.date < b.date ? -1 : a.date > b.date ? 1 : i - j))
      .map(([c]) => ({ title: c.title, date: c.date, place: placeOf(c) })) };
}

// a tapped results row → who. National: key from name + the round's gender, aid from data.wcAlias looked up over the
// key's whole merge group (data.nameMerges) — used only when every alias found agrees (two different aids → none).
// International: the row's aid + name + country, and the national key aliased to that aid so an Israeli gets both —
// one key, or several that all sit in one merge group (→ the first); keys of different people → none.
export function whoFromRow(row, round, data) {
  const gender = genderOf(round?.id || ''), alias = data?.wcAlias || {}, merges = data?.nameMerges || [];
  if (!round?.ifsc) {
    const key = personKey(row?.name, gender);
    const aids = new Set([...keysOf(key, merges)].filter(k => alias[k] != null).map(k => Number(alias[k])));
    return { key, ...(aids.size === 1 ? { aid: [...aids][0] } : {}), gender };
  }
  const aid = row?.aid != null ? Number(row.aid) : null;
  const keys = aid == null ? [] : Object.keys(alias).filter(k => Number(alias[k]) === aid && k.startsWith(gender + ':'));
  const group = keys.length ? keysOf(keys[0], merges) : null, oneGroup = !!group && keys.every(k => group.has(k));
  return { ...(oneGroup ? { key: keys[0] } : {}), ...(aid != null ? { aid } : {}), wcName: row?.name,
    ...(row?.country ? { country: row.country } : {}), gender };
}
