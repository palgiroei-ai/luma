// iCalendar (.ics) export for the annual calendar. Pure — no DOM.
// Events are all-day: { id, cat, title, sub?, note?, start, end, series? } with 'YYYY-MM-DD' dates.

const DOMAIN = 'luma.palgitraining.com';
const DAY = 86400000;
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const ms = d => Date.parse(d + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);
const icsDate = d => d.replaceAll('-', '');
const nextDay = d => iso(ms(d) + DAY);
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 §3.1: lines of at most 75 octets, continuation lines start with a space.
function fold(line) {
  const enc = new TextEncoder();
  const parts = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { parts.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n');
}

function vevent(uid, e, { stamp, catLabel }, extra = []) {
  const summary = e.sub ? `${e.title} – ${e.sub}` : e.title;
  const desc = [catLabel(e), e.note].filter(Boolean).join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@${DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(e.start)}`,
    `DTEND;VALUE=DATE:${icsDate(nextDay(e.end))}`,
    ...extra,
    `SUMMARY:${esc(summary)}`,
    ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

// A series exported in full becomes one weekly RRULE; the rule's dates that have no
// instance (competition weeks, holidays) become EXDATEs.
function seriesEvent(name, items, o) {
  const dates = items.map(e => e.start).sort();
  const have = new Set(dates);
  const days = [...new Set(dates.map(d => new Date(ms(d)).getUTCDay()))].sort();
  const first = dates[0], last = dates[dates.length - 1];
  const ex = [];
  for (let t = ms(first); t <= ms(last); t += DAY) {
    const d = iso(t);
    if (days.includes(new Date(t).getUTCDay()) && !have.has(d)) ex.push(icsDate(d));
  }
  const rule = [`RRULE:FREQ=WEEKLY;BYDAY=${days.map(d => BYDAY[d]).join(',')};UNTIL=${icsDate(last)}`];
  if (ex.length) rule.push(`EXDATE;VALUE=DATE:${ex.join(',')}`);
  const { note, ...base } = items[0];
  return vevent(`series-${name}`, { ...base, start: first, end: first }, o, rule);
}

/** @param events events to export; opts.all = every event (to tell whether a series is complete) */
export function toICS(events, { all, stamp, catLabel = () => '', calName = 'לוח פעילות אקדמיה' }) {
  const seriesSize = new Map();
  for (const e of all) if (e.series) seriesSize.set(e.series, (seriesSize.get(e.series) || 0) + 1);
  const bySeries = new Map();
  for (const e of events) if (e.series) bySeries.set(e.series, [...(bySeries.get(e.series) || []), e]);

  const o = { stamp, catLabel };
  const out = [];
  for (const [name, items] of bySeries)
    if (items.length === seriesSize.get(name)) out.push(...seriesEvent(name, items, o));
  for (const e of events)
    if (!e.series || bySeries.get(e.series).length !== seriesSize.get(e.series)) out.push(...vevent(e.id, e, o));

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//LUMA//${DOMAIN}//HE`, 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${esc(calName)}`, 'X-WR-TIMEZONE:Asia/Jerusalem', ...out, 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}
