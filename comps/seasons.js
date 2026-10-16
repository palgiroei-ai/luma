// 3.11.0 (Roei 2026-10-16): the events list is split into seasons — national first, then international.
// An event without `season` (payload from an older build) counts as national.
export const SEASONS = [
  { id: 'nat-2026-27', label: 'עונה לאומית 2026-7' },
  { id: 'intl-2025-26', label: 'עונה בינלאומית 2025-6' },
];
const seasonIdx = id => { const i = SEASONS.findIndex(s => s.id === (id || SEASONS[0].id)); return i < 0 ? SEASONS.length : i; };
export const seasonLabel = id => SEASONS[seasonIdx(id)]?.label || '';
// items { event, dates } → season order, then by first date (stable); the app's event indices (data-ev) follow this order
export function bySeason(list) {
  return [...list].sort((a, b) => seasonIdx(a.event.season) - seasonIdx(b.event.season) || (a.dates[0] < b.dates[0] ? -1 : a.dates[0] > b.dates[0] ? 1 : 0));
}
