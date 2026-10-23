// 3.11.0 (Roei 2026-10-16): the events list is split into seasons. 3.12.3 (Roei): by time — international (intl-2025-26) first,
// then the current national season. 3.15.0: the season list comes from the events present (app events can bring new
// seasons): ids 'intl-YYYY-YY' / 'nat-YYYY-YY', ordered by when each season starts — intl-Y = calendar year Y+1 (the app's
// rule), nat-Y = from 1 September Y. An event without `season` (payload from an older build) counts as national nat-2026-27.
const NAT = 'nat-2026-27';
const SEASON_RE = /^(intl|nat)-(\d{4})-(\d{2})$/;
const sid = id => id || NAT;
// 'intl-2025-26' → '2026-01-01', 'nat-2026-27' → '2026-09-01' (unknown ids sort last)
export const seasonStart = id => { const m = SEASON_RE.exec(sid(id)); return !m ? '9999' : m[1] === 'intl' ? `${Number(m[2]) + 1}-01-01` : `${m[2]}-09-01`; };
// last day: intl-Y = 31 Dec Y+1, nat-Y = 31 Aug Y+1 ("שלי": which season is running today)
export const seasonEnd = id => { const m = SEASON_RE.exec(sid(id)); return !m ? '0000' : `${Number(m[2]) + 1}-${m[1] === 'intl' ? '12-31' : '08-31'}`; };
// 3.18.1 (Roei): a season is named by ONE year — international = its calendar year ('intl-2025-26' → 2026), national = the
// international season it leads into ('nat-2026-27', Sept 2026–Aug 2027 → 2027). Both = the id's first year + 1; ids unchanged.
export const seasonLabel = id => { const m = SEASON_RE.exec(sid(id)); return m ? `${m[1] === 'intl' ? 'עונה בינלאומית' : 'עונה לאומית'} ${Number(m[2]) + 1}` : ''; };
const seasonCmp = (a, b) => (seasonStart(a) < seasonStart(b) ? -1 : seasonStart(a) > seasonStart(b) ? 1 : sid(a) < sid(b) ? -1 : sid(a) > sid(b) ? 1 : 0);
// events → [{ id, label }] of the seasons they use, in season order
export function seasonsOf(events) {
  return [...new Set(events.map(e => sid(e?.season)))].sort(seasonCmp).map(id => ({ id, label: seasonLabel(id) }));
}
// items { event, dates } → season order, then by first date (stable); the app's event indices (data-ev) follow this order
export function bySeason(list) {
  return [...list].sort((a, b) => seasonCmp(a.event.season, b.event.season) || (a.dates[0] < b.dates[0] ? -1 : a.dates[0] > b.dates[0] ? 1 : 0));
}
// 3.15.0: an event the Palgi app cancelled keeps its card with a "בוטל" tag; date / place not final yet → "משוער"
export const CANCEL_TAG = '<span class="hb done">בוטל</span>';
export const tbdMark = on => (on ? ' <span class="tbd">משוער</span>' : '');

export const TYPES = { wc: 'גביע עולם', ec: 'גביע אירופה', wch: 'אליפות עולם', ech: 'אליפות אירופה', league: 'ליגה', ich: 'אליפות ישראל' };
const PLURAL = { wc: 'גביעי עולם', ec: 'גביעי אירופה', wch: 'אליפויות עולם', ech: 'אליפויות אירופה', league: 'ליגות', ich: 'אליפויות ישראל' };
export const AGES = { senior: 'בוגרים', youth: 'נוער' };
export const DISC = { B: 'בולדר', L: 'הובלה' };
// 3.14.0 (Roei): catalog fields; an older payload without them → national = league, international = World Cup, seniors, boulder
export const evMeta = e => ({ type: e?.type || (e?.intl ? 'wc' : 'league'), age: e?.age || 'senior', disc: e?.disc?.length ? e.disc : ['B'] });
// 3.18.0 (Roei): a competition's colour = the Palgi app's season colours — World Cup blue, European Cup orange, European
// Youth Cup green, championships (world / Europe / Israel) gold, league red
export function evTone(e) {
  const m = evMeta(e);
  return m.type === 'ec' ? (m.age === 'youth' ? 'eyc' : 'ec') : ['wch', 'ech', 'ich'].includes(m.type) ? 'ch' : m.type === 'league' ? 'il' : 'wc';
}
const CODE = { wc: 'WC', ec: 'EC', wch: 'WCH', ech: 'ECH' };
export function evCode(e) {
  const m = evMeta(e), c = CODE[m.type]; if (!c) return '';
  return `${m.age === 'youth' ? c[0] + 'Y' + c.slice(1) : c}-${['B', 'L'].filter(d => m.disc.includes(d)).join('')}`;
}
export function filterOptions(events) {
  const ms = events.map(evMeta), has = (k, v) => ms.some(m => (k === 'disc' ? m.disc.includes(v) : m[k] === v));
  return { disc: Object.keys(DISC).filter(v => has('disc', v)), type: Object.keys(TYPES).filter(v => has('type', v)), age: Object.keys(AGES).filter(v => has('age', v)) };
}
// the filter that actually applies in a season: a hidden row (< 2 options) or a value this season doesn't offer is ignored
export function effectiveFilter(f, opts) {
  return Object.fromEntries(Object.keys(opts).map(k => [k, opts[k].length < 2 ? [] : (f[k] || []).filter(v => opts[k].includes(v))]));
}
export function filterEvents(items, f) {
  return items.filter(({ event }) => { const m = evMeta(event);
    return (!f.disc?.length || m.disc.some(d => f.disc.includes(d))) && (!f.type?.length || f.type.includes(m.type)) && (!f.age?.length || f.age.includes(m.age)); });
}
export function seasonSummary(events) {
  const n = {}; for (const e of events) { const t = evMeta(e).type; n[t] = (n[t] || 0) + 1; }
  const parts = Object.keys(TYPES).filter(t => n[t]).map(t => (n[t] > 1 ? `${n[t]} ${PLURAL[t]}` : TYPES[t]));
  return [events.length === 1 ? 'תחרות אחת' : `${events.length} תחרויות`, ...parts].join(' · ');
}
// the "עכשיו" strip: a live competition, else the nearest upcoming one within 7 days, else none (-1)
export function pickNow(items, phaseOf, todayOf) {
  const live = items.findIndex(x => phaseOf(x) === 'live'); if (live >= 0) return live;
  const days = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 864e5);
  let best = -1;
  items.forEach((x, i) => { if (phaseOf(x) === 'before' && days(x.dates[0], todayOf(x)) <= 7 && (best < 0 || x.dates[0] < items[best].dates[0])) best = i; });
  return best;
}
