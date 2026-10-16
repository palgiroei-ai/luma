// 3.11.0 (Roei 2026-10-16): the events list is split into seasons. 3.12.3 (Roei): by time — international 2025-6 first,
// then the current national season (order: intl 2025-6, then national). An event without `season` (payload from an older build) counts as national.
export const SEASONS = [
  { id: 'intl-2025-26', label: 'עונה בינלאומית 2025-6' },
  { id: 'nat-2026-27', label: 'עונה לאומית 2026-7' },
];
const NAT = 'nat-2026-27';
const seasonIdx = id => { const i = SEASONS.findIndex(s => s.id === (id || NAT)); return i < 0 ? SEASONS.length : i; };
export const seasonLabel = id => SEASONS[seasonIdx(id)]?.label || '';
// items { event, dates } → season order, then by first date (stable); the app's event indices (data-ev) follow this order
export function bySeason(list) {
  return [...list].sort((a, b) => seasonIdx(a.event.season) - seasonIdx(b.event.season) || (a.dates[0] < b.dates[0] ? -1 : a.dates[0] > b.dates[0] ? 1 : 0));
}

export const TYPES = { wc: 'גביע עולם', ec: 'גביע אירופה', wch: 'אליפות עולם', ech: 'אליפות אירופה', league: 'ליגה', ich: 'אליפות ישראל' };
const PLURAL = { wc: 'גביעי עולם', ec: 'גביעי אירופה', wch: 'אליפויות עולם', ech: 'אליפויות אירופה', league: 'ליגות', ich: 'אליפויות ישראל' };
export const AGES = { senior: 'בוגרים', youth: 'נוער' };
export const DISC = { B: 'בולדר', L: 'הובלה' };
// 3.14.0 (Roei): catalog fields; an older payload without them → national = league, international = World Cup, seniors, boulder
export const evMeta = e => ({ type: e?.type || (e?.intl ? 'wc' : 'league'), age: e?.age || 'senior', disc: e?.disc?.length ? e.disc : ['B'] });
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
