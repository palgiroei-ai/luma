// One Hebrew formatter for categories, round titles and times (portal consistency round, Task 2).
// Data titles (src/rounds.mjs, src/ifscRounds.mjs) and old notes keep their words; they are relabelled here, at render.
// This file (and changelog.js) is the only place allowed to contain the data words "סיבוב" / "סבב".
import { zoneParts, TZ } from './engine.js';

// age: 'S' | 'Senior' | 'U21' | 'U19' | 'U17' | 'U15' | 'U13' … | null; gender 'M' | 'W'
export function catHe(age, gender) {
  if (!age) return '';
  const w = gender === 'W';
  if (age === 'S' || age === 'Senior') return w ? 'בוגרות' : 'בוגרים';
  const n = +String(age).replace(/\D/g, '');
  if (!n) return '';
  return `${n >= 17 ? (w ? 'נערות' : 'נערים') : (w ? 'ילדות' : 'ילדים')} U${n}`;
}

const STAGE = { ראשון: 1, שני: 2, שלישי: 3, רביעי: 4, חמישי: 5 };
// the first part of a round title → the category label (or null when it is not a category)
function headHe(h) {
  if (h === 'בוגרים' || h === 'בוגרות') return h;
  let m = /^(גברים|נשים)(?: U(\d+))?$/.exec(h);
  if (m) return m[2] ? catHe('U' + m[2], m[1] === 'נשים' ? 'W' : 'M') : (m[1] === 'נשים' ? 'בוגרות' : 'בוגרים');
  m = /^U(\d+) (בנים|בנות)$/.exec(h);
  if (m) return catHe('U' + m[1], m[2] === 'בנות' ? 'W' : 'M');
  return null;
}
export function roundTitle(title) {
  if (!title) return '';
  const parts = String(title).split(' · ');
  const out = parts.map((p, i) => {
    if (i === 0) { const h = headHe(p); if (h) return h; }
    const m = /^סיבוב (\S+)$/.exec(p);
    if (m && STAGE[m[1]]) return `ראונד ${STAGE[m[1]]}`;
    return p;
  });
  return out.join(' · ');
}

const pad = n => String(n).padStart(2, '0');
// times are in the venue zone (default Israel), whatever zone the device is in
export const hm = (t, tz = TZ) => { const d = zoneParts(+t, tz); return `${pad(d.h)}:${pad(d.mi)}`; };
export const hms = (t, tz = TZ) => { const d = zoneParts(+t, tz); return `${d.h}:${pad(d.mi)}:${pad(d.s)}`; };
// start–end, always written in one direction inside an LTR isolate
export const range = (a, b) => `⁦${a}–${b}⁩`;

// the place of an event, unless its name already says it ("… · Santiago, CHI"); "Santiago" vs "Santiago, CHI", any case
export function placeOnce(name, place) {
  const base = String(place || '').split(',')[0].trim().toLowerCase();
  if (!base) return '';
  return String(name || '').toLowerCase().includes(base) ? '' : place;
}
// national official results: "ההתאחדות · תוצאות רשמיות · <file>" (the data string is "<file> (details)")
export function fileSource(src) {
  return `ההתאחדות · תוצאות רשמיות · ${String(src || '').replace(/\s*\(.*\)\s*$/, '')}`;
}
