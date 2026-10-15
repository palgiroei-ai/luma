// Boulder tagging (3.7.0) — taxonomy agreed with Roei 2026-10-14/15, see docs/specs/2026-10-14-boulder-tagging-taxonomy.md
// and the approved map docs/specs/2026-10-15-boulder-tagging-map.html. Ids are stored; labels are only for the screen.
// Do not change the lists mid-season (comparisons over time break).
// A tag per "round:b": { mode: 'whole' | 'split', zone, top, note }. Whole = same style start→top, saved into both sections.
// Section = { wall, style, feet: [] (slab only), sub: { questionId: [optionIds] } }. Wall + style: one choice (by the crux);
// everything else: several allowed (whatever shows up in the hard moves).
export const WALLS = [
  { id: 'slab', l: 'סלאב', h: 'פחות מאנכי' },
  { id: 'face', l: 'פייס', h: 'ורטיקלי' },
  { id: 'light', l: 'שלילי קל', h: 'עד 20°' },
  { id: 'strong', l: 'שלילי חזק', h: 'מעל 20°, כולל גג' },
  { id: 'corner', l: 'פינה', h: '' },
];
export const FEET = { id: 'feet', l: 'רגליים בסלאב', o: [{ id: 'jibs', l: "ג'יבים" }, { id: 'smear', l: 'סמירים' }] };
export const STYLES = [
  { id: 'phys', l: 'פיזי', d: 'הקושי בכוח: אחיזות קשות, מתיחה, תפיסה', q: [
    { id: 'holds', l: 'אחיזות', o: [{ id: 'crimp', l: 'קרימפים' }, { id: 'sloper', l: 'סלופרים' }, { id: 'pinch', l: "פינצ'ים" }, { id: 'pocket', l: 'פוקטים' }] },
    { id: 'moves', l: 'אופי המהלכים', o: [{ id: 'big', l: 'צעדים גדולים' }, { id: 'hold', l: 'להחזיק חזק' }, { id: 'compress', l: 'קומפרשן' }, { id: 'mantle', l: 'מנטל' }] }] },
  { id: 'tech', l: 'טכני', d: 'הקושי בגוף ובראש: איזון, רגליים, מיקום גוף', q: [
    { id: 'char', l: 'אופי', o: [{ id: 'balance', l: 'איזון ועדינות' }, { id: 'position', l: 'פתרון מיקום גוף' }, { id: 'flex', l: 'גמישות' }, { id: 'mantle', l: 'מנטל' }] }] },
  { id: 'coord', l: 'קואורדינציה', d: 'רצף תנועות מתוזמן. הקושי בתזמון', q: [
    { id: 'type', l: 'סוג', o: [
      { id: 'catch-swing', l: 'תפיסה וסווינג', h: 'תופס, הרגליים עפות, שולט בסווינג' },
      { id: 'dyno', l: 'דיינו', h: 'קפיצה ליד אחת' },
      { id: 'double-dyno', l: 'דאבל דיינו', h: 'שתי ידיים לשתי אחיזות' },
      { id: 'catch', l: "קאץ'", h: 'תפיסה ברגל, למשל toe hook' },
      { id: 'feet', l: 'רגליים', h: 'הרגליים מייצרות את התנופה' },
      { id: 'hands', l: 'ידיים', h: 'רצף מגעים שהידיים מניעות' },
      { id: 'pendulum', l: 'פנדולום', h: 'תנופת גוף שעוברת למהלך הבא' },
      { id: 'other', l: 'אחר' }] }] },
  { id: 'elec', l: 'אלקטרי', d: 'תנועה נפיצה אחת או שתיים בין מצבים סטטיים', q: [
    { id: 'type', l: 'סוג', o: [{ id: 'paddle', l: 'פאדל' }, { id: 'neg-jump', l: 'קפיצה בשלילי' }, { id: 'other', l: 'אחר' }] }] },
];
export const styleOf = id => STYLES.find(s => s.id === id) || null;
export const wallOf = id => WALLS.find(w => w.id === id) || null;

const pick = (vals, opts) => {
  const ok = new Set(opts.map(o => o.id));
  return [...new Set(Array.isArray(vals) ? vals : [])].filter(v => ok.has(v));
};
function normSec(x) {
  x = x && typeof x === 'object' ? x : {};
  const wall = wallOf(x.wall)?.id || null, st = styleOf(x.style);
  const sub = {};
  for (const q of st?.q || []) { const v = pick(x.sub?.[q.id], q.o); if (v.length) sub[q.id] = v; }
  return { wall, style: st?.id || null, feet: wall === 'slab' ? pick(x.feet, FEET.o) : [], sub };
}
export function normTag(t) {
  if (!t || typeof t !== 'object') return null;
  const mode = t.mode === 'whole' ? 'whole' : 'split';
  const zone = normSec(t.zone);
  const out = { mode, zone, top: mode === 'whole' ? structuredClone(zone) : normSec(t.top) };
  const note = String(t.note ?? '').trim().slice(0, 500);
  if (note) out.note = note;
  return out;
}
// what viewers (parents/athletes) see on the board: wall + style only (the server strips the same way)
export function viewTag(t) {
  if (!t) return null;
  const s = x => ({ wall: x?.wall || null, style: x?.style || null });
  return { mode: t.mode === 'whole' ? 'whole' : 'split', zone: s(t.zone), top: s(t.top) };
}
