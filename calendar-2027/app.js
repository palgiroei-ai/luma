import { decryptJSON } from './decrypt.js';
import { toICS } from './ics.js';

const KEY = { code: 'cal27:code', state: 'cal27:state', marks: 'cal27:marks' };
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const DOW_LONG = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];
const DISC = { boulder: 'בולדר', lead: 'הובלה', speed: 'מהירות' };
const AGE = { youth: 'נוער', senior: 'בוגרים' };
const ACADEMY = new Set(['strength', 'climbing', 'camp']);
const TRAINING = new Set(['strength', 'climbing']);
const NARROW = 760;

const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: just don't remember */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k != null) n.append(k);
  return n;
};

const parse = d => { const [y, m, dd] = d.split('-').map(Number); return { y, m: m - 1, d: dd }; };
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const short = d => { const p = parse(d); return `${p.d}.${p.m + 1}`; };
const long = d => { const p = parse(d); return `${DOW_LONG[dow(d)]} ${p.d}.${p.m + 1}.${p.y}`; };
// LTR-isolated so ranges don't flip inside Hebrew text.
const span = e => '\u2066' + (e.start === e.end ? short(e.start) : `${short(e.start)}–${short(e.end)}`) + '\u2069';

// Readable text on a category color.
function ink(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.3 ? '#14243B' : '#FFFFFF';
}

let D;            // decrypted payload
let CAT;          // key → category
let state;        // { cats: {key: bool}, age, disc: [], view }
let marks;        // Set of event ids

const defaults = () => ({
  cats: Object.fromEntries(D.categories.map(c => [c.key, c.on])),
  age: 'all', disc: [], view: innerWidth < NARROW ? 'list' : 'grid',
});

function visible(e) {
  if (!state.cats[e.cat]) return false;
  if (e.cat === 'holiday' || ACADEMY.has(e.cat)) return true;
  if (state.age !== 'all' && !e.ages.includes(state.age)) return false;
  if (state.disc.length && !e.disc.some(d => state.disc.includes(d))) return false;
  return true;
}
const save = () => store.set(KEY.state, state);
const saveMarks = () => store.set(KEY.marks, [...marks]);

/* ---------- gate ---------- */

async function unlock(code) {
  const res = await fetch('data.enc.json', { cache: 'no-cache' });
  const data = await decryptJSON(await res.json(), code);
  if (!data) return false;
  D = data;
  CAT = Object.fromEntries(D.categories.map(c => [c.key, c]));
  store.set(KEY.code, code);
  return true;
}

async function boot() {
  const saved = store.get(KEY.code);
  if (saved && await unlock(saved)) return start();
  if (saved) store.del(KEY.code); // code changed since last visit
  $('#gate').hidden = false;
  $('#code').focus();
  $('#gate-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#gate-btn');
    btn.disabled = true; btn.textContent = 'בודק…';
    $('#gate-error').hidden = true;
    const ok = await unlock($('#code').value.trim()).catch(() => false);
    btn.disabled = false; btn.textContent = 'כניסה';
    if (ok) { $('#gate').hidden = true; start(); }
    else { $('#gate-error').hidden = false; $('#code').select(); }
  });
}

/* ---------- app ---------- */

function start() {
  const s = store.get(KEY.state);
  const def = defaults();
  state = s && s.cats ? { ...def, ...s, cats: { ...def.cats, ...s.cats } } : def;
  if (innerWidth < NARROW) state.view = 'list'; // the year grid doesn't fit a phone
  marks = new Set((store.get(KEY.marks) || []).filter(id => D.events.some(e => e.id === id)));

  $('#title').textContent = D.title;
  const r0 = parse(D.range.from), r1 = parse(D.range.to);
  $('#range').textContent = `${MONTHS[r0.m]} ${r0.y} – ${MONTHS[r1.m]} ${r1.y}`;
  $('#source').textContent = `${D.sourceNote} עודכן ${short(D.generated)}.${parse(D.generated).y}.`;
  $('#app').hidden = false;

  buildFilters();
  wire();
  render();
}

function buildFilters() {
  const box = $('#cat-groups');
  box.replaceChildren();
  for (const g of D.groups) {
    const cats = D.categories.filter(c => c.group === g.key);
    const head = el('button', { type: 'button', className: 'group-toggle', textContent: g.label, title: 'הדלקה / כיבוי של כל הקבוצה' });
    head.addEventListener('click', () => {
      const anyOff = cats.some(c => !state.cats[c.key]);
      cats.forEach(c => { state.cats[c.key] = anyOff; });
      save(); render();
    });
    const chips = el('div', { className: 'chips' });
    for (const c of cats) chips.append(catChip(c));
    box.append(el('div', { className: 'group' }, head, chips));
  }
  const hol = D.categories.find(c => c.key === 'holiday');
  box.append(el('div', { className: 'group' }, el('span', { className: 'group-toggle static', textContent: 'לוח שנה' }),
    el('div', { className: 'chips' }, catChip(hol))));
}

function catChip(c) {
  const b = el('button', { type: 'button', className: 'chip cat-chip' },
    el('span', { className: 'sw', style: `background:${c.color}` }), el('span', { textContent: c.label }));
  b.dataset.cat = c.key;
  b.addEventListener('click', () => { state.cats[c.key] = !state.cats[c.key]; save(); render(); });
  return b;
}

function wire() {
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; save(); render(); }));
  document.querySelectorAll('[data-age]').forEach(b => b.addEventListener('click', () => {
    state.age = b.dataset.age;
    // Asking for senior events while they're switched off would show nothing — switch them on.
    if (state.age === 'senior') D.categories.filter(c => c.group === 'intl-senior').forEach(c => { state.cats[c.key] = true; });
    save(); render();
  }));
  document.querySelectorAll('[data-disc]').forEach(b => b.addEventListener('click', () => {
    const d = b.dataset.disc;
    state.disc = state.disc.includes(d) ? state.disc.filter(x => x !== d) : [...state.disc, d];
    save(); render();
  }));
  $('#filters-toggle').addEventListener('click', () => {
    const open = $('#filters').classList.toggle('open');
    $('#filters-toggle').setAttribute('aria-expanded', String(open));
  });
  $('#reset').addEventListener('click', () => { state = { ...defaults(), view: state.view }; save(); render(); });

  const menu = $('#dl-menu'), btn = $('#dl-btn');
  const setMenu = open => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', ev => { ev.stopPropagation(); setMenu(menu.hidden); });
  document.addEventListener('click', ev => { if (!menu.contains(ev.target)) setMenu(false); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') setMenu(false); });
  $('#dl-marked').addEventListener('click', () => { download(D.events.filter(e => marks.has(e.id)), 'אקדמיה-מסומנים.ics'); setMenu(false); });
  $('#dl-visible').addEventListener('click', () => { download(exportable(), 'אקדמיה-לוח-שנתי.ics'); setMenu(false); });
  $('#dl-print').addEventListener('click', () => { setMenu(false); print(); });
  $('#clear-marks').addEventListener('click', () => { marks.clear(); saveMarks(); render(); setMenu(false); });

  $('#d-mark').addEventListener('click', () => {
    const id = $('#detail').dataset.id;
    marks.has(id) ? marks.delete(id) : marks.add(id);
    saveMarks(); fillDetail(D.events.find(e => e.id === id)); render();
  });
  $('#d-ics').addEventListener('click', () => {
    const e = D.events.find(x => x.id === $('#detail').dataset.id);
    download([e], 'אירוע.ics');
  });
  $('#detail').addEventListener('click', ev => { if (ev.target === $('#detail')) $('#detail').close(); });

  let wasNarrow = innerWidth < NARROW;
  addEventListener('resize', () => {
    const n = innerWidth < NARROW;
    if (n !== wasNarrow) { wasNarrow = n; if (n && state.view === 'grid') { state.view = 'list'; render(); } }
  });
}

const exportable = () => D.events.filter(e => e.cat !== 'holiday' && visible(e));

function download(events, name) {
  if (!events.length) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ics = toICS(events, { all: D.events, stamp, catLabel: e => CAT[e.cat].label });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function render() {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  document.querySelectorAll('[data-age]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.age === state.age)));
  document.querySelectorAll('[data-disc]').forEach(b => b.setAttribute('aria-pressed', String(state.disc.includes(b.dataset.disc))));
  document.querySelectorAll('.cat-chip').forEach(b => {
    const on = state.cats[b.dataset.cat];
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.sw').style.opacity = on ? 1 : .35;
  });

  const nMarked = marks.size, nVis = exportable().length;
  $('#dl-marked').textContent = `האירועים שסימנתי (${nMarked})`;
  $('#dl-marked').disabled = !nMarked;
  $('#dl-visible').textContent = `כל מה שמוצג עכשיו (${nVis})`;
  $('#dl-visible').disabled = !nVis;
  $('#clear-marks').hidden = !nMarked;
  $('#dl-btn').textContent = nMarked ? `הורדה ליומן · ${nMarked} ✓` : 'הורדה ליומן';

  const off = D.categories.filter(c => !state.cats[c.key]).length;
  const extra = (state.age !== 'all' ? 1 : 0) + state.disc.length;
  $('#filters-summary').textContent = `· ${D.categories.length - off} קטגוריות${extra ? ` · ${extra} מסננים` : ''}`;

  const view = $('#view');
  view.replaceChildren(state.view === 'grid' ? gridView() : listView());
}

function months() {
  const out = [];
  const a = parse(D.range.from), b = parse(D.range.to);
  for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 11 ? (y++, m = 0) : m++) out.push({ y, m });
  return out;
}

// Events overlapping a month, clipped to it, with day numbers.
function inMonth(events, y, m) {
  const first = iso(y, m, 1), last = iso(y, m, daysIn(y, m));
  return events.filter(e => e.start <= last && e.end >= first).map(e => ({
    e, from: e.start < first ? 1 : parse(e.start).d, to: e.end > last ? daysIn(y, m) : parse(e.end).d,
    contL: e.start < first, contR: e.end > last,
  }));
}

function lanes(items) {
  const ends = [];
  for (const it of items.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from))) {
    let i = ends.findIndex(end => end < it.from);
    if (i < 0) { i = ends.length; ends.push(0); }
    ends[i] = it.to; it.lane = i;
  }
  return ends.length;
}

function openDetail(e) { fillDetail(e); $('#detail').dataset.id = e.id; $('#detail').showModal(); }

function fillDetail(e) {
  const c = CAT[e.cat];
  $('#d-cat').replaceChildren(el('span', { className: 'sw', style: `background:${c.color}` }), c.label);
  $('#d-title').textContent = e.title;
  $('#d-sub').textContent = e.sub || '';
  $('#d-sub').hidden = !e.sub;
  $('#d-dates').textContent = e.start === e.end ? long(e.start) : `${long(e.start)} – ${long(e.end)}`;
  const tags = [...(e.ages || []).map(a => AGE[a]), ...(e.disc || []).map(d => DISC[d])];
  $('#d-tags').replaceChildren(...tags.map(t => el('span', { className: 'tag', textContent: t })));
  $('#d-tags').hidden = !tags.length;
  $('#d-note').textContent = e.note || '';
  $('#d-note').hidden = !e.note;
  $('#d-note').classList.toggle('tentative', !!e.tentative);
  const markable = e.cat !== 'holiday';
  $('#d-mark').hidden = !markable; $('#d-ics').hidden = !markable;
  $('#d-mark').textContent = marks.has(e.id) ? '✓ מסומן · ביטול' : 'סימון';
}

function evButton(e, cls, text) {
  const c = CAT[e.cat];
  const b = el('button', { type: 'button', className: cls + (marks.has(e.id) ? ' marked' : '') + (e.tentative ? ' tentative' : ''),
    title: `${e.title}${e.sub ? ' – ' + e.sub : ''} · ${span(e)}` }, ...text);
  b.style.setProperty('--c', c.color);
  b.style.setProperty('--ink', ink(c.color));
  b.addEventListener('click', () => openDetail(e));
  return b;
}

/* ---------- year grid ---------- */

function gridView() {
  const vis = D.events.filter(visible);
  const wrap = el('div', { className: 'grid-scroll' });
  const year = el('div', { className: 'year' });
  wrap.append(year);
  let lastY;
  for (const { y, m } of months()) {
    const n = daysIn(y, m);
    const all = inMonth(vis, y, m);
    const comps = all.filter(x => !TRAINING.has(x.e.cat) && x.e.cat !== 'holiday');
    const trains = all.filter(x => TRAINING.has(x.e.cat));
    const hols = all.filter(x => x.e.cat === 'holiday');
    const L = Math.max(1, lanes(comps));
    const row = el('div', { className: 'month' });
    row.style.gridTemplateRows = `auto repeat(${L}, var(--lane)) var(--train) ${hols.length ? 'var(--hol)' : '6px'}`;

    const label = el('div', { className: 'm-label' }, el('strong', { textContent: MONTHS[m] }), y !== lastY ? el('span', { textContent: y }) : null);
    label.style.gridRow = `1 / -1`;
    row.append(label);
    lastY = y;

    for (let d = 1; d <= 31; d++) {
      const date = d <= n ? iso(y, m, d) : null;
      const head = el('div', { className: 'd-head' + (!date ? ' void' : dow(date) === 6 ? ' sat' : '') },
        date ? el('b', { textContent: d }) : null, date ? el('i', { textContent: DOW[dow(date)] }) : null);
      head.style.gridColumn = d + 1;
      row.append(head);
      const col = el('div', { className: 'd-col' + (!date ? ' void' : dow(date) === 6 ? ' sat' : '') });
      col.style.gridColumn = d + 1; col.style.gridRow = '2 / -1';
      row.append(col);
    }
    for (const h of hols) {
      const shade = el('div', { className: 'hol-shade' });
      shade.style.gridColumn = `${h.from + 1} / ${h.to + 2}`; shade.style.gridRow = '2 / -1';
      row.append(shade);
      const b = evButton(h.e, 'hol-label', [h.e.title]);
      b.style.gridColumn = `${h.from + 1} / ${h.to + 2}`; b.style.gridRow = String(L + 3);
      row.append(b);
    }
    for (const it of comps) {
      const b = evButton(it.e, 'bar' + (it.contL ? ' cont-l' : '') + (it.contR ? ' cont-r' : ''),
        [el('span', { className: 'bar-t', textContent: it.e.title }), it.e.sub ? el('span', { className: 'bar-s', textContent: it.e.sub }) : null]);
      b.style.gridColumn = `${it.from + 1} / ${it.to + 2}`; b.style.gridRow = String(it.lane + 2);
      row.append(b);
    }
    for (const it of trains) {
      const b = evButton(it.e, 'tick', [it.e.cat === 'strength' ? 'כ' : 'ט']);
      b.setAttribute('aria-label', `${CAT[it.e.cat].label} ${long(it.e.start)}`);
      b.style.gridColumn = String(it.from + 1); b.style.gridRow = String(L + 2);
      row.append(b);
    }
    year.append(row);
  }
  const legend = el('p', { className: 'legend muted small' },
    el('span', { className: 'tick-demo', style: `--c:${CAT.strength.color};--ink:#fff`, textContent: 'כ' }), ' אימון כוח  ',
    el('span', { className: 'tick-demo', style: `--c:${CAT.climbing.color};--ink:#fff`, textContent: 'ט' }), ' אימון טיפוס  · לחיצה על אירוע פותחת פרטים וסימון.');
  return el('div', {}, legend, wrap);
}

/* ---------- list ---------- */

function listView() {
  const vis = D.events.filter(visible);
  const box = el('div', { className: 'list' });
  for (const { y, m } of months()) {
    const all = inMonth(vis, y, m);
    if (!all.length) continue;
    const card = el('section', { className: 'm-card' }, el('h2', {}, `${MONTHS[m]} `, el('span', { className: 'muted', textContent: y })));
    const comps = all.filter(x => !TRAINING.has(x.e.cat) && x.e.cat !== 'holiday').sort((a, b) => a.e.start.localeCompare(b.e.start));
    const ul = el('ul', { className: 'ev-list' });
    for (const { e } of comps) {
      const c = CAT[e.cat];
      const markBtn = el('button', { type: 'button', className: 'mark-btn' + (marks.has(e.id) ? ' on' : ''), textContent: '✓',
        ariaLabel: marks.has(e.id) ? 'ביטול סימון' : 'סימון', ariaPressed: String(marks.has(e.id)) });
      markBtn.addEventListener('click', () => { marks.has(e.id) ? marks.delete(e.id) : marks.add(e.id); saveMarks(); render(); });
      const body = el('button', { type: 'button', className: 'ev-body' },
        el('span', { className: 'ev-date', textContent: span(e) }),
        el('span', { className: 'ev-text' }, el('b', { textContent: e.title }), e.sub ? el('span', { textContent: e.sub }) : null,
          e.title.includes(c.label) && !e.tentative ? null : el('span', { className: 'ev-cat', textContent: e.tentative ? 'תאריך ומיקום ייקבעו בהמשך' : c.label })));
      body.addEventListener('click', () => openDetail(e));
      const li = el('li', { className: 'ev' }, el('span', { className: 'ev-sw', style: `background:${c.color}` }), body, markBtn);
      ul.append(li);
    }
    if (comps.length) card.append(ul);
    for (const cat of ['strength', 'climbing']) {
      const t = all.filter(x => x.e.cat === cat);
      if (!t.length) continue;
      const row = el('div', { className: 'train-row' }, el('span', { className: 'train-label' },
        el('span', { className: 'ev-sw', style: `background:${CAT[cat].color}` }), CAT[cat].label));
      const days = el('div', { className: 'train-days' });
      for (const { e } of t) days.append(evButton(e, 'day-chip', [`${DOW[dow(e.start)]}׳ ${parse(e.start).d}`]));
      row.append(days); card.append(row);
    }
    const hols = all.filter(x => x.e.cat === 'holiday');
    if (hols.length) card.append(el('p', { className: 'hol-line muted small', textContent: hols.map(h => `${h.e.title} ${span(h.e)}`).join(' · ') }));
    box.append(card);
  }
  if (!box.children.length) box.append(el('p', { className: 'empty muted', textContent: 'אין אירועים לפי הסינון הנוכחי.' }));
  return box;
}

boot();
