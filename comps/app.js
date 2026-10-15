import { decryptJSON } from './decrypt.js';
import { stateAt, athleteStatus, slotStartMs, roundStart, syncWindowNow, delayOffset, syncSlotNow, syncManualStart, windowCount, alertPlan, climbOverlaps, zonedMs, zoneParts, deviceOffZone } from './engine.js';
import { store } from './store.js';
import { startSync, startViewSync, syncNow, syncState, authHeaders, apiKey, SYNC_URL } from './sync.js';
import { CHANGELOG } from './changelog.js';
import { rankRows, analyze, boulderStats, pts, kind, r1, catOptions, catLabel, rankInCats, isLastRound, finalStandings } from './results.js';
import { setupInstall } from './install.js';
import { liveRows, liveGroup, fetchLive, liveEvents } from './live.js';
import { quota } from './results.js';
import { WALLS, STYLES, FEET, styleOf, wallOf } from './tags.js';

export const APP_VERSION = '3.10.0';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- clock (?at=2026-10-13T10:30:00&speed=10 → simulated clock for previews) ----
const params = new URLSearchParams(location.search);
const SIM_AT = params.get('at') ? zonedMs(params.get('at')) : null; // venue (Israel) time
const SIM_SPEED = Number(params.get('speed')) || 1;
const T_LOAD = Date.now();
const now = () => (SIM_AT == null ? Date.now() : SIM_AT + (Date.now() - T_LOAD) * SIM_SPEED);
const simFired = new Set();
const fired = { was: k => (SIM_AT == null ? store.wasFired(k) : simFired.has(k)), mark: k => (SIM_AT == null ? store.markFired(k) : simFired.add(k)) };

const pad = n => String(n).padStart(2, '0');
// every time on screen is venue (Israel) time, on any device in any zone (3.0.0)
const fmtClock = ms => { const d = zoneParts(ms); return `${pad(d.h)}:${pad(d.mi)}:${pad(d.s)}`; };
const fmtHM = ms => fmtClock(ms).slice(0, 5);
const fmtDur = ms => {
  const t = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const dayLabel = date => { const d = new Date(date + 'T12:00:00'); return `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

let DATA = null;
let VIEWER = false; // read-only viewer (parents/athletes): no notes, appeals, calibration, alerts; only rounds from now on
let current = null; // round id
let view = 'mine';
let lastTabTap = 0;
let screen = 'round'; // 'home' | 'round'
const OFF_ZONE = deviceOffZone(); // device not on Israel time → small "שעון ישראל" tag by the clock

// ---- gate ----
// → payload, null (wrong code) or 'nodata' (no network and nothing cached / server error).
async function readBox(file) {
  const tryRes = async res => { try { return res && res.ok ? await res.json() : null; } catch { return null; } };
  return await tryRes(await fetch(file, { cache: 'no-cache' }).catch(() => null))
    || await tryRes(await (window.caches ? caches.match(file) : null)?.catch?.(() => null));
}
// The coach code opens data.enc.json; the viewer code (parents/athletes) opens data.view.enc.json (role 'viewer').
async function unlock(code) {
  const box = await readBox('data.enc.json');
  if (!box) return 'nodata';
  const d = await decryptJSON(box, code);
  if (d) return d;
  const vbox = await readBox('data.view.enc.json');
  return vbox ? decryptJSON(vbox, code) : null;
}

setupInstall(() => VIEWER || !$("#gate").hidden); // before boot: the gate link works before login; there the role is unknown → no alerts step

async function boot() {
  if (store.code) {
    const d = await unlock(store.code);
    if (d && d !== 'nodata') { DATA = d; return start(); }
  }
  $('#gate').hidden = false;
  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('#gate-btn').disabled = true;
    const code = $('#code').value.trim();
    const d = await unlock(code);
    $('#gate-btn').disabled = false;
    if (!d || d === 'nodata') {
      $('#gate-error').textContent = d === 'nodata' ? 'אין חיבור לנתונים כרגע. בדוק אינטרנט ונסה שוב.' : 'הקוד שגוי, נסה שוב.';
      $('#gate-error').hidden = false; return;
    }
    DATA = d;
    store.code = code;
    $('#gate').hidden = true;
    start();
  });
}

// ---- helpers over data ----
const round = id => DATA.rounds.find(r => r.id === id);
// several competitions (Super League 1–3…): each round names its event; old data had a single DATA.event
const EVENTS = () => DATA.events || [{ id: 'bl1', ...DATA.event }];
// competition name as shown: championships get a trophy before the name (Roei 2026-10-13)
const evName = e => (e?.champ ? '🏆 ' : '') + (e?.title || '');
const evOf = r => EVENTS().find(e => e.id === (r?.event || 'bl1')) || EVENTS()[0];
// viewer: only rounds still ahead (or running now)
const todayStr = () => { const d = zoneParts(now()); return `${d.y}-${pad(d.mo)}-${pad(d.d)}`; };
const visible = r => !VIEWER || !!resultsOf(r.id) || (r.slots.length ? roundEndMs(r) > now() : r.date >= todayStr());
// results (2.7.0): DATA.results[roundId] = { source, rows } from src/results.mjs; round 2 counts back to round 1
// live (3.4.0): a round without an official file shows the federation's live data while it runs (see live.js)
// no next round in this competition → no cut line / "next round" (seniors R2 = the final; audit 2026-10-15)
const lastRound = id => isLastRound(id, DATA.rounds.map(x => x.id));
const resultsOf = id => (LIVE_FORCE && liveOf(id)) || DATA.results?.[id] || LOCKED[id] || liveOf(id) || null;

// ---- locked results (3.5.0): at the end of a live round the coach taps "קבע כתוצאות רשמיות" → the final live state is
// saved on our server and becomes the round's official results for everyone (green), even after the federation's
// database moves on to the next round. A results file from src/results.mjs still wins over it.
let LOCKED = {};
async function loadLocked() {
  try {
    const { items } = await fbCall('/locked');
    const next = {};
    for (const [id, v] of Object.entries(items || {})) {
      const old = LOCKED[id];
      next[id] = old && old.at === v.at ? old : { source: `${v.source || 'תוצאות חיות'} · נקבע כרשמי ${fbDate(v.at)}`, at: v.at, locked: true, final: lastRound(id),
        rows: v.rows.map(r => ({ ...r, bs: r.bs.some(Boolean) ? r.bs : [] })) }; // nothing entered = did not start (DNS)
    }
    LOCKED = next; render();
  } catch { /* offline / no server: keep what we have */ }
}
function lockResults(id) {
  const res = resultsOf(id); if (!res?.live) return;
  const miss = res.total - res.done;
  askConfirm('קביעה כתוצאות רשמיות', `${round(id).title}: התוצאות החיות כפי שהן עכשיו (${res.done}/${res.total} בולדרים${miss ? `, ${miss} חסרים — יירשמו בלי תוצאה` : ''}) יישמרו כתוצאות הסבב ויוצגו לכולם בירוק. אפשר לבטל אחר כך.`, 'קבע כרשמי', async () => {
    try {
      await fbCall('/locked', { round: id, source: `תוצאות חיות מההתאחדות, עודכן ${fmtClock(res.updated)}`, rows: res.rows.map(({ bib, name, club, cat, bs }) => ({ bib, name, club, cat, bs })) });
      await loadLocked(); showToast('נקבע כתוצאות רשמיות ✓');
    } catch { showToast('לא נשמר — אין חיבור לשרת. נסה שוב.'); }
  });
}
function unlockResults(id) {
  askConfirm('ביטול התוצאות הרשמיות', `${round(id).title}: לחזור לתוצאות החיות (אם ההתאחדות עוד מציגה את הסבב)?`, 'בטל', async () => {
    try { await fbCall('/locked/delete', { round: id }); await loadLocked(); showToast('בוטל'); } catch { showToast('לא בוטל — אין חיבור לשרת.'); }
  });
}
const rankCache = {};
function rankedOf(id) {
  const res = resultsOf(id); if (!res) return null;
  if (rankCache[id]?.res === res) return rankCache[id].v;
  return (rankCache[id] = { res, v: rankRows(res.rows, prevRankOf(id)) }).v;
}

const LTAG = '<i class="ltag" aria-hidden="true"><i></i>LIVE</i>';
// ---- live results (3.4.0, trial): polled every 15 s while a round with a start list and no official results runs ----
const LIVE_FORCE = SIM_AT != null && params.get('live') === 'force'; // testing only: replay the live data over a finished round
const live = { data: null, at: 0, err: false, busy: false };
const liveCache = {};
const liveSeen = {}, liveFresh = {}; // 3.8.0: last rows per round (to spot new zones/tops) + cells that just changed (key → when)
// 3.8.2 (Roei): a new zone/top blinks for 10 s, counted from when we saw it (not cut short by the next update)
const FRESH_MS = 10000;
const freshOf = id => { const m = liveFresh[id], out = new Set(); if (m) for (const [k, at] of m) { if (Date.now() - at < FRESH_MS) out.add(k); else m.delete(k); } return out; };
function liveOf(id) {
  const r = round(id); if (!live.data || !r) return null;
  const key = `${live.at}:${Math.floor(now() / 15000)}`;
  if (liveCache[id]?.key === key) return liveCache[id].v;
  const lr = liveRows(r, live.data.cfg, live.data.results, now());
  let v = null;
  if (lr) {
    // an athlete who has not climbed yet: category from round 1 (for the category chips)
    const prev = DATA.results?.[id.replace(/-r2$/, '-r1')], catOf = Object.fromEntries((prev?.rows || []).map(x => [x.bib, x.cat]));
    // (club: our short name from round 1 first — the judging app has the long official one)
    lr.rows.forEach(x => { if (!x.cat) x.cat = catOf[x.bib] || null; x.club = prev?.rows.find(y => y.bib === x.bib)?.club || x.club; });
    // 3.8.0: new zone / top since the last update → red toast (everyone, every user) + the cell blinks until the next update
    const evs = liveEvents(liveSeen[id], lr.rows);
    if (liveSeen[id]) { const m = liveFresh[id] || (liveFresh[id] = new Map()); for (const e of evs) m.set(`${e.bib}:${e.b - 1}`, Date.now()); }
    liveSeen[id] = lr.rows.map(x => ({ bib: x.bib, bs: x.bs.map(c => c && [...c]) }));
    if (id === current && screen === 'round') evs.forEach(liveToast);
    v = { ...lr, live: true, final: lastRound(id), source: `תוצאות חיות מההתאחדות · ניסיון, לא רשמי · עודכן ${fmtClock(lr.updated)}` };
  }
  liveCache[id] = { key, v };
  return v;
}
function liveWanted() {
  if (screen !== 'round') return false;
  const r = round(current); if (!r?.slots.length || !liveGroup(r.id)) return false;
  if (LIVE_FORCE) return true;
  if (DATA.results?.[r.id] || LOCKED[r.id]) return false;
  const t = now(), st = roundStart(r) + off(r.id);
  return t > st - 10 * 60000 && t < roundEndMs(r) + 3 * 3600000;
}
async function pollLive(force = false) {
  if (live.busy || !liveWanted() || (document.hidden && !force)) return;
  if (!force && Date.now() - live.at < 14000) return;
  live.busy = true;
  try { live.data = await fetchLive(); live.at = Date.now(); live.err = false; } catch { live.err = true; }
  live.busy = false; render();
}
// round 2 counts back to round 1's ranking (bib → place)
function prevRankOf(id) {
  const prevId = id.replace(/-r2$/, '-r1'), prev = prevId !== id && resultsOf(prevId) ? rankedOf(prevId) : null;
  return prev && Object.fromEntries(prev.map(x => [x.bib, x.rank]));
}
const genderOf = id => (/-w(-|$)/.test(id) ? 'W' : 'M');
// 3.9.1: wording by the round's gender (women's rounds: מטפסת, סיימה, לא התחילה…)
const gw = (id, m, f) => (genderOf(id) === 'W' ? f : m);
let resFem = false; // set by renderResults for the result cards built inside it
const resCat = {}; // chosen category per round (this session)
const roundsOf = ev => DATA.rounds.filter(r => (r.event || 'bl1') === ev.id && visible(r));
const MINE_NAME = () => (VIEWER ? 'הפלגיה' : 'שלי');
// Base = Hub matches from the build; the coach can add/remove athletes per round in settings.
const mineOf = id => {
  const r = round(id); const del = new Set(store.mineDel(id));
  const base = (DATA.mine[id] || []).filter(m => !del.has(m.k));
  const extra = store.mineAdd(id).filter(k => r.slots[k] && !base.some(m => m.k === k))
    .map(k => ({ k, short: r.slots[k].name.split(' ')[0], cat: 'נוסף ידנית', added: true }));
  return [...base, ...extra].sort((a, b) => a.k - b.k);
};
const mineK = id => new Set(mineOf(id).map(m => m.k));
const shortOf = (id, k) => mineOf(id).find(m => m.k === k)?.short;
const off = id => store.offset(id);

function statusText(r, st) {
  switch (st.kind) {
    case 'waiting': return gw(r.id, 'ממתין', 'ממתינה');
    case 'boulder': return `על בולדר ${st.boulder}`;
    case 'rest': return `מנוחה בין ${st.from} ל-${st.to}`;
    case 'trailing': return `מנוחת סיום (אחרי ${r.boulders})`;
    default: return gw(r.id, 'סיים', 'סיימה');
  }
}

function pickDefaultRound() {
  const t = now();
  const live = DATA.rounds.find(r => r.slots.length && stateAt(r, t, off(r.id)).phase === 'live');
  if (live) return live.id;
  const upcoming = DATA.rounds.filter(r => roundStart(r) > t && visible(r)).sort((a, b) => roundStart(a) - roundStart(b));
  const withSlots = upcoming.find(r => r.slots.length);
  return (withSlots || upcoming[0] || DATA.rounds[DATA.rounds.length - 1]).id;
}

// ---- render ----
function patch(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }

function renderTabs() {
  const t = now();
  // tabs = the competition on screen (home: the one shown / in focus; board: the open round's)
  const tabEv = screen === 'home' ? homeEvents()[homeOpenEvent ?? focusEventIdx()].event : evOf(round(current));
  patch($('#round-tabs'), roundsOf(tabEv).map(r => {
    const live = r.slots.length && stateAt(r, t, off(r.id)).phase === 'live';
    return `<button type="button" data-round="${r.id}" aria-pressed="${screen === 'round' && r.id === current}">
      <span class="tab-day">${dayLabel(r.date)}</span> ${esc(r.title)}${live ? ' <span class="live-dot">חי</span>' : ''}${r.slots.length ? '' : ' <span class="tab-wait">ממתין לסדר עלייה</span>'}</button>`;
  }).join(''));
}

function slotCard(r, s, cls, label, tagHtml = '') {
  const mk = mineK(r.id);
  if (!s) return `<div class="${cls} empty"><div class="lane-label">${label}</div>${tagHtml}<div class="who">—</div></div>`;
  const mine = mk.has(s.k), added = mine && mineOf(r.id).find(m => m.k === s.k)?.added;
  return `<div class="${cls}${mine ? ' mine' : ''}${added ? ' added' : ''}"><div class="lane-label">${label}</div>${tagHtml}
    <div class="ord">#${s.order}</div><div class="who">${esc(s.name)}</div>
    <div class="bib">גב ${s.bib}${mine ? ` · <b>${esc(shortOf(r.id, s.k))}</b>` : ''}</div></div>`;
}

function renderBoard(r, s, el = $('#board')) {
  if (!r.slots.length) { patch(el, `<div class="board-msg">סדר העלייה לראונד הזה עוד לא התקבל.</div>`); return; }
  const cells = [];
  const thumb = b => { const u = photoUrl(r.id, b); return u ? `<button type="button" class="ph-thumb" data-photo="${b}" aria-label="תמונת בולדר ${b}"><img src="${u}" alt=""></button>` : ''; };
  // no photo yet → coach gets an empty photo spot with "+" right on the board (2.3.0, Roei picked option A); viewers see the plain card
  const addSpot = b => (VIEWER || photoV(r.id, b) ? '' : `<button type="button" class="ph-add" data-ph-add="${b}" aria-label="הוספת תמונה לבולדר ${b}"${busyPh.has(r.id + ':' + b) ? ' disabled' : ''}>${
    busyPh.has(r.id + ':' + b) ? '<span class="ph-add-busy">מעלה…</span>' : `<span class="plus">+</span><span class="ph-add-t">בולדר ${b}</span><span class="ph-add-l">הוסף תמונה</span>`}</button>`);
  for (let j = 0; j < r.boulders; j++) {
    const th = thumb(j + 1), add = th ? '' : addSpot(j + 1);
    const bt = boardTag(r.id, j + 1);
    cells.push(slotCard(r, s.boulders[j], `lane boulder${th ? ' has-ph' : add ? ' no-ph' : ''}`, th ? `${th}בולדר ${j + 1}` : add ? `${add}<span class="ph-ttl">בולדר ${j + 1}</span>` : `בולדר ${j + 1}`, bt));
    if (j < r.boulders - 1) cells.push(slotCard(r, s.rests[j], 'lane rest', `מנוחה <span class="nw">${j + 1}–${j + 2}</span>`));
  }
  if (r.trailingRest) cells.push(slotCard(r, s.trailing, 'lane rest', 'מנוחת סיום'));
  const cols = Array.from({ length: cells.length }, (_, i) => (i % 2 === 0 && !(r.trailingRest && i === cells.length - 1) ? 'minmax(0,1.45fr)' : 'minmax(0,1fr)')).join(' ');
  patch(el, `<div class="lanes" style="grid-template-columns:${cols}">${cells.join('')}</div>`);
}

function renderTimer(r, s) {
  const t = now();
  const label = $('#timer-label'), timer = $('#timer'), sub = $('#timer-sub');
  $('#tz-tag').hidden = !OFF_ZONE;
  renderDelayBtn(r);
  if (!r.slots.length) { label.textContent = ''; timer.textContent = '--:--'; sub.textContent = `התחלה מתוכננת ${fmtHM(roundStart(r))}`; return; }
  const total = windowCount(r);
  if (s.phase === 'before') {
    const startMs = roundStart(r) + off(r.id);
    label.textContent = 'הראונד מתחיל בעוד';
    timer.textContent = fmtDur(startMs - t);
    sub.innerHTML = [`התחלה ${fmtClock(startMs)}`, r.preview && esc(`צפייה במסלולים ${r.preview.from}–${r.preview.to}`), ...calibParts(r, 0)].filter(Boolean).join(' · ');
    timer.className = 'timer';
  } else if (s.phase === 'after') {
    label.textContent = 'הראונד הסתיים'; timer.textContent = '0:00'; sub.textContent = ''; timer.className = 'timer done';
  } else {
    label.textContent = `סבב ${s.n + 1} מתוך ${total} · נותר`;
    timer.textContent = fmtDur(s.slotLeftMs);
    timer.className = 'timer' + (s.slotLeftMs <= 60000 ? ' warn' : '');
    sub.innerHTML = [`הסבב הבא ${fmtClock(s.slotEndMs)}`, ...calibParts(r, s.n + 1)].join(' · ');
  }
}
// calibration + delay, merged into the line under the clock (3.0.0); n = window changes so far
function calibParts(r, n) {
  const o = off(r.id), d = store.delay(r.id), out = [];
  if (o) out.push(`כיול ${o > 0 ? 'מאחר' : 'מקדים'} ${Math.abs(o) < 60000 ? Math.round(Math.abs(o) / 1000) + 'ש׳' : fmtDur(Math.abs(o))}`);
  if (d) out.push(`השהיה ${d}ש׳${n > 0 ? ` (<bdi dir="ltr">+${d * n}</bdi>ש׳)` : ''}`);
  return out;
}
function renderDelayBtn(r) {
  const b = $('#delay-btn'), d = store.delay(r.id);
  b.querySelector('span').textContent = d ? `השהיה ${d}ש׳` : 'השהיה 0';
  b.classList.toggle('on', d > 0);
  b.setAttribute('aria-label', d ? `השהיה של ${d} שניות בכל מעבר סבב · לחץ לשינוי` : 'ללא השהיה בין סבבים · לחץ להוספה');
}
// "השהיה": the federation clock adds 0–2 s at every window change → each window lasts slotSec + delay (shared, per round)
function applyDelays() {
  for (const r of DATA.rounds) { if (r.slotSec0 == null) r.slotSec0 = r.slotSec; r.slotSec = r.slotSec0 + store.delay(r.id); }
}

function renderNext(r, s) {
  const mk = mineK(r.id);
  patch($('#next'), s.next.slice(0, 7).map(x => `<li class="${mk.has(x.k) ? 'mine' : ''}${mk.has(x.k) && mineOf(r.id).find(m => m.k === x.k)?.added ? ' added' : ''}">
      <span class="ord">#${x.order}</span><span class="who">${esc(x.name)}</span>
      <span class="at">${fmtClock(x.startMs)}</span><span class="cd" data-until="${x.startMs}"></span></li>`).join('')
    || '<li class="muted">אין</li>');
}

function renderMine(r) {
  const t = now();
  const par = parRound(r);
  const list = mineOf(r.id);
  if (par) { // 3.2.0: two rounds at the same time → my athletes of both, each round under its own title
    const tmp = $('#view-mine-tmp') || Object.assign(document.createElement('div'), { id: 'view-mine-tmp' });
    const cards = rr => { tmp._html = null; mineCards(rr, t, tmp); return tmp.innerHTML; };
    patch($('#view-mine'), `<h3 class="par-h">${esc(r.title)}</h3>${cards(r)}<h3 class="par-h">${esc(par.title)} · במקביל</h3>${cards(par)}`);
    return;
  }
  mineCards(r, t, $('#view-mine'));
}
// 3.4.0: each athlete's result so far (live or official) on the management views — "שלי" cards + full-list column
function resByBib(r) {
  const res = resultsOf(r.id); if (!res) return null;
  const full = rankedOf(r.id), ok = full.filter(x => x.rank != null);
  // the place = the category the results tab shows (U17 rounds: U17 alone by default); in/out = the overall ranking
  const opts = catOptions(res.rows, genderOf(r.id)), opt = opts.find(o => o.key === resCat[r.id]) || opts[0];
  const shown = opt?.cats ? rankInCats(res.rows, opt.cats, prevRankOf(r.id)) : full;
  const overall = Object.fromEntries(full.map(x => [x.bib, x.rank]));
  return { res, q: quota(res.live ? res.rows.length : ok.length), overall, by: Object.fromEntries(shown.map(x => [x.bib, x])), all: Object.fromEntries(full.map(x => [x.bib, x])) };
}
// 3.8.1: a boulder that just got a zone/top (live) blinks here too
const bsTxt = (bs, fr, bib) => bs.map((b, j) => (b ? (fr?.has(`${bib}:${j}`) ? `<span class="lfresh">B${j + 1} ${cellTxt(b)}</span>` : `B${j + 1} ${cellTxt(b)}`) : null)).filter(Boolean).join(' · ');
const provisional = R => (R.res.live && !R.res.complete ? ' (זמני)' : '');
function resLine(R, bib, rid) {
  const x = R?.by[bib]; if (!x || x.rank == null) return '';
  const cut = R.res.final ? '' : R.overall[bib] <= R.q ? ' · <span class="yes">בפנים</span>' : ' · <span class="out">בחוץ</span>';
  return `<p class="res-line${R.res.live ? ' live' : ''}"><b>מקום ${x.rank}${provisional(R)}</b> · ${x.score.toFixed(1)} נק׳ · <bdi dir="ltr">${bsTxt(x.bs, R.res.live ? freshOf(rid) : null, bib)}</bdi>${cut}</p>`;
}
function mineCards(r, t, el) {
  const list = mineOf(r.id), R = resByBib(r);
  if (!list.length) { patch(el, `<p class="muted">${r.slots.length ? (VIEWER ? 'אין ספורטאים מהפלגיה בראונד הזה.' : 'אין ספורטאים שלי בראונד הזה.') : 'סדר העלייה עוד לא התקבל.'}</p>`); return; }
  patch(el, (VIEWER ? '<p class="muted small viewer-hint">מודגשים: הספורטאים של רועי פלגי</p>' : overlapHtml(r, t)) + list.map(m => {
    const s = r.slots[m.k];
    const st = athleteStatus(r, m.k, t, off(r.id));
    const notes = store.notes(n => n.round === r.id && n.k === m.k);
    const appeals = store.appeals(a => a.round === r.id && a.k === m.k);
    const big = st.kind === 'waiting' ? `עולה בעוד <span data-until="${st.startMs}"></span>` : statusText(r, st);
    return `<article class="ath card ${st.kind}">
      <header><h3>${esc(m.short)}</h3><span class="muted small">${esc(s.name)} · ${esc(m.cat)}</span></header>
      <div class="ath-status">${big}</div>
      <dl class="ath-meta"><div><dt>סדר</dt><dd>#${s.order}</dd></div><div><dt>גב</dt><dd>${s.bib}</dd></div>
        <div><dt>עלייה</dt><dd>${fmtClock(st.startMs)}</dd></div><div><dt>מעבר לנורמן</dt><dd>${fmtHM(s.transfer ? zonedMs(`${r.date}T${s.transfer.padStart(8, '0')}`) + off(r.id) : st.startMs - 80 * 60000)}</dd></div></dl>
      ${resLine(R, s.bib, r.id)}
      ${notes.length ? `<p class="last-note">📝 ${esc(notes[notes.length - 1].text)}${notes.length > 1 ? ` <span class="muted">(+${notes.length - 1})</span>` : ''}</p>` : ''}
      ${appeals.length ? `<p class="last-note appeal-tag">⚑ ${appeals.length} ערעור${appeals.length > 1 ? 'ים' : ''}</p>` : ''}
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-ghost" data-note="${m.k}" data-nr="${r.id}">הערה</button>
        <button type="button" class="btn btn-sm btn-appeal" data-appeal="${m.k}" data-nr="${r.id}">ערעור</button></div>
    </article>`;
  }).join(''));
}

function renderAll(r) {
  const t = now(); const mk = mineK(r.id); const base = new Set((DATA.mine[r.id] || []).map(m => m.k));
  if (!r.slots.length) { patch($('#view-all'), '<p class="muted">סדר העלייה עוד לא התקבל.</p>'); return; }
  const live = stateAt(r, t, off(r.id)).phase === 'live';
  let nextDone = !live;
  const R = resByBib(r), nc = R ? 7 : 6; // results column (3.4.0) only when the round has results / live results
  const resTd = s => !R ? '' : `<td class="c-res${R.res.live ? ' live' : ''}">${R.all[s.bib]?.rank != null ? `<b>${R.all[s.bib].rank}</b> · ${R.all[s.bib].score.toFixed(1)}` : ''}</td>` // full list = everyone → overall place;
  // 3.0.0: band on whoever is on a boulder / resting between boulders now + a "הבא בתור" line before the first one waiting;
  // circle next to the name adds / removes a not-mine athlete for this round (Hub athletes have none)
  patch($('#view-all'), `<p class="muted small hint">סנכרון לפי מי שמטפס: לחץ "מתחיל עכשיו" ליד המתחרה שעולה עכשיו לבולדר 1. ערעור אפשר על כל מתחרה.${VIEWER ? '' : ' ○ ליד שם = הוספה לספורטאים שלי בסבב הזה.'}</p><div class="full-wrap"><table class="full"><thead><tr><th>סדר</th><th class="c-bib">גב</th><th>שם</th><th>עלייה</th><th>מצב</th>${R ? `<th>תוצאה${provisional(R)}</th>` : ''}<th></th></tr></thead><tbody>${
    r.slots.map((s, k) => {
      const st = s ? athleteStatus(r, k, t, off(r.id)) : null;
      let pre = '';
      if (!nextDone && (st ? st.kind === 'waiting' : slotStartMs(r, k, off(r.id)) > t)) { nextDone = true; pre = `<tr class="next-line"><td colspan="${nc}"><span>הבא בתור</span></td></tr>`; }
      if (!s) return pre + `<tr class="empty-row"><td colspan="3">סבב ריק</td><td>${fmtClock(slotStartMs(r, k, off(r.id)))}</td><td></td>${R ? '<td></td>' : ''}<td></td></tr>`;
      const added = mk.has(k) && mineOf(r.id).find(m => m.k === k)?.added;
      const now_ = st.kind === 'boulder' || st.kind === 'rest';
      const tg = VIEWER || base.has(k) ? '' : `<button type="button" class="mine-tg" data-mine-tg="${k}" aria-pressed="${mk.has(k)}" aria-label="${mk.has(k) ? 'הסרה מהספורטאים שלי' : 'הוספה לספורטאים שלי'} · ${esc(s.name)}"></button>`;
      return pre + `<tr class="${mk.has(k) ? 'mine' : ''}${added ? ' added' : ''}${now_ ? ' now' : ''} st-${st.kind}"><td>${s.order}</td><td class="c-bib">${s.bib}</td><td class="c-name"><span class="nm-in">${tg}<span>${esc(s.name)}${mk.has(k) ? ` <b>(${esc(shortOf(r.id, k))})</b>` : ''}</span></span></td>
        <td>${fmtClock(st.startMs)}</td><td class="c-st">${statusText(r, st)}</td>${resTd(s)}
        <td class="row-actions"><button type="button" class="sync-btn" data-sync="${k}">${gw(r.id, 'מתחיל עכשיו', 'מתחילה עכשיו')}</button>
          <button type="button" class="sync-btn appeal-btn" data-appeal="${k}">ערעור</button></td></tr>`;
    }).join('')}</tbody></table></div>`);
  if (scrollAll) {
    scrollAll = false;
    const row = $('#view-all tr.now') || $('#view-all tr.next-line');
    const rc = row?.getBoundingClientRect();
    if (rc && (rc.top < 0 || rc.bottom > innerHeight)) scrollTo({ top: scrollY + rc.top - innerHeight / 2, behavior: 'smooth' });
  }
}
let scrollAll = false; // once per opening of the full list (Roei: then it must not move under the finger)

// ---- results (2.7.0): my athletes' cards + boulder stats + full table (design picked by Roei 2026-10-13) ----
// a finished round with results opens on its results; otherwise leave the results tab
function openRoundView() {
  pollLive(true);
  const r = round(current);
  if (resultsOf(r.id) && (!r.slots.length || stateAt(r, now(), off(r.id)).phase === 'after')) setView('results');
  else if (view === 'results') setView('mine');
}
const cellTxt = b => (!b ? '·' : b[0] ? `T${b[0]}` : b[1] ? `Z${b[1]}` : '–');
const resWord = b => (b[0] ? `טופ בניסיון ${b[0]}` : `זון בניסיון ${b[1]}`);
const sgn = g => `<bdi dir="ltr">+${g.toFixed(1)}</bdi>`;
// star path bbox = x 2–22, y 2–21 → viewBox shifted by −0.5 so the shape sits exactly in the middle of its circle
const STAR = '<svg viewBox="0 -0.5 24 24" aria-hidden="true"><path fill="currentColor" d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
const SOLE = { t: 'הטופ היחיד', z: 'הזון היחיד' };
const heList = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} ו־${xs[xs.length - 1]}` : `${xs[0]}`);
const WHAT_IF = { topFromZone: 'טופ במקום זון', topFromEmpty: 'טופ בבולדר ריק', zoneFromEmpty: 'זון בבולדר ריק' };

function resCard(ranked, row, who, final, full) {
  const a = analyze(ranked, row, full), inCat = ranked !== full;
  const soleJ = a.sole.flatMap((k, j) => (k ? [j] : [])), soleKinds = [...new Set(soleJ.map(j => a.sole[j]))];
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const what = o => row.rank === 1 ? `יתרון ${sgn(o.gain)}` : `${o.rank < row.rank ? 'מקום ' + o.rank : 'נשאר ' + row.rank}<small class="d">${sgn(o.gain)}</small>${o.advances && !final ? '<span class="up">עולה</span>' : ''}`;
  const bars = row.bs.map((b, j) => { const k = kind(b), p = pts(b);
    return `<div class="bar" title="בולדר ${j + 1}: ${p.toFixed(1)}"><div class="fill-wrap"><div class="fill ${k}" style="height:${p / 25 * 100}%"></div>${a.sole[j] ? `<span class="sole" title="${SOLE[a.sole[j]]}" aria-label="${SOLE[a.sole[j]]}">${STAR}</span>` : ''}</div><span class="lb">B${j + 1} (T${b?.[0] || 0}Z${b?.[1] || 0})</span></div>`; }).join('');
  return `<article class="card fc${who.added ? ' added' : ''}">
    <div class="top"><div><div class="nm">${esc(row.name)}</div><div class="club">${esc(row.club)} · מס׳ ${row.bib}</div></div><div class="rk">${row.rank}<small>/${a.n}</small>${inCat ? `<span class="rk-all">כללי ${a.overallRank}</span>` : ''}</div></div>
    <div class="sc"><b>${row.score.toFixed(1)}</b> נק׳ · ${a.tops} טופים · ${a.zones} זונים</div>
    <div class="bars" style="grid-template-columns:repeat(${row.bs.length},1fr)">${bars}</div>
    ${soleKinds.length ? `<div class="sole-key"><span class="sole-ic">${STAR}</span> = ${soleKinds.length > 1 ? 'הטופ/הזון היחיד' : SOLE[soleKinds[0]]}</div>` : ''}
    <div class="ins">
      <div class="grp"><span class="gh">מיקום</span>
        ${final ? '' : kv('סבב הבא', a.advances ? '<span class="yes">עולה ✓</span>' : `חסרו ${a.missing.toFixed(1)} נק׳<small class="d">קו ${a.cutScore.toFixed(1)}</small>`)}
        ${kv('פער מהמקום שמעל', a.above ? `${r1(a.above.score - row.score).toFixed(1)} נק׳<small class="d">מקום ${a.above.rank}</small>` : 'מקום ראשון')}
        ${a.below ? kv('יתרון על שמתחת', `${r1(row.score - a.below.score).toFixed(1)} נק׳<small class="d">מקום ${a.below.rank}</small>`) : ''}
      </div>
      <div class="grp"><span class="gh">מסלולים</span>
        ${a.strong ? kv('הבולדר הטוב', soleJ.length > 1
          ? `בולדרים ${heList(soleJ.map(j => j + 1))}<small class="d">${soleKinds.length > 1 ? soleJ.map(j => `${a.sole[j] === 't' ? 'טופ' : 'זון'} יחיד ב־${j + 1}`).join(', ') : SOLE[soleKinds[0]]}</small>`
          : `בולדר ${a.strong.boulder}<small class="d">${resWord(a.strong.b)} · ${a.sole[a.strong.boulder - 1] ? SOLE[a.sole[a.strong.boulder - 1]] : 'מקום ' + a.strong.place}</small>`) : ''}
        ${a.weak ? kv('בולדר לשיפור', `בולדר ${a.weak.boulder}<small class="d">${a.weak.b[0] || a.weak.b[1] ? resWord(a.weak.b) : 'בלי זון'} · מקום ${a.weak.place} · ${a.weak.topN} מתוך ${a.n} עשו טופ</small>`) : ''}
        ${kv('פתיחה מול סיום', `מקום ${a.open} · מקום ${a.close}<small class="d">${a.close < a.open ? (resFem ? 'סיימה טוב יותר' : 'סיים טוב יותר') : a.close > a.open ? (resFem ? 'סיימה חלש יותר' : 'סיים חלש יותר') : 'יציב'}</small>`)}
      </div>
      <div class="grp"><span class="gh">ניסיונות</span>
        ${kv('פלאשים', `טופ ${a.flashes} · זון ${a.zFlashes}<small class="d">ממוצע ${a.flashAvg.toFixed(1)} · ${a.zFlashAvg.toFixed(1)}</small>`)}
        ${kv(resFem ? 'ירדה על נפילות' : 'ירד על נפילות', `${a.lost.toFixed(1)} נק׳`)}
      </div>
      <div class="grp"><span class="gh">תרחישים</span>
        ${a.opts.length ? a.opts.map(o => kv(WHAT_IF[o.key], what(o))).join('') : kv('טופ נוסף', 'כבר טופ בכל הבולדרים')}
      </div>
    </div></article>`;
}

// live, round still running (3.4.0): place so far, points, the cut line now; boulders not climbed yet = dashed
function liveCard(ranked, row, who, q, final, full, wallTag = '', fresh = new Set()) {
  const head = rk => `<div class="top"><div><div class="nm">${esc(row.name)}${wallTag}</div><div class="club">${row.club ? esc(row.club) + ' · ' : ''}מס׳ ${row.bib}</div></div><div class="rk">${rk}</div></div>`;
  if (row.rank == null) return `<article class="card fc live${who.added ? ' added' : ''}">${head('–')}<p class="muted small">עדיין בלי תוצאה — יופיע כאן אחרי הבולדר הראשון.</p></article>`;
  const ok = ranked.filter(x => x.rank != null), all = full.filter(x => x.rank != null), i = ok.indexOf(row);
  const overall = all.find(x => x.bib === row.bib)?.rank ?? row.rank, nDone = row.bs.filter(Boolean).length;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const above = ok.slice(0, i).reverse().find(x => x.score > row.score), below = ok.slice(i + 1).find(x => x.score < row.score);
  const bars = row.bs.map((b, j) => b ? `<div class="bar${fresh.has(`${row.bib}:${j}`) ? ' fresh' : ''}"><div class="fill-wrap"><div class="fill ${kind(b)}" style="height:${pts(b) / 25 * 100}%"></div></div><span class="lb">B${j + 1} (T${b[0] || 0}Z${b[1] || 0})</span></div>`
    : `<div class="bar wait"><div class="fill-wrap"></div><span class="lb">B${j + 1} · עוד לא</span></div>`).join('');
  let cut = '';
  if (!final) {
    const lastIn = all[Math.min(q, all.length) - 1], firstOut = all[q];
    cut = overall <= q ? kv('קו העלייה כרגע', `<span class="yes">בפנים</span>${firstOut ? `<small class="d">יתרון ${r1(row.score - firstOut.score).toFixed(1)} על מקום ${firstOut.rank}</small>` : ''}`)
      : kv('קו העלייה כרגע', `חסרות ${r1(lastIn.score - row.score + 0.1).toFixed(1)} נק׳<small class="d">מקום ${q} · ${lastIn.score.toFixed(1)}</small>`);
  }
  return `<article class="card fc live${who.added ? ' added' : ''}">${head(`${row.rank}<small>/${ok.length}</small><em>זמני</em>${ranked !== full ? `<span class="rk-all">כללי ${overall}</span>` : ''}`)}
    <div class="sc"><b>${row.score.toFixed(1)}</b> נק׳ · ${row.bs.filter(b => b && b[0]).length} טופים · ${row.bs.filter(b => b && (b[0] || b[1])).length} זונים · ${nDone}/${row.bs.length} בולדרים</div>
    <div class="bars" style="grid-template-columns:repeat(${row.bs.length},1fr)">${bars}</div>
    <div class="ins"><div class="grp"><span class="gh">מיקום זמני · מתוך ${ok.length} שהתחילו</span>
      ${cut}
      ${kv('פער מהמקום שמעל', above ? `${r1(above.score - row.score).toFixed(1)} נק׳<small class="d">מקום ${above.rank}</small>` : 'מקום ראשון')}
      ${below ? kv('יתרון על שמתחת', `${r1(row.score - below.score).toFixed(1)} נק׳<small class="d">מקום ${below.rank}</small>`) : ''}
    </div></div></article>`;
}

// coach only (not from a simulation, which must never write the real results): lock when the round is done, or undo
function lockBar(r, res) {
  if (VIEWER || (SIM_AT != null && location.hostname !== 'localhost')) return '';
  if (res.locked) return `<div class="lock-bar"><span>✓ נקבע כתוצאות רשמיות מהתוצאות החיות</span><button type="button" class="btn btn-sm btn-ghost" data-unlock="${r.id}">ביטול</button></div>`;
  if (!res.live || !(res.complete || stateAt(r, now(), off(r.id)).phase === 'after')) return '';
  return `<div class="lock-bar"><span>${res.complete ? 'כל הבולדרים הוזנו.' : `הסבב נגמר · ${res.done}/${res.total} בולדרים הוזנו.`} לשמור את המצב הזה כתוצאות הרשמיות של הסבב?</span><button type="button" class="btn btn-sm btn-primary" data-lock="${r.id}">קבע כתוצאות רשמיות</button></div>`;
}

function renderResults(r) {
  resFem = genderOf(r.id) === 'W';
  const res = resultsOf(r.id), full = rankedOf(r.id), g = genderOf(r.id);
  const opts = catOptions(res.rows, g), opt = opts.find(o => o.key === resCat[r.id]) || opts[0];
  const sub = opt?.cats ? rankInCats(res.rows, opt.cats, prevRankOf(r.id)) : full;
  const ranked = sub.length === full.length ? full : sub; // a view of everyone = the overall ranking (no "כללי")
  const overallOf = Object.fromEntries(full.map(x => [x.bib, x.rank]));
  const ok = ranked.filter(x => x.rank != null), nB = r.boulders;
  const chips = opts.length > 1 ? `<div class="seg res-cats" role="group" aria-label="קטגוריה">${opts.map(o => `<button type="button" data-rescat="${o.key}" aria-pressed="${o === opt}">${esc(o.label)}</button>`).join('')}</div>` : '';
  const whoByBib = {};
  for (const m of mineOf(r.id)) { const s = r.slots[m.k]; if (s) whoByBib[s.bib] = m; }
  const running = res.live && !res.complete;
  // 3.8.0: who is on the wall right now (rotation model + calibration) → label next to the name + frame on that boulder
  const onWall = {};
  if (res.live) { const s = stateAt(r, now(), off(r.id)); if (s.phase === 'live') s.boulders.forEach((sl, j) => { if (sl) onWall[sl.bib] = j + 1; }); }
  const wallTag = bib => (onWall[bib] ? `<span class="onwall"><i></i>על הקיר · B${onWall[bib]}</span>` : '');
  const fresh = freshOf(r.id);
  const q = res.live ? quota(res.rows.length) : analyze(full, full[0]).quota;
  const mine = (running ? ranked : ok).filter(x => whoByBib[x.bib]);
  const cards = mine.length ? `<div class="focus">${mine.map(x => running ? liveCard(ranked, x, whoByBib[x.bib], q, res.final, full, wallTag(x.bib), fresh) : resCard(ranked, x, whoByBib[x.bib], res.final, full)).join('')}</div>`
    : `<p class="muted">${VIEWER ? 'אין ספורטאים מהפלגיה בסבב הזה.' : 'אין ספורטאים שלי בסבב הזה.'}</p>`;
  const stats = boulderStats(ranked, nB).map(b => {
    const md = mine.map(x => `<span>${esc(whoByBib[x.bib].short)} ${cellTxt(x.bs[b.boulder - 1])}</span>`).join('');
    return `<div class="bs-row"><b>בולדר ${b.boulder}</b><div class="stack"><span class="t" style="width:${b.tops / b.n * 100}%"></span><span class="z" style="width:${b.zoneOnly / b.n * 100}%"></span></div>
      <span class="c">${b.tops} טופ · ${b.tops + b.zoneOnly} זון / ${b.n}</span><span></span>
      <div class="mydots">${md}<span class="avg">ממוצע ניסיונות לטופ ${b.avgTop ?? '–'}</span><span class="avg">ממוצע ניסיונות לזון ${b.avgZone ?? '–'}</span></div></div>`;
  }).join('');
  const cell = (b, j, bib) => { const k = kind(b), ex = (onWall[bib] === j + 1 ? ' climbing' : '') + (fresh.has(`${bib}:${j}`) ? ' fresh' : '');
    if (k === 'w') return `<div class="cell w${ex}"><span class="a">${ex.includes('climbing') ? (resFem ? 'מטפסת' : 'מטפס') : '·'}</span><span class="p"></span></div>`;
    return `<div class="cell ${k}${ex}"><span class="a">${k === 'n' ? '—' : (b[0] ? 'T' + b[0] + ' ' : '') + 'Z' + b[1]}</span><span class="s">${k === 'n' ? '—' : b[0] ? 'T' + b[0] : 'Z' + b[1]}</span><span class="p">${k === 'n' ? '0' : pts(b).toFixed(1)}</span></div>`; };
  let cutDone = false;
  const rows = ranked.map(x => {
    const w = whoByBib[x.bib], cls = w ? (w.added ? 'mine added' : 'mine') : '';
    let pre = '';
    if (!res.final && !cutDone && x.rank != null && overallOf[x.bib] > q) { cutDone = true; const ct = `קו העלייה לסבב הבא · ${q} עולים${ranked === full ? ` (${ok.length} התחילו)` : ' לפי הדירוג הכללי'}`;
      // 3.9.0: phone hides 2 columns → a cell spanning them would add a phantom column; one row per layout
      pre = `<tr class="cut cut-wide"><td colspan="${nB + 5}">${ct}</td></tr><tr class="cut cut-narrow"><td colspan="${nB + 3}">${ct}</td></tr>`; }
    return pre + `<tr class="${cls}"><td class="rk">${x.rank ?? '–'}${ranked !== full && x.rank != null ? `<small class="rk-all">כללי ${overallOf[x.bib]}</small>` : ''}</td><td class="n"><b>${esc(x.name)}${w ? ` <span class="tag">${esc(w.short)}</span>` : ''}</b>${wallTag(x.bib)}<small>${esc(x.club)}${x.cat && x.cat !== 'S' && (!opt?.cats || opt.cats.length > 1) ? ` · ${catLabel(x.cat, g)}` : ''}</small></td><td class="bib">${x.bib}</td>
      ${x.rank == null ? `<td colspan="${nB}" class="muted small">${res.live && !res.complete ? 'עדיין בלי תוצאה' : resFem ? 'לא התחילה (DNS)' : 'לא התחיל (DNS)'}</td><td class="tz"></td><td class="tt">–</td>` : x.bs.map((b, j) => `<td>${cell(b, j, x.bib)}</td>`).join('') + `<td class="tz">${x.bs.filter(b => b && b[0]).length}T ${x.bs.filter(b => b && (b[0] || b[1])).length}Z</td><td class="tt">${x.score.toFixed(1)}</td>`}</tr>`;
  }).join('');
  patch($('#view-results'), `<div class="res${res.live ? ' is-live' : ''}">
    ${chips}
    ${res.live ? `<div class="live-bar${live.err ? ' err' : ''}">${LTAG}<b>${res.complete ? 'כל הבולדרים הוזנו' : 'תוצאות חיות'}</b><span>${res.done}/${res.total} בולדרים הוזנו · ${res.started} התחילו</span>${live.err ? '<span>אין חיבור כרגע — מוצג המצב האחרון</span>' : ''}<span class="muted">מתעדכן כל 15 שניות · לא רשמי</span></div>` : ''}
    ${lockBar(r, res)}
    <div class="res-head"><span class="muted small">מקור: ${esc(res.source)}</span>
      <span class="legend"><span><i class="cell t lg">T</i> טופ</span><span><i class="cell z lg">Z</i> זון בלי טופ</span><span><i class="cell n lg">—</i> בלי זון</span><span class="muted">T2 = טופ בניסיון השני</span></span></div>
    ${cards}
    <div class="card bstats"><h3>הבולדרים בסבב: כמה הגיעו לטופ ולזון</h3>${stats}</div>
    <div class="card"><div class="tbl-head"><b>${resFem ? 'כל המתחרות' : 'כל המתחרים'}</b><span class="muted small">שורה מסומנת = ${VIEWER ? 'הפלגיה' : 'שלי'}</span></div>
      <div class="tbl-wrap"><table class="res-tbl"><thead><tr><th class="rk">#</th><th class="n">${resFem ? 'מטפסת' : 'מטפס'}</th><th class="bib">מס׳</th>${Array.from({ length: nB }, (_, j) => `<th class="bh"><span class="hl">בולדר </span><span class="hs">B</span>${j + 1}</th>`).join('')}<th class="tz">T / Z</th><th class="tt">ניקוד</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <p class="muted small">ניקוד: טופ 25, זון 10, מינוס 0.1 על כל ניסיון שנכשל לפני. תיקו: השוואה לסבב הקודם (אם היה), אחר כך פחות ניסיונות לטופים, אחר כך פחות ניסיונות לזונים. ${res.final ? 'סבב אחרון בתחרות — אין סבב המשך.' : `עולים: ${q} (לפי אמות המידה של ההתאחדות); תיקו על המקום האחרון עולה.`}</p>
  </div>`);
}

function appealText(a) {
  const r = round(a.round);
  return [`ערעור — ${evOf(r).title} · ${r.title} (${dayLabel(r.date)})`, `ספורטאי: ${a.name} · מס' גב ${a.bib} · סדר עלייה ${a.order}`,
    `בולדר: ${a.boulder}`, `שעה: ${a.time}`, `תיאור: ${a.text}`].join('\n');
}

// ---- notes & appeals (3.1.0): this round or all rounds, filter by name, edit notes, appeal status ----
let logAll = false, logName = null, editId = null;
const APPEAL_ST = [['pending', 'ממתין'], ['ok', 'התקבל ✓'], ['no', 'נדחה ✗']];
function logItems() {
  const inScope = i => logAll || i.round === current;
  const all = [...store.notes(inScope).map(n => ({ ...n, type: 'note' })), ...store.appeals(inScope).map(a => ({ ...a, type: 'appeal' }))];
  return { all, shown: (logName ? all.filter(i => i.short === logName) : all).sort((a, b) => b.at - a.at) };
}
const noteText = n => `${n.short} · ${round(n.round)?.title} · ${fmtClock(n.at)} · ${n.ctx}${n.edited ? ` · נערך ${fmtHM(n.edited)}` : ''}\n${n.text}`;
const appealFull = a => appealText(a) + (a.status && a.status !== 'pending' ? `\nסטטוס: ${APPEAL_ST.find(x => x[0] === a.status)[1]}${a.outcome ? ' · ' + a.outcome : ''}` : '');
function logCard(i) {
  const r = round(i.round);
  const from = store.deviceCount > 1 && store.deviceName(i.dev) ? ` · ${esc(store.deviceName(i.dev))}` : '';
  if (i.type === 'appeal') {
    const st = i.status || 'pending';
    return `<article class="log card appeal st-${st}"><header><b>⚑ ערעור · ${esc(i.short)}</b><span class="muted small">${esc(r?.title)} · ${esc(i.time)}${from}</span></header>
      <pre>${esc(appealText(i))}</pre>
      <div class="seg ap-st" role="group" aria-label="סטטוס הערעור">${APPEAL_ST.map(([k, l]) => `<button type="button" data-ap-st="${k}" data-ap="${i.id}" aria-pressed="${st === k}">${l}</button>`).join('')}</div>
      ${st !== 'pending' ? `<input type="text" class="ap-out" id="out-${i.id}" data-ap-out="${i.id}" maxlength="120" placeholder="מה הוחלט? (רשות) למשל: קיבלו טופ, עלה למקום 12" value="${esc(i.outcome || '')}">` : ''}
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-ghost" data-copy="${i.id}">העתק</button>
      ${navigator.share ? `<button type="button" class="btn btn-sm btn-ghost" data-share="${i.id}">שתף</button>` : ''}
      <button type="button" class="btn btn-sm btn-ghost btn-del" data-del-appeal="${i.id}">מחיקה</button></div></article>`;
  }
  const editing = editId === i.id;
  return `<article class="log card"><header><b>📝 ${esc(i.short)}</b><span class="muted small">${esc(r?.title)} · ${fmtClock(i.at)} · ${esc(i.ctx)}${i.edited ? ` · נערך ${fmtHM(i.edited)}` : ''}${from}</span></header>
    ${editing ? `<textarea class="note-edit" id="edit-${i.id}" rows="3" aria-label="עריכת ההערה">${esc(i.text)}</textarea>
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-primary" data-edit-save="${i.id}">שמירה</button><button type="button" class="btn btn-sm btn-ghost" data-edit-cancel>ביטול</button></div>`
    : `<p>${esc(i.text)}</p><div class="ath-actions"><button type="button" class="btn btn-sm btn-ghost" data-edit="${i.id}">עריכה</button><button type="button" class="btn btn-sm btn-ghost btn-del" data-del-note="${i.id}">מחיקה</button></div>`}</article>`;
}
function renderLog() {
  const { all, shown } = logItems();
  const names = [...new Set(all.map(i => i.short))].sort((a, b) => a.localeCompare(b, 'he'));
  if (logName && !names.includes(logName)) logName = null;
  const cnt = n => all.filter(i => i.short === n).length;
  let body;
  if (!shown.length) body = `<p class="muted">${logAll ? 'עוד אין הערות או ערעורים.' : 'אין עדיין הערות או ערעורים בסבב הזה.'}</p>`;
  else if (!logAll) body = shown.map(logCard).join('');
  else { // all rounds: grouped by round, the round with the newest item first
    const groups = [];
    for (const i of shown) { let g = groups.find(x => x.id === i.round); if (!g) groups.push(g = { id: i.round, items: [] }); g.items.push(i); }
    body = groups.map(g => { const r = round(g.id); return `<h3 class="log-round">${r ? `${esc(evOf(r).title)} · ${dayLabel(r.date)} · ${esc(r.title)}` : 'סבב'}</h3>${g.items.map(logCard).join('')}`; }).join('');
  }
  const pend = shown.filter(i => i.type === 'appeal' && (i.status || 'pending') === 'pending').length;
  // keep what the coach is typing (the list re-renders on sync / every second)
  const ae = document.activeElement, keep = ae?.closest?.('#view-log') && ae.id ? { id: ae.id, v: ae.value, a: ae.selectionStart, b: ae.selectionEnd } : null;
  patch($('#view-log'), `<div class="log-filters">
      <div class="seg" role="group" aria-label="איזה סבבים"><button type="button" data-log-all="0" aria-pressed="${!logAll}">הסבב הזה</button><button type="button" data-log-all="1" aria-pressed="${logAll}">כל הסבבים</button></div>
      ${names.length > 1 ? `<div class="seg log-names" role="group" aria-label="סינון לפי שם"><button type="button" data-log-name="" aria-pressed="${!logName}">הכל</button>${names.map(n => `<button type="button" data-log-name="${esc(n)}" aria-pressed="${logName === n}">${esc(n)} <span class="n">${cnt(n)}</span></button>`).join('')}</div>` : ''}
    </div>
    <div class="log-actions"><button type="button" class="btn btn-sm btn-ghost" id="export-btn">ייצוא קובץ</button>
    <button type="button" class="btn btn-sm btn-ghost" id="copy-all-btn">העתק הכל</button>${pend ? `<span class="pend-count">⚑ ${pend} ממתין${pend > 1 ? 'ים' : ''} להחלטה</span>` : ''}<span class="muted small log-sync">${esc(syncLabel())}</span></div>` + body);
  if (keep) { const el = document.getElementById(keep.id); if (el && el !== document.activeElement) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.a, keep.b); } catch { /* ignore */ } } }
}

// ---- home: all rounds by event / day, tap to open ----
function roundEndMs(r) { return roundStart(r) + off(r.id) + windowCount(r) * r.slotSec * 1000; }

// Windows where 2+ of my athletes are on a boulder at the same time (resting between boulders is fine — Roei).
const overlapsOf = r => climbOverlaps(r, mineOf(r.id).map(m => m.k), off(r.id));
function overlapHtml(r, t) {
  if (mineOf(r.id).length < 2) return '';
  const ov = overlapsOf(r);
  if (!ov.length) return '<div class="ovl card ok"><b>✓ אין חפיפות בטיפוס</b> <span class="muted small">אף פעם לא מטפסים שניים שלך באותו זמן.</span></div>';
  const max = Math.max(...ov.map(w => w.climbers.length));
  const nextIdx = ov.findIndex(w => w.endMs > t);
  const rows = ov.map((w, i) => {
    const cls = w.endMs <= t ? 'past' : w.startMs <= t ? 'now' : i === nextIdx ? 'next' : '';
    const who = w.climbers.map(c => `<span class="ovl-who"><b>${esc(shortOf(r.id, c.k))}</b> בולדר ${c.boulder}</span>`).join('');
    return `<li class="${cls}"><span class="ovl-at">${fmtClock(w.startMs)}–${fmtHM(w.endMs)}</span><span class="ovl-list">${who}</span>${cls === 'now' ? '<span class="ovl-badge">עכשיו</span>' : ''}</li>`;
  }).join('');
  return `<div class="ovl card"><div class="ovl-head"><b>⚠︎ חפיפות בטיפוס</b><span class="muted small">${ov.length} סבבים שבהם ${max > 2 ? 'עד ' + max : 'שניים'} שלך מטפסים במקביל</span></div><ol>${rows}</ol></div>`;
}

let homeOpenEvent = null; // list view: which event is opened (null = the list)
// Every competition by date. A competition without rounds (lead leagues for now) is listed by its `dates` only.
// Viewer: only rounds still ahead, and competitions with something still ahead.
const hasRounds = e => DATA.rounds.some(r => (r.event || 'bl1') === e.id);
const evDates = e => e.dates || [...new Set(DATA.rounds.filter(r => (r.event || 'bl1') === e.id).map(r => r.date))].sort();
function homeEvents() {
  const all = EVENTS().map(e => ({ event: e, rounds: roundsOf(e), dates: evDates(e) })).sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  const v = all.filter(x => x.rounds.length || (!hasRounds(x.event) && (!VIEWER || x.dates.at(-1) >= todayStr())));
  return v.length ? v : all.slice(-1);
}
// phase of a whole competition: live / before / after (by its rounds, or by its dates when it has none)
function evPhase(ev, t = now()) {
  if (ev.rounds.length) {
    const rs = ev.rounds.filter(r => r.slots.length);
    if (rs.some(r => stateAt(r, t, off(r.id)).phase === 'live')) return 'live';
    const done = r => roundStart(r) + off(r.id) + (r.slots.length ? windowCount(r) * r.slotSec * 1000 : 12 * 3600e3) < t;
    return ev.rounds.every(done) ? 'after' : 'before';
  }
  const today = todayStr();
  return ev.dates.at(-1) < today ? 'after' : ev.dates[0] <= today ? 'live' : 'before';
}
// the competition to show by default: the first one not finished yet, else the last
function focusEventIdx() {
  const evs = homeEvents(); const i = evs.findIndex(ev => evPhase(ev) !== 'after');
  return i < 0 ? evs.length - 1 : i;
}
// "13–15/10" (always left-to-right, so RTL text never scrambles it)
function rangeLabel(dates) {
  const d0 = new Date(dates[0] + 'T12:00:00'), d1 = new Date(dates.at(-1) + 'T12:00:00');
  const txt = dates.length < 2 ? `${d0.getDate()}/${d0.getMonth() + 1}`
    : d0.getMonth() === d1.getMonth() ? `${d0.getDate()}–${d1.getDate()}/${d1.getMonth() + 1}` : `${d0.getDate()}/${d0.getMonth() + 1}–${d1.getDate()}/${d1.getMonth() + 1}`;
  return `<span dir="ltr" class="ev-dates">${txt}</span>`;
}
// only the nearest upcoming competition is "בקרוב"; later ones count the days
function evBadge(ev, evs) {
  const ph = evPhase(ev);
  if (ph === 'live') return ev.rounds.length ? '<span class="hb live">חי עכשיו</span>' : '<span class="hb live">היום</span>';
  if (ph === 'after') return '<span class="hb done">הסתיים</span>';
  if (evs.find(x => evPhase(x) === 'before') === ev) return '<span class="hb soon">בקרוב</span>';
  const days = Math.round((new Date(ev.dates[0] + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 864e5);
  return `<span class="hb later">בעוד ${days} ימים</span>`;
}

// ---- 3.10.0 (Roei): final standings per category — one round = its ranking; two rounds = round 2 for whoever got
// there, round 1 for the rest (finalStandings). Ready once every round of the category has official (not live) results.
const catKey = id => id.replace(/-r\d$/, '');
const CUP = '<svg class="cup" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.7V7Zm10 0v2.7A2 2 0 0 0 18 8V7h-1Z"/></svg>';
function finalsOf(ev) {
  const groups = {};
  for (const r of DATA.rounds.filter(r => (r.event || 'bl1') === ev.event.id)) (groups[catKey(r.id)] ||= []).push(r);
  return Object.keys(groups).sort().map(key => {
    const rs = groups[key].sort((a, b) => (a.id < b.id ? -1 : 1));
    const ready = rs.every(r => { const res = resultsOf(r.id); return res && !res.live; });
    const mine = new Map(rs.flatMap(r => mineOf(r.id).map(m => [r.slots[m.k]?.bib, m.short])));
    // (club: round 1's when a later round's row has none)
    const club = Object.fromEntries(rs.flatMap(r => resultsOf(r.id)?.rows || []).filter(x => x.club).map(x => [x.bib, x.club]));
    return { key, id: rs.at(-1).id, title: rs[0].title.split(' · ')[0], ready, mine, rows: ready ? finalStandings(rs.map(r => rankedOf(r.id))).map(x => (x.club ? x : { ...x, club: club[x.bib] })) : null };
  });
}
const finalsReady = ev => { const f = finalsOf(ev); return f.length > 0 && f.every(x => x.ready); };
let homeFinal = null; // { ev: index in homeEvents(), key: category, from: 'list' | 'detail' }
function finalCards(ev, ei) {
  const fs = finalsOf(ev); if (!fs.some(f => f.ready)) return '';
  const card = f => {
    if (!f.ready) return `<div class="fin-card wait"><h4>${esc(f.title)}</h4><p class="muted small">ממתין לסיום</p></div>`;
    const pod = f.rows.filter(x => x.rank != null).slice(0, 3).map(x => `<li><i>${x.rank}</i><span>${esc(x.name)}</span></li>`).join('');
    const mine = f.rows.filter(x => f.mine.has(x.bib)).map(x => `<span><b>${esc(f.mine.get(x.bib))}</b> ${x.rank ?? '—'}</span>`).join('');
    return `<button type="button" class="fin-card" data-final="${ei}:${f.key}:detail"><h4>${esc(f.title)}</h4><ol class="fin-pod">${pod}</ol>${mine ? `<div class="fin-mine">${mine}</div>` : ''}</button>`;
  };
  return `<section class="fin-sec"><h3 class="fin-t">${CUP}תוצאות סופיות</h3><div class="fin-grid">${fs.map(card).join('')}</div></section>`;
}
function renderFinal() {
  const evs = homeEvents(), cur = evs[homeFinal.ev], fs = cur ? finalsOf(cur).filter(f => f.ready) : [];
  const f = fs.find(x => x.key === homeFinal.key) || fs[0];
  if (!f) { homeFinal = null; return renderHome(); }
  const two = /-r2$/.test(f.id), fin = f.rows.filter(x => x.round === 2).length;
  const tr = x => `<tr class="${f.mine.has(x.bib) ? 'fin-me' : ''}"><td class="fin-rk">${x.rank == null ? '—' : x.rank <= 3 ? `<span class="medal">${x.rank}</span>` : x.rank}</td><td class="fin-nm">${esc(x.name)}<small>${esc(x.club || '')}</small></td>${two ? `<td><span class="fin-rd r${x.round}">R${x.round}</span></td>` : ''}<td class="fin-pt">${x.score == null ? gw(f.id, 'לא התחיל', 'לא התחילה') : x.score.toFixed(1)}</td></tr>`;
  const firstOut = f.rows.findIndex(x => x.round === 1);
  const body = f.rows.map((x, i) => (two && i === firstOut ? `<tr class="fin-cut"><td colspan="4">לא עלו לסיבוב השני · לפי הסיבוב הראשון</td></tr>` : '') + tr(x)).join('');
  const back = homeFinal.from === 'list' ? 'אירועים' : esc(evName(cur.event));
  patch($('#home'), `<div class="h-head"><button type="button" class="ios-back h-back" id="final-back"><span class="ios-back-chev"></span>${back}</button><h2 class="h-event fin-h">${CUP}תוצאות סופיות <span class="muted">· ${esc(evName(cur.event))}</span></h2></div>
    <div class="fin-chips" role="group" aria-label="קטגוריה">${fs.map(x => `<button type="button" data-final="${homeFinal.ev}:${x.key}:${homeFinal.from}" aria-pressed="${x === f}">${esc(x.title)}</button>`).join('')}</div>
    <p class="muted small">${two ? `מי שעלה לסיבוב השני (${fin}) מדורג לפי הסיבוב השני בלבד; השאר אחריהם לפי הסיבוב הראשון.` : 'סיבוב אחד: הדירוג שלו הוא הדירוג הסופי.'}</p>
    <div class="card fin-tbl"><table><thead><tr><th>#</th><th class="fin-nm">מתחרה</th>${two ? '<th>נקבע ב</th>' : ''}<th>ניקוד</th></tr></thead><tbody>${body}</tbody></table></div>`);
}

// 3.6.1 (Roei): no רשימה/מפורט switch — home = the list; on a competition day it opens straight on that
// competition's detail ("‹ אירועים" goes to the list until the home button is tapped again)
let homeListPicked = false;
function compDayIdx() { const d = todayStr(); return homeEvents().findIndex(ev => ev.dates[0] <= d && d <= ev.dates.at(-1)); }
function renderHome() {
  if (homeFinal) return renderFinal();
  if (homeOpenEvent == null && !homeListPicked) { const i = compDayIdx(); if (i >= 0) return renderHomeDetail('', true, i); }
  if (homeOpenEvent == null) return renderHomeList('');
  renderHomeDetail('', true);
}

function renderHomeList(seg) {
  const t = now();
  const evs = homeEvents();
  const rows = evs.map((ev, i) => {
    const ph = evPhase(ev, t), badge = evBadge(ev, evs);
    const meta = [ev.event.place && esc(ev.event.place), rangeLabel(ev.dates), ev.rounds.length ? `${ev.rounds.length} ראונדים` : 'הראונדים יתווספו בהמשך'].filter(Boolean).join(' · ');
    const people = new Set(ev.rounds.flatMap(r => mineOf(r.id).map(m => r.slots[m.k].name)));
    const ovl = ev.rounds.reduce((n, r) => n + (mineOf(r.id).length > 1 ? overlapsOf(r).length : 0), 0);
    const fin = finalsReady(ev);
    return `${fin ? `<div class="ev-item card ph-${ph}">` : ''}<button type="button" class="ev-row${fin ? '' : ' card'} ph-${ph}" data-ev="${i}">
      <span class="ev-main"><b>${esc(evName(ev.event))}</b><span class="muted small">${meta}</span></span>
      <span class="ev-side">${badge}<span class="small">${!ev.rounds.length || !people.size ? '' : `${people.size} ${VIEWER ? 'מהפלגיה' : 'שלי'}`}${ovl ? `${people.size ? ' · ' : ''}<span class="ovl-count">⚠︎ ${ovl} חפיפות</span>` : ''}</span></span><span class="chev"></span></button>${fin ? `<button type="button" class="fin-btn" data-final="${i}:${finalsOf(ev)[0].key}:list">${CUP}תוצאות סופיות<span class="go" aria-hidden="true">‹</span></button></div>` : ''}`;
  }).join('');
  patch($('#home'), `<div class="h-head"><h2 class="h-event">אירועים</h2>${seg}${VIEWER ? '' : `<span class="h-tools">${SIM_AT == null ? '<button type="button" class="btn btn-sm btn-ghost" id="sim-btn">▶ הדמיה</button>' : ''}<button type="button" class="btn btn-sm btn-ghost" id="clock-btn">⏱ שעון סימולציה</button></span>`}</div><div class="ev-list">${rows}</div>`);
}

// isolation open/close (+ U17 route preview) from the federation info sheet (2.4.0); close time stressed = the deadline
const hm = s => s.replace(/^0/, '');
const isoRow = r => (r.iso ? `<div class="iso"><span class="iso-k">בידוד</span><span class="iso-t"><b>${hm(r.iso.open)}</b> נפתח</span><span class="iso-ar">←</span><span class="iso-t close"><b>${hm(r.iso.close)}</b> נסגר</span>${
  r.iso.preview ? `<span class="iso-sep"></span><span class="iso-k">צפייה במסלולים</span><span class="iso-t"><b>${esc(r.iso.preview)}</b></span>` : ''}</div>` : '');

function renderHomeDetail(seg, fromList, auto = null) {
  const t = now();
  const evs = homeEvents(); const ei = homeOpenEvent ?? auto ?? focusEventIdx(); const cur = evs[Math.min(ei, evs.length - 1)]; const { event: ev, rounds } = cur;
  const days = [...new Set(rounds.map(r => r.date))];
  const chips = !fromList && evs.length > 1 ? `<div class="ev-chips" role="group" aria-label="תחרות">${evs.map((e, i) => {
    const d0 = new Date(e.dates[0] + 'T12:00:00');
    return `<button type="button" data-ev="${i}" aria-pressed="${i === ei}">${esc(evName(e.event).replace('ליגת העל ', ''))} <span class="muted">${d0.getDate()}/${d0.getMonth() + 1}</span></button>`;
  }).join('')}</div>` : '';
  const card = r => {
    const ph = r.slots.length ? stateAt(r, t, off(r.id)).phase : 'wait';
    const badge = { live: '<span class="hb live">חי עכשיו</span>', before: '<span class="hb soon">בקרוב</span>', after: '<span class="hb done">הסתיים</span>', wait: '<span class="hb wait">ממתין לסדר עלייה</span>' }[ph];
    const rk = rankedOf(r.id), rankOfK = k => rk?.find(x => x.bib === r.slots[k].bib)?.rank;
    const mine = mineOf(r.id).map(m => `<li><b>${esc(m.short)}</b> <span>${rk ? (rankOfK(m.k) ? `מקום ${rankOfK(m.k)}` : gw(r.id, 'לא התחיל', 'לא התחילה')) : `#${r.slots[m.k].order} · ${fmtHM(slotStartMs(r, m.k, off(r.id)))}`}</span></li>`).join('');
    const live = ph === 'live' ? (() => { const s = stateAt(r, t, off(r.id)); const b1 = s.boulders[0]; return `<p class="h-live">סבב ${s.n + 1} מתוך ${windowCount(r)} · בולדר 1: ${b1 ? `#${b1.order} ${esc(b1.name)}` : '—'}</p>`; })() : '';
    return `<button type="button" class="h-card card ph-${ph}" data-open="${r.id}">
      <div class="h-top"><h3>${esc(r.title)}</h3>${rk ? '<span class="hb res">תוצאות</span>' : ''}${badge}</div>
      <p class="muted small">${fmtHM(roundStart(r) + off(r.id))}${r.slots.length ? `–${fmtHM(roundEndMs(r))}` : ''} · ${r.boulders} בולדרים · סבב ${fmtDur(r.slotSec0 * 1000)}${r.slots.length ? ` · ${r.slots.filter(Boolean).length} מתחרים` : ''}</p>
      ${isoRow(r)}${live}${mine ? `<ul class="h-mine">${mine}</ul>` : `<p class="muted small">${r.slots.length ? 'אין ספורטאים שלי' : ''}</p>`}
      ${mineOf(r.id).length > 1 ? (n => n ? `<p class="small ovl-count">⚠︎ ${n} סבבים של חפיפה בטיפוס</p>` : '<p class="small ok-text">✓ ללא חפיפות בטיפוס</p>')(overlapsOf(r).length) : ''}
    </button>`;
  };
  patch($('#home'), `<div class="h-head">${fromList ? '<button type="button" class="ios-back h-back" id="home-back"><span class="ios-back-chev"></span>אירועים</button>' : ''}<h2 class="h-event">${esc(evName(ev))} <span class="muted">· ${ev.place ? esc(ev.place) + ' · ' : ''}${rangeLabel(cur.dates)}</span></h2>${seg}${VIEWER ? '' : `<span class="h-tools">${SIM_AT == null ? '<button type="button" class="btn btn-sm btn-ghost" id="sim-btn">▶ הדמיה</button>' : ''}<button type="button" class="btn btn-sm btn-ghost" id="clock-btn">⏱ שעון סימולציה</button></span>`}</div>${chips}` +
    (rounds.length ? '' : `<div class="card h-empty"><p><b>${evBadge(cur, evs)}</b></p><p class="muted">הראונדים וסדרי העלייה יתווספו כשיתפרסמו.${ev.place ? '' : ' המיקום עוד לא פורסם.'}</p></div>`) +
    finalCards(cur, ei) + days.map(d => `<section class="h-day"><h3 class="h-day-title">${dayLabel(d)}</h3><div class="h-grid">${rounds.filter(r => r.date === d).map(card).join('')}</div></section>`).join(''));
}

function showScreen(sc) {
  screen = sc;
  $('#home').hidden = sc !== 'home';
  $('#round-screen').hidden = sc !== 'round';
  $('#home-btn').setAttribute('aria-pressed', String(sc === 'home'));
  $('#round-tabs')._html = null;
  render();
}

function render() {
  applyDelays();
  if (screen === 'home') {
    $('#clock').textContent = fmtClock(now());
    $('#event-title').textContent = evName(homeEvents()[homeFinal?.ev ?? homeOpenEvent ?? focusEventIdx()].event);
    $('#round-sub').textContent = `מסך ראשי${SIM_AT != null ? ' · מצב הדמיה' : ''}`;
    renderTabs(); renderHome(); checkAlerts();
    return;
  }
  // (not while reading results: a finished round with results stays put — 2.7.2)
  if (view !== 'results' && Date.now() - lastTabTap > 5 * 60000 && stateAt(round(current), now(), off(current)).phase === 'after') {
    const next = pickDefaultRound();
    if (next !== current) { current = next; for (const x of ['mine', 'all']) $('#view-' + x)._html = null; }
  }
  const r = round(current);
  const s = stateAt(r, now(), off(r.id));
  $('#clock').textContent = fmtClock(now());
  $('#event-title').textContent = evName(evOf(r));
  $('#round-sub').textContent = `${dayLabel(r.date)} · ${r.title} · ${r.boulders} בולדרים · סבב ${fmtDur(r.slotSec0 * 1000)}${SIM_AT != null ? ' · מצב הדמיה' : ''}`;
  renderTabs(); renderBoard(r, s); renderTimer(r, s); renderNext(r, s); renderPar(r);
  const rb = $('[data-view="results"]'), rs = resultsOf(r.id), lv = !!rs?.live;
  rb.hidden = !rs;
  if (rb.classList.contains('lv') !== lv) { rb.classList.toggle('lv', lv); rb.innerHTML = 'תוצאות' + (lv ? LTAG : ''); rb.setAttribute('aria-label', lv ? 'תוצאות — חי, לא רשמי' : 'תוצאות'); }
  if (view === 'results' && !resultsOf(r.id)) { setView('mine'); return; }
  // a results problem must never stop the clock + alerts below (audit 2026-10-15)
  if (view === 'results') try { renderResults(r); } catch (e) { console.error('results', e); }
  if (view === 'mine') renderMine(r);
  if (view === 'all') renderAll(r);
  if (view === 'log') renderLog();
  const t = now();
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = fmtDur(Number(el.dataset.until) - t); });
  checkAlerts();
}

// ---- 3.3.0 training simulation clock (boulder only): windows of 4/5 min (or custom), World Climbing signals ----
const sc = { len: 300, n: 10, t0: 0, paused: 0, timer: null, last: null };
function beep(freq, dur, at = 0) {
  ensureAudio(); if (!audio) return;
  const t0 = audio.currentTime + at, o = audio.createOscillator(), g = audio.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.35, t0 + 0.01); g.gain.setValueAtTime(0.35, t0 + dur - 0.03); g.gain.linearRampToValueAtTime(0, t0 + dur);
  o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
const LONG = () => beep(880, 1.1), SHORT = () => beep(1320, 0.18), MIN = () => beep(1100, 0.45);
function openClock() {
  $('#sc-setup').hidden = false; $('#sc-run').hidden = true;
  $('#clock-dlg').showModal();
}
function scState(t = performance.now()) {
  const el = (sc.paused || t) - sc.t0; // ms since the first window started (negative = countdown)
  if (el < 0) return { phase: 'count', left: -el };
  const w = Math.floor(el / (sc.len * 1000));
  if (w >= sc.n) return { phase: 'done' };
  return { phase: 'run', w, left: (w + 1) * sc.len * 1000 - el };
}
function scTick() {
  const s = scState();
  const secs = s.left != null ? Math.ceil(s.left / 1000) : 0;
  const key = s.phase === 'done' ? 'done' : `${s.phase}:${s.w ?? -1}:${secs}`;
  if (key !== sc.last && !sc.paused) { // signals, once per second change
    if (s.phase === 'run' && secs === sc.len) LONG();               // window starts
    else if (s.phase === 'run' && secs === 60 && sc.len > 60) MIN(); // one minute left
    else if ((s.phase === 'run' || s.phase === 'count') && secs >= 1 && secs <= 5) SHORT(); // last 5 seconds
    else if (s.phase === 'done' && sc.last !== 'done') LONG();       // end of the last window
    sc.last = key;
  }
  $('#sc-time').textContent = s.phase === 'done' ? '0:00' : fmtDur(s.left);
  $('#sc-time').classList.toggle('warn', s.phase === 'run' && s.left <= 60000);
  $('#sc-round').textContent = s.phase === 'count' ? 'מתחילים בעוד' : s.phase === 'done' ? 'הסימולציה הסתיימה' : `סבב ${s.w + 1} מתוך ${sc.n}`;
  if (s.phase === 'done') { clearInterval(sc.timer); sc.timer = null; $('#sc-pause').hidden = true; }
}
function startClock() {
  const pick = document.querySelector('[data-sc-len][aria-pressed="true"]').dataset.scLen;
  if (pick === 'custom') { const [m, sec = '0'] = $('#sc-len').value.split(':'); sc.len = Math.max(30, (+m || 0) * 60 + (+sec || 0)); }
  else sc.len = Number(pick);
  sc.n = Math.min(60, Math.max(1, Number($('#sc-n').value) || 10));
  ensureAudio(); keepAwake();
  sc.t0 = performance.now() + 10000; sc.paused = 0; sc.last = null;
  $('#sc-setup').hidden = true; $('#sc-run').hidden = false; $('#sc-pause').hidden = false; $('#sc-pause').textContent = 'עצירה';
  clearInterval(sc.timer); sc.timer = setInterval(scTick, 100); scTick();
}
function pauseClock() {
  if (sc.paused) { sc.t0 += performance.now() - sc.paused; sc.paused = 0; $('#sc-pause').textContent = 'עצירה'; }
  else { sc.paused = performance.now(); $('#sc-pause').textContent = 'המשך'; }
}
function stopClock() { clearInterval(sc.timer); sc.timer = null; $('#clock-dlg').close(); }

// ---- 3.2.0: rounds at the same time + swipe between rounds ----
// another round whose climbing overlaps this one, both with my athletes (happens sometimes in the schedule — Roei)
function parRound(r) {
  if (!r.slots.length || !mineOf(r.id).length) return null;
  const a0 = roundStart(r) + off(r.id), a1 = roundEndMs(r);
  return DATA.rounds.find(x => x.id !== r.id && x.slots.length && x.date === r.date && mineOf(x.id).length
    && roundStart(x) + off(x.id) < a1 && roundEndMs(x) > a0) || null;
}
function renderPar(r) {
  const par = parRound(r), el = $('#par');
  el.hidden = !par; if (!par) return;
  const s = stateAt(par, now(), off(par.id));
  const head = s.phase === 'live' ? `סבב ${s.n + 1} · נותר <b class="par-t${s.slotLeftMs <= 60000 ? ' warn' : ''}">${fmtDur(s.slotLeftMs)}</b>`
    : s.phase === 'before' ? `מתחיל בעוד <b class="par-t">${fmtDur(roundStart(par) + off(par.id) - now())}</b>` : 'הסתיים';
  if (!el.querySelector('.par-board')) el.innerHTML = '<div class="par-top"></div><div class="par-board board"></div>';
  patch(el.querySelector('.par-top'), `<b>במקביל: ${esc(par.title)}</b><span class="par-clock">${head}</span><button type="button" class="btn btn-sm btn-ghost" data-go-round="${par.id}">לעבור לסבב</button>`);
  renderBoard(par, s, el.querySelector('.par-board'));
}
// the rounds a swipe steps through: the open competition, by start time; by default only rounds with my athletes
function swipeSeq() {
  const r = round(current);
  return roundsOf(evOf(r)).filter(x => x.id === current || !store.settings.swipeMine || mineOf(x.id).length)
    .sort((a, b) => roundStart(a) - roundStart(b));
}
function goRound(id) {
  lastTabTap = Date.now(); current = id;
  for (const x of ['mine', 'all', 'results', 'log']) $('#view-' + x)._html = null;
  $('#par').innerHTML = ''; editId = null;
  openRoundView(); render();
}
function swipeToast(seq, i) {
  document.querySelectorAll('.toast.swipe').forEach(x => x.remove());
  const el = document.createElement('div'); el.className = 'toast swipe';
  el.innerHTML = `<b>${esc(seq[i].title)}</b> <span class="muted-on-dark">${dayLabel(seq[i].date)}</span><span class="dots" aria-hidden="true">${seq.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span>`;
  document.body.append(el); setTimeout(() => el.remove(), 1600);
}
// finger moving left → right = next round (Roei 2026-10-14). Only a long, clearly sideways swipe; never on areas that
// scroll sideways (full list, results, chips, tabs), in a dialog or a text field, or from the screen edge (Safari back).
function setupSwipe() {
  // 3.3.1: the round screen follows the finger, then slides out and the next round slides in from the other side
  let st = null;
  const main = $('#round-screen'), still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const put = (x, ms) => { main.style.transition = ms ? `transform ${ms}ms ease, opacity ${ms}ms ease` : 'none'; main.style.transform = x ? `translateX(${x}px)` : ''; main.style.opacity = x ? String(Math.max(.35, 1 - Math.abs(x) / innerWidth)) : ''; };
  addEventListener('touchstart', e => {
    st = null;
    if (screen !== 'round' || e.touches.length !== 1 || document.querySelector('dialog[open]')) return;
    const t = e.touches[0], tg = e.target;
    if (t.clientX < 28 || t.clientX > innerWidth - 28) return;
    if (tg.closest('.full-wrap, .tbl-wrap, .seg, #round-tabs, input, textarea, select')) return;
    st = { x: t.clientX, y: t.clientY, at: Date.now(), drag: false };
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (!st || still()) return;
    const t = e.touches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
    if (!st.drag && Math.abs(dx) > 14 && Math.abs(dx) > 1.6 * Math.abs(dy)) st.drag = true;
    if (st.drag) put(dx * .55, 0);
  }, { passive: true });
  const back = () => { if (main.style.transform) put(0, 180); };
  addEventListener('touchcancel', () => { st = null; back(); }, { passive: true });
  addEventListener('touchend', e => {
    if (!st) return;
    const t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y, ms = Date.now() - st.at; st = null;
    if (Math.abs(dx) < 90 || Math.abs(dx) < 2.2 * Math.abs(dy) || ms > 700) { back(); return; }
    const seq = swipeSeq(), i = seq.findIndex(x => x.id === current), j = i + (dx > 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= seq.length) { back(); showToast(dx > 0 ? 'זה הסבב האחרון' : 'זה הסבב הראשון'); return; }
    if (still()) { put(0, 0); goRound(seq[j].id); swipeToast(seq, j); return; }
    const w = Math.sign(dx) * innerWidth * .6;
    put(w, 160);
    setTimeout(() => {
      goRound(seq[j].id); swipeToast(seq, j);
      put(-w, 0); main.getBoundingClientRect(); // jump to the other side, then slide in
      put(0, 220);
      setTimeout(() => { main.style.transition = ''; }, 240);
    }, 160);
  }, { passive: true });
}

// ---- alerts: one window before my athlete starts, and 1 minute before ----
let audio = null;
const TONES = {
  chime: { type: 'sine', notes: [[880, 0, .35], [1175, .18, .35], [880, .36, .4]] },
  beep: { type: 'square', notes: [[1000, 0, .12], [1000, .2, .12], [1000, .4, .12]] },
  alarm: { type: 'sawtooth', notes: [[700, 0, .25], [1000, .25, .25], [700, .5, .25], [1000, .75, .25], [700, 1, .3]] },
};
function chime(force = false) {
  const snd = store.settings.sound;
  if (!audio || (!snd.on && !force) || (userOff && !force)) return; // bell off (3.6.0) = no alert sound
  if (audio.state !== 'running') audio.resume().catch(() => {});
  const t0 = audio.currentTime; const tone = TONES[snd.tone] || TONES.chime; const peak = 0.5; // loudness = the device volume (3.0.0)
  tone.notes.forEach(([f, d, len]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; o.type = tone.type;
    g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(peak, t0 + d + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + d + len);
    o.connect(g).connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + len + .05);
  });
}
function ensureAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari 16.4+ only */ }
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume();
    const src = audio.createBufferSource(); src.buffer = audio.createBuffer(1, 1, 22050); src.connect(audio.destination); src.start(0); // iOS: a sound inside the gesture unlocks it
  } catch { audio = null; }
}

// One banner per athlete: a newer alert for the same athlete replaces the older one (Roei 2026-10-12).
function showAlert(text, cls, group = '') {
  if (group) document.querySelectorAll('#alerts .alert').forEach(x => { if (x.dataset.group === group) x.remove(); });
  const el = document.createElement('div');
  el.className = 'alert ' + cls;
  el.dataset.group = group;
  el.innerHTML = `<span>${esc(text)}</span><button type="button" aria-label="סגירה">✕</button>`;
  el.querySelector('button').onclick = () => el.remove();
  $('#alerts').prepend(el);
  setTimeout(() => el.remove(), 4 * 60000);
  chime();
}

// Every alert for my athletes in all rounds (same list drives the in-app banner and the lock-screen push).
const ALERT_LBL = { w2: '2 סבבים', w1: 'סבב אחד', m2: '2 דקות', m1: 'דקה', s10: '10 שניות' };
function alertEntries() {
  applyDelays();
  const out = [];
  for (const r of DATA.rounds) {
    for (const m of mineOf(r.id)) {
      const startMs = slotStartMs(r, m.k, off(r.id));
      const s = r.slots[m.k];
      const transferMs = s.transfer ? zonedMs(`${r.date}T${s.transfer.padStart(8, '0')}`) : null;
      // Each alert stays due until the next chosen one (late alerts still useful: app was backgrounded /
      // clock recalibrated); a recalibration by ≥ half a window re-arms it at the new time.
      for (const a of alertPlan(r, m.k, off(r.id), store.settings.alerts, transferMs)) {
        const key = `${r.id}:${m.k}:${a.type}:${Math.round(off(r.id) / (r.slotSec * 1000))}`;
        const text = a.type === 'transfer'
          ? `מעבר לנורמן: ${m.short} (#${s.order}) · עולה ב-${fmtClock(startMs)}`
          : a.type === 's0' ? `עולה עכשיו: ${m.short} (#${s.order}, גב ${s.bib}) לבולדר 1 · ${fmtClock(startMs)}`
          : `${ALERT_LBL[a.type]}: ${m.short} (#${s.order}, גב ${s.bib}) עולה לבולדר 1 ב-${fmtClock(startMs)}`;
        out.push({ key, tag: `${r.id}:${m.k}`, at: a.at, until: a.until, text, cls: ['m1', 'm2', 's10', 's0'].includes(a.type) ? 'now' : 'soon',
          title: a.type === 'transfer' ? `${m.short} · מעבר לנורמן` : a.type === 's0' ? `${m.short} · עולה עכשיו` : `${m.short} · עוד ${ALERT_LBL[a.type]}`,
          body: `${text} · ${r.title}` });
      }
    }
  }
  return out;
}

function checkAlerts() {
  if (VIEWER) return;
  const t = now();
  for (const a of alertEntries()) {
    if (t >= a.at && t < a.until && !fired.was(a.key)) { fired.mark(a.key); showAlert(a.text, a.cls, a.tag); }
  }
}

// ---- lock-screen alerts (Web Push via the comp-push Worker) ----
// The plan is sent whenever it changes (settings, calibration, my athletes); the Worker sends each alert on time
// even when the app is closed. Needs the Home Screen app on iPadOS 16.4+ and a connection when the alert fires.
const PUSH_URL = 'https://comp-push.palgiacademy.workers.dev';
let pushKey = null, pushSent = '', pushNextTry = 0;
async function pushHeaders() {
  if (!pushKey) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('comp-push:' + store.code));
    pushKey = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return { 'Content-Type': 'application/json', 'X-Comp-Key': pushKey };
}
async function pushCall(path, body) {
  const res = await fetch(PUSH_URL + path, { method: 'POST', headers: await pushHeaders(), body: JSON.stringify({ device: store.push.device, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || String(res.status));
  return data;
}
function pushEnv() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (SIM_AT != null) return 'sim';
  if (ios && !standalone) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}
async function syncPush(force = false) {
  if (VIEWER) return;
  if (!store.push.on || pushEnv() !== 'ready' || Notification.permission !== 'granted') return;
  const t = Date.now();
  if (!force && t < pushNextTry) return;
  const alerts = alertEntries().filter(a => a.until > t).map(({ key, tag, at, until, title, body }) => ({ key, tag, at, until, title, body }));
  const sig = JSON.stringify(alerts);
  if (!force && sig === pushSent) return;
  pushNextTry = t + 5000;
  try { await pushCall('/schedule', { alerts }); pushSent = sig; renderPushState(); }
  catch (e) {
    pushNextTry = t + 30000;
    if (e.message === 'not subscribed') await pushSubscribe().catch(() => {}); // server lost us: subscribe again
  }
}
async function pushSubscribe() {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch(PUSH_URL + '/key')).json();
  const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const key = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await pushCall('/subscribe', { sub: sub.toJSON() });
}
async function pushEnable() {
  const perm = Notification.requestPermission(); // must start inside the tap (iOS)
  store.setPush(true);
  try {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    if (await perm !== 'granted') throw new Error('perm');
    await pushSubscribe();
    pushSent = ''; await syncPush(true);
    showToast('התראות על מסך נעול הופעלו ✓');
  } catch (e) {
    store.setPush(false);
    showToast(e.message === 'perm' ? 'לא אושרו התראות. אפשר לאשר בהגדרות האייפד → התראות → פורטל התחרויות' : 'אין חיבור לשרת ההתראות. נסה שוב.');
  }
  renderPushState();
}
async function pushDisable() {
  store.setPush(false);
  try { await pushCall('/unsubscribe', {}); } catch { /* offline: the server drops it when the push fails */ }
  try { await (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.unsubscribe(); } catch { /* ignore */ }
  pushSent = ''; renderPushState();
}
async function renderPushState() {
  const box = $('#push-state'); if (!box) return;
  const env = pushEnv(), on = store.push.on && env === 'ready';
  $('#push-toggle').setAttribute('aria-checked', String(on));
  $('#push-toggle').disabled = env !== 'ready';
  $('#push-test').hidden = !on;
  if ($('#v-push')) $('#v-push').textContent = on ? 'פעיל' : 'כבוי';
  const msg = {
    sim: 'לא זמין במצב הדמיה.',
    'ios-install': 'עובד רק מהאייקון במסך הבית. ',
    unsupported: 'המכשיר לא תומך בהתראות (צריך iPadOS 16.4 ומעלה).',
    denied: 'ההתראות חסומות: הגדרות האייפד ← התראות ← פורטל התחרויות ← אפשר.',
  }[env];
  if (msg) { box.textContent = msg; if (env === 'ios-install') box.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-sm btn-ghost" data-install-open>איך מוסיפים?</button>'); return; }
  if (!on) { box.textContent = 'כבוי · ההתראות מופיעות רק כשהאפליקציה פתוחה.'; return; }
  box.textContent = pushSent ? 'פעיל ✓ · בודק בשרת…' : 'פעיל · ממתין לחיבור לשרת…';
  try {
    const st = await (await fetch(`${PUSH_URL}/status?device=${encodeURIComponent(store.push.device)}`, { headers: await pushHeaders() })).json();
    const serverOk = !st.pending || st.alarm != null; // the Worker's alarm is armed for the next alert
    box.textContent = !st.subscribed ? 'פעיל · נרשם מחדש לשרת…'
      : `פעיל ✓ · ${st.pending} התראות מתוזמנות${st.next ? ` · הבאה ${fmtHM(st.next.at)} (${st.next.title})` : ''}${serverOk ? ' · שרת תקין' : ' · ⚠︎ שרת ההתראות לא מגיב כרגע'}`;
  } catch { box.textContent = 'פעיל · אין חיבור לשרת כרגע (ההתראות שכבר נשלחו לשרת יגיעו).'; }
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
// 3.6.0 (Roei): no "התחל מעקב" bar. Sound + screen-on start on the first touch anywhere (setting autoArm, default on —
// Safari allows audio / wake lock only from a user gesture); the bell in the header shows the state and toggles it.
let armed = false, userOff = false;
function arm() { ensureAudio(); keepAwake(); armed = true; userOff = false; renderBell(); }
function disarm() { armed = false; userOff = true; try { wakeLock?.release(); } catch { /* already gone */ } wakeLock = null; audio?.suspend?.().catch(() => {}); renderBell(); }
function renderBell() {
  const b = $('#arm-btn'); if (!b) return;
  b.setAttribute('aria-pressed', String(armed)); b.classList.toggle('off', !armed);
  b.setAttribute('aria-label', armed ? 'צליל ומסך דלוק · פעיל (לחיצה מכבה)' : 'צליל ומסך דלוק · כבוי (לחיצה מדליקה)');
}
function setupAutoArm() {
  const first = e => { if (!armed && !userOff && !VIEWER && store.settings.autoArm && !e.target.closest?.('#arm-btn')) arm(); };
  for (const ev of ['click', 'touchend']) document.addEventListener(ev, first, { capture: true, passive: true });
  renderBell();
}

// ---- dialogs ----
function currentCtx(r, k) {
  return statusText(r, athleteStatus(r, k, now(), off(r.id)));
}

function openNote(k, rid = current) {
  const r = round(rid); const s = r.slots[k];
  $('#note-title').textContent = `הערה · ${shortOf(r.id, k)}`;
  $('#note-ctx').textContent = `${r.title} · ${fmtClock(now())} · ${currentCtx(r, k)}`;
  $('#note-text').value = '';
  const dlg = $('#note-dlg'); dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'save' || !$('#note-text').value.trim()) return;
    store.addNote({ round: r.id, k, short: shortOf(r.id, k), name: s.name, at: now(), ctx: currentCtx(r, k), text: $('#note-text').value.trim() });
    render();
  };
  dlg.showModal();
}

function openAppeal(k, rid = current) {
  const r = round(rid); const s = r.slots[k];
  const st = athleteStatus(r, k, now(), off(r.id));
  const def = st.kind === 'boulder' ? st.boulder : st.kind === 'rest' ? st.from : st.kind === 'waiting' ? 1 : r.boulders;
  const who = shortOf(r.id, k) || s.name;
  $('#appeal-who').textContent = `${shortOf(r.id, k) ? `${who} · ` : ''}${s.name} · #${s.order} · גב ${s.bib} · ${r.title}`;
  $('#appeal-boulder').innerHTML = Array.from({ length: r.boulders }, (_, i) => `<option ${i + 1 === def ? 'selected' : ''}>${i + 1}</option>`).join('');
  $('#appeal-time').value = fmtClock(now());
  $('#appeal-text').value = '';
  const dlg = $('#appeal-dlg'); dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'save' || !$('#appeal-text').value.trim()) return;
    store.addAppeal({ round: r.id, k, short: who, name: s.name, bib: s.bib, order: s.order, at: now(),
      boulder: $('#appeal-boulder').value, time: $('#appeal-time').value, text: $('#appeal-text').value.trim() });
    showToast('הערעור נשמר · בלשונית "הערות וערעורים"'); render();
  };
  dlg.showModal();
}

function setView(v) {
  view = v; if (v === 'all') scrollAll = true;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  for (const x of ['mine', 'all', 'log', 'results']) { const el = $('#view-' + x); el.hidden = x !== v; el._html = null; }
  render();
}

function adjust(kind) {
  const r = round(current); const S = r.slotSec * 1000; let o = off(r.id);
  if (store.settings.lock) { showToast('הכיול נעול · אפשר לפתוח בהגדרות או ב"פתח נעילה"'); return; }
  const step = store.settings.step * 1000;
  if (kind === '+step') o += step; else if (kind === '-step') o -= step;
  else if (kind === '+1') o += 1000; else if (kind === '-1') o -= 1000;
  else if (kind === '+slot') o += S; else if (kind === '-slot') o -= S;
  else if (kind === 'now') {
    const t = now(); const o2 = syncWindowNow(r, t, o); const d = o2 - o;
    const b1 = stateAt(r, t, o2).boulders[0];
    return confirmSync('הסבב מתחיל עכשיו?', `השעון יזוז ${d >= 0 ? 'אחורה (התחרות מאחרת)' : 'קדימה (התחרות מקדימה)'} בכ-${fmtDur(Math.abs(d))}. אחרי הסנכרון על בולדר 1: ${b1 ? `#${b1.order} ${b1.name}` : 'אף אחד (סבב ריק)'}. אם זה לא מי שעולה עכשיו — לחץ ביטול והשתמש ב"מתחיל עכשיו" ליד המתחרה בסדר העלייה המלא.`, () => syncWindowNow(r, now(), off(r.id)));
  }
  store.setOffset(r.id, o);
  render();
}

// Every sync that jumps the clock asks first (Roei: a stray tap must not move the round).
function askConfirm(title, text, okLabel, onOk) {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  const dlg = $('#confirm-dlg');
  dlg.onclose = () => { if (dlg.returnValue === 'ok') onOk(); };
  dlg.returnValue = '';
  dlg.showModal();
}

function confirmSync(title, text, newOffset) {
  const r = round(current);
  $('#confirm-ok').textContent = 'סנכרון';
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  const dlg = $('#confirm-dlg');
  // newOffset() is computed at the moment of confirming, not when the dialog opened.
  dlg.onclose = () => { if (dlg.returnValue === 'ok') { store.setOffset(r.id, newOffset()); render(); } };
  dlg.returnValue = '';
  dlg.showModal();
}

function syncFromSlot(k) {
  if (store.settings.lock) { showToast('הכיול נעול · אפשר לפתוח בהגדרות'); return; }
  const r = round(current); const s = r.slots[k]; const o = syncSlotNow(r, k, now());
  confirmSync(`#${s.order} ${s.name} ${gw(r.id, 'מתחיל', 'מתחילה')} עכשיו?`, `כל הסבב יכויל כך ש-#${s.order} עולה עכשיו לבולדר 1 (${o === off(r.id) ? 'ללא שינוי' : `${o > off(r.id) ? 'מאחר' : 'מקדים'} ב-${fmtDur(Math.abs(o - off(r.id)))} לעומת הכיול הנוכחי`}).`, () => syncSlotNow(r, k, now()));
}

function openManual() {
  if (store.settings.lock) { showToast('הכיול נעול · אפשר לפתוח בהגדרות'); return; }
  const r = round(current);
  const cur = roundStart(r) + off(r.id);
  $('#manual-ctx').textContent = `${r.title} · לפי סדר העלייה ${fmtClock(roundStart(r))} · כרגע ${fmtClock(cur)}`;
  $('#manual-time').value = fmtClock(cur);
  const dlg = $('#manual-dlg'); dlg.returnValue = '';
  dlg.onclose = () => {
    const v = $('#manual-time').value;
    if (dlg.returnValue !== 'save' || !v) return;
    const [h, m, sec = '0'] = v.split(':');
    store.setOffset(r.id, syncManualStart(r, zonedMs(`${r.start.slice(0, 10)}T${pad(+h)}:${pad(+m)}:${pad(+sec)}`)));
    render();
  };
  dlg.showModal();
}

function openSim() {
  $('#sim-round').innerHTML = DATA.rounds.filter(r => r.slots.length)
    .map(r => `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${dayLabel(r.date)} · ${esc(r.title)}</option>`).join('');
  const dlg = $('#sim-dlg'); dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'go') return;
    const r = round($('#sim-round').value); const S = r.slotSec * 1000; const T0 = roundStart(r);
    const span = windowCount(r) * S;
    const from = $('#sim-from').value;
    const firstMine = mineOf(r.id)[0];
    const at = from === 'mine' && firstMine ? T0 + (firstMine.k - 1) * S - 5000
      : from === 'mid' ? T0 + span / 2 : from === 'end' ? T0 + span - 15 * 60000 : T0 - 120000;
    const d = zoneParts(at);
    const iso = `${d.y}-${pad(d.mo)}-${pad(d.d)}T${fmtClock(at)}`;
    location.href = `./?at=${iso}&speed=${$('#sim-speed').value}&round=${r.id}`;
  };
  dlg.showModal();
}

async function copy(text) { try { await navigator.clipboard.writeText(text); showToast('הועתק'); } catch { showToast('ההעתקה נכשלה'); } }
function showToast(text) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  document.body.append(el); setTimeout(() => el.remove(), 1800);
}

// 3.8.0 live score toast (red, bottom): "name · בולדר N · זון/טופ בניסיון K"; max 3 on screen, 6 s each, tap closes
function liveToast(e) {
  let box = $('#live-toasts');
  if (!box) { box = document.createElement('div'); box.id = 'live-toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const el = document.createElement('button'); el.type = 'button'; el.className = 'ltoast';
  el.innerHTML = `<span class="k">${e.kind === 'top' ? 'T' : 'Z'}</span>${esc(e.name)} · בולדר ${e.b} · ${e.kind === 'top' ? 'טופ' : 'זון'} בניסיון ${e.att}`;
  el.addEventListener('click', () => el.remove());
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), 6000);
}

// ---- sync between the coach's devices (sync.js) ----
function syncLabel(short = false) {
  if (SIM_AT != null) return short ? 'כבוי' : 'הדמיה · לא מסונכרן';
  const n = store.pendingCount();
  if (n && syncState.ok === false) return `${n} ממתינים לחיבור`;
  if (n) return short ? 'מסנכרן…' : `${n} שינויים נשלחים…`;
  if (syncState.ok === true || store.lastSync) return `${short ? '' : 'מסונכרן '}✓ ${fmtHM(syncState.at || store.lastSync)}`;
  return syncState.ok === false ? 'אין חיבור' : 'מתחבר…';
}
function renderSyncState() {
  if ($('#v-sync')) $('#v-sync').textContent = syncLabel(true);
  if ($('#sync-state')) $('#sync-state').textContent = syncLabel();
  if ($('#sync-devices')) {
    $('#sync-devices').textContent = store.deviceCount > 1 ? `מכשירים: ${[store.devName, ...store.deviceNames()].join(' · ')}` : 'עוד לא התחבר מכשיר נוסף עם הקוד.';
  }
  const lg = $('#view-log .log-sync'); if (lg) lg.textContent = syncLabel();
}
function onRemote(ch) {
  if (ch.photos?.length && $('#photos-dlg').open) renderPhotoGrid();
  if (ch.tags?.length && $('#tags-dlg').open && !tagEdit) renderTagList();
  for (const x of ['mine', 'all', 'log', 'home']) if ($('#view-' + x)) $('#view-' + x)._html = null;
  render(); renderSyncState();
  const other = ch.offsets.filter(o => o.dev && o.dev !== store.device);
  if (other.length) {
    const r = round(other[0].round);
    showToast(`הכיול${r ? ' של ' + r.title : ''} עודכן ממכשיר אחר${store.deviceName(other[0].dev) ? ' (' + store.deviceName(other[0].dev) + ')' : ''}`);
  }
}

// ---- boulder photos (2.1.0): one per boulder per round. The coach adds / replaces / deletes; coach + viewers see.
// Versions arrive with the normal sync (store.photoV); simulation mode never syncs → reads /photo/list per round instead.
// The bytes are fetched once per version (the server lets the browser cache a version for good).
const photoCache = new Map(); // "round:b" → { v, url, fail }
const phLocal = new Map();    // my own upload/delete until sync confirms it: "round:b" → { v, del }
const simPhotos = {};         // simulation: round → { at, list: { b: v } }
let gridRound = null, upTarget = null;
const busyPh = new Set();
const phQ = (rid, b) => `round=${encodeURIComponent(rid)}&b=${b}`;
function photoV(rid, b) {
  let sv;
  if (SIM_AT == null) sv = store.photoV(rid, b);
  else {
    const sp = simPhotos[rid];
    if (!sp || Date.now() - sp.at > 60000) loadPhotoList(rid);
    sv = sp?.list[b] || 0;
  }
  const id = rid + ':' + b, mine = phLocal.get(id);
  if (!mine) return sv;
  if (mine.del ? !sv || sv > mine.v : sv >= mine.v) { phLocal.delete(id); return sv; } // sync caught up (or someone changed it since)
  return mine.del ? 0 : mine.v;
}
async function loadPhotoList(rid) {
  const sp = simPhotos[rid] = simPhotos[rid] || { at: 0, list: {} }; sp.at = Date.now();
  try {
    const res = await fetch(`${SYNC_URL}/photo/list?round=${encodeURIComponent(rid)}`, { headers: await authHeaders(VIEWER) });
    if (res.ok) { sp.list = (await res.json()).photos || {}; if ($('#photos-dlg').open) renderPhotoGrid(); }
  } catch { /* offline: try again in a minute */ }
}
function photoUrl(rid, b) {
  const v = photoV(rid, b); if (!v) return null;
  const id = rid + ':' + b, c = photoCache.get(id);
  if (c && c.v === v && (c.url || !c.fail || Date.now() - c.fail < 15000)) return c.url;
  photoCache.set(id, { v, url: null, fail: 0 });
  (async () => {
    let url = null;
    try {
      const res = await fetch(`${SYNC_URL}/photo?${phQ(rid, b)}&v=${v}`, { headers: await authHeaders(VIEWER) });
      if (res.ok) url = URL.createObjectURL(await res.blob());
    } catch { /* offline */ }
    const cur = photoCache.get(id); if (cur?.v !== v) return;
    if (url) cur.url = url; else cur.fail = Date.now();
    if ($('#photos-dlg').open) renderPhotoGrid();
  })();
  return null;
}
function openPhotos() {
  gridRound = current; renderPhotoGrid();
  if (SIM_AT == null && !VIEWER) syncNow(); else if (SIM_AT != null) loadPhotoList(gridRound);
  $('#photos-dlg').showModal();
}
function renderPhotoGrid() {
  const r = round(gridRound); if (!r) return;
  $('#photos-title').textContent = `תמונות בולדרים · ${r.title}`;
  $('#photos-grid').innerHTML = Array.from({ length: r.boulders }, (_, j) => {
    const b = j + 1, v = photoV(r.id, b), u = photoUrl(r.id, b), busy = busyPh.has(r.id + ':' + b), dis = busy ? ' disabled' : '';
    const pic = u && !busy ? `<button type="button" class="ph-pic" data-photo="${b}" aria-label="הגדלת בולדר ${b}"><img src="${u}" alt="בולדר ${b}"></button>`
      : `<div class="ph-empty">${busy ? 'מעלה…' : v ? 'טוען…' : 'אין תמונה'}</div>`;
    const acts = VIEWER ? '' : v ? `<div class="ph-acts"><button type="button" class="btn btn-ghost btn-sm" data-ph-up="${b}"${dis}>החלף</button><button type="button" class="btn btn-ghost btn-sm danger" data-ph-del="${b}"${dis}>מחק</button></div>`
      : `<button type="button" class="btn btn-primary btn-sm" data-ph-up="${b}"${dis}>📷 הוסף תמונה</button>`;
    return `<div class="ph-cell"><b>בולדר ${b}</b>${pic}${acts}</div>`;
  }).join('');
}
function openPhoto(rid, b) {
  const u = photoUrl(rid, b); if (!u) return;
  $('#photo-title').textContent = `בולדר ${b} · ${round(rid).title}`;
  $('#photo-img').src = u;
  $('#photo-dlg').showModal();
}
// ---- boulder tags (3.7.0): the coach tags each boulder (wall angle → style → style questions), any time — before,
// during or after the round. Shared between the coach's devices; viewers see wall + style on the board only.
// Layout = the map Roei approved (docs/specs/2026-10-15-boulder-tagging-map.html).
const WALL_ICON = {
  slab: 'M12 37 L28 4', face: 'M20 37 L20 4', light: 'M25 37 L15 4', strong: 'M32 37 L16 14 L3 11', corner: 'M20 37 L20 13 M20 13 L6 4 M20 13 L34 4',
};
const wallSvg = id => `<svg class="wall-ic" viewBox="0 0 40 40" aria-hidden="true"><line class="g" x1="2" y1="37" x2="38" y2="37"/><path class="w" d="${WALL_ICON[id] || ''}"/></svg>`;
const SEC_HE = { zone: 'זון', top: 'טופ' };
// board (3.7.1, Roei picked option A): wall drawing + style; a split boulder gets a round Z / T marker before each tag.
// Tapping a tag shows a small popover with the part, the wall-angle name and the style (coach + viewers).
function boardTag(rid, b) {
  const t = store.tag(rid, b); if (!t) return '';
  const one = (x, sec) => (x?.wall || x?.style ? `<button type="button" class="btag${x.style ? ' st-' + x.style : ''}" data-tg-pop="${esc(rid)}|${b}|${sec}" aria-label="${esc([x.wall && wallOf(x.wall).l, x.style && styleOf(x.style).l].filter(Boolean).join(' · '))}">${x.wall ? wallSvg(x.wall) : ''}${x.style ? esc(styleOf(x.style).l) : ''}</button>` : '');
  const same = t.mode === 'whole' || (t.zone.wall === t.top.wall && t.zone.style === t.top.style);
  if (same) { const h = one(t.zone, 'whole'); return h ? `<div class="btags">${h}</div>` : ''; }
  const row = (x, sec, l) => { const h = one(x, sec); return h ? `<div class="zrow"><span class="zt" aria-hidden="true">${l}</span>${h}</div>` : ''; };
  const html = row(t.zone, 'zone', 'Z') + row(t.top, 'top', 'T');
  return html ? `<div class="btags split">${html}</div>` : '';
}
function showTagPop(btn) {
  const [rid, b, sec] = btn.dataset.tgPop.split('|'), t = store.tag(rid, Number(b)); if (!t) return;
  const x = sec === 'top' ? t.top : t.zone, st = styleOf(x.style);
  const pop = $('#tag-pop');
  pop.innerHTML = `<div class="tp-r"><b>${sec === 'whole' ? 'כל הבולדר' : SEC_HE[sec]}</b><span class="muted">בולדר ${b}</span></div>
    ${x.wall ? `<div class="tp-r">${wallSvg(x.wall)}<span>${esc(wallOf(x.wall).l)}</span></div>` : ''}
    ${st ? `<div class="tp-r"><span class="tpill st st-${st.id}">${esc(st.l)}</span></div>` : ''}`;
  pop.hidden = false;
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
}
let tagRound = null, tagEdit = null; // tagEdit = { b, draft, sec } while the form is open
const blankSec = () => ({ wall: null, style: null, feet: [], sub: {} });
function openTags() {
  tagRound = current; tagEdit = null; renderTagList();
  $('#tags-dlg').showModal();
}
function tagLine(x) {
  if (!x?.wall && !x?.style) return '<span class="muted">לא תויג</span>';
  const st = styleOf(x.style), parts = [];
  if (x.wall) parts.push(`<span class="tpill">${wallSvg(x.wall)}${esc(wallOf(x.wall).l)}</span>`);
  if (x.feet?.length) parts.push(`<span class="tpill">${x.feet.map(f => esc(FEET.o.find(o => o.id === f)?.l)).join(' + ')}</span>`);
  if (st) {
    parts.push(`<span class="tpill st st-${st.id}">${esc(st.l)}</span>`);
    for (const q of st.q) if (x.sub?.[q.id]?.length) parts.push(`<span class="tpill">${x.sub[q.id].map(o => esc(q.o.find(z => z.id === o)?.l)).join(' + ')}</span>`);
  }
  return parts.join('');
}
function tagSummary(t) {
  if (!t) return '<div class="tg-row"><span class="muted">לא תויג</span></div>';
  const rows = t.mode === 'whole' ? [['כל הבולדר', t.zone]] : [['זון', t.zone], ['טופ', t.top]];
  return rows.map(([l, x]) => `<div class="tg-row"><b>${l}</b>${tagLine(x)}</div>`).join('') + (t.note ? `<div class="tg-row tg-note">${esc(t.note)}</div>` : '');
}
function renderTagList() {
  const r = round(tagRound); if (!r) return;
  $('#tags-title').textContent = `תיוג בולדרים · ${r.title}`;
  $('#tags-body').innerHTML = `<div class="tg-list">${Array.from({ length: r.boulders }, (_, j) => {
    const b = j + 1, t = store.tag(r.id, b), u = photoUrl(r.id, b);
    return `<div class="tg-cell${t ? '' : ' empty'}">
      <div class="tg-cell-h">${u ? `<img src="${u}" alt="">` : ''}<b>בולדר ${b}</b>
        <button type="button" class="btn ${t ? 'btn-ghost' : 'btn-primary'} btn-sm" data-tg-open="${b}">${t ? 'עריכה' : 'תייג'}</button></div>
      ${tagSummary(t)}</div>`;
  }).join('')}</div>`;
}
function tagOpen(b) {
  const t = store.tag(tagRound, b);
  tagEdit = { b, sec: 'zone', draft: t ? structuredClone(t) : { mode: 'split', zone: blankSec(), top: blankSec(), note: '' } };
  renderTagForm();
}
const chipBtn = (label, on, attrs, extra = '', cls = '') => `<button type="button" class="tchip${cls ? ' ' + cls : ''}" aria-pressed="${on}" ${attrs}>${extra}${label}</button>`;
const badge = (txt, cls = '') => `<span class="tbadge ${cls}">${txt}</span>`;
function renderTagForm() {
  const r = round(tagRound), { b, draft: d } = tagEdit;
  const sk = d.mode === 'whole' ? 'zone' : tagEdit.sec, x = d[sk], st = styleOf(x.style);
  const many = badge('אפשר כמה') + badge('מה שמופיע במהלכים הקשים');
  let h = `<button type="button" class="link tg-back" data-tg-back="1">‹ כל הבולדרים</button>
    <h3 class="tg-h">בולדר ${b}</h3>
    <div class="tq"><div class="tq-h"><b>איך מתייגים את הבולדר?</b></div>
      <div class="seg" role="group" aria-label="חלוקה">
        <button type="button" data-tg-mode="whole" aria-pressed="${d.mode === 'whole'}">כל הבולדר כאחד</button>
        <button type="button" data-tg-mode="split" aria-pressed="${d.mode === 'split'}">זון + טופ בנפרד</button></div></div>`;
  if (d.mode === 'split') h += `<div class="tq"><div class="tq-h"><b>עכשיו מתייגים את</b></div>
      <div class="seg" role="group" aria-label="חלק בבולדר">${['zone', 'top'].map(s => `<button type="button" data-tg-sec="${s}" aria-pressed="${s === tagEdit.sec}">${SEC_HE[s]}</button>`).join('')}</div></div>`;
  h += `<div class="tq"><div class="tq-h"><b>שיפוע</b>${badge('חובה', 'req')}${badge('לפי הקראקס', 'crux')}</div>
    <div class="tchips">${WALLS.map(w => chipBtn(esc(w.l), x.wall === w.id, `data-tg-wall="${w.id}"${w.h ? ` title="${esc(w.h)}"` : ''}`, wallSvg(w.id))).join('')}</div></div>`;
  if (x.wall === 'slab') h += `<div class="tbranch"><div class="tq"><div class="tq-h"><b>${FEET.l}</b>${many}</div>
    <div class="tchips">${FEET.o.map(o => chipBtn(esc(o.l), x.feet.includes(o.id), `data-tg-feet="${o.id}"`)).join('')}</div></div></div>`;
  h += `<div class="tq"><div class="tq-h"><b>סגנון</b>${badge('חובה', 'req')}${badge('לפי הקראקס', 'crux')}</div>
    <div class="tchips">${STYLES.map(s => chipBtn(esc(s.l), x.style === s.id, `data-tg-style="${s.id}"`, '', 'st-' + s.id)).join('')}</div></div>`;
  if (st) h += `<div class="tbranch st-${st.id}"><p class="muted small">${esc(st.d)}</p>${st.q.map(q => `<div class="tq"><div class="tq-h"><b>${esc(q.l)}</b>${many}</div>
    <div class="tchips">${q.o.map(o => chipBtn(esc(o.l), (x.sub[q.id] || []).includes(o.id), `data-tg-q="${q.id}" data-tg-o="${o.id}"${o.h ? ` title="${esc(o.h)}"` : ''}`)).join('')}</div></div>`).join('')}</div>`;
  h += `<label class="tq">הערה (רשות)<textarea id="tg-note" rows="2" maxlength="500" placeholder="למשל: הקראקס זה ה-heel בסוף">${esc(d.note || '')}</textarea></label>
    <div class="tg-out"><b>כך זה יישמר</b>${tagSummary({ ...d, top: d.mode === 'whole' ? d.zone : d.top, note: '' })}</div>
    <div class="dlg-actions">${store.tag(r.id, b) ? '<button type="button" class="btn btn-ghost btn-sm danger" data-tg-clear="1">מחיקת התיוג</button>' : ''}
      <button type="button" class="btn btn-ghost" data-tg-back="1">ביטול</button><button type="button" class="btn btn-primary" data-tg-save="1">שמירה</button></div>`;
  $('#tags-body').innerHTML = h;
}
function tagClick(e) {
  const btn = e.target.closest('button'); if (!btn) return;
  const d = btn.dataset;
  if (d.tgOpen) { tagOpen(Number(d.tgOpen)); return; }
  if (!tagEdit) return;
  const dr = tagEdit.draft; dr.note = $('#tg-note')?.value ?? dr.note;
  const x = dr[dr.mode === 'whole' ? 'zone' : tagEdit.sec];
  const tog = (arr, v) => (arr.includes(v) ? arr.filter(z => z !== v) : [...arr, v]);
  if (d.tgBack) { tagEdit = null; renderTagList(); return; }
  if (d.tgSave) { store.setTag(tagRound, tagEdit.b, dr); tagEdit = null; renderTagList(); if (SIM_AT == null) syncNow(); render(); return; }
  if (d.tgClear) { store.clearTag(tagRound, tagEdit.b); tagEdit = null; renderTagList(); if (SIM_AT == null) syncNow(); render(); return; }
  if (d.tgMode) { if (d.tgMode === 'split' && dr.mode === 'whole') { dr.top = structuredClone(dr.zone); tagEdit.sec = 'zone'; } dr.mode = d.tgMode; }
  else if (d.tgSec) tagEdit.sec = d.tgSec;
  else if (d.tgWall) { x.wall = x.wall === d.tgWall ? null : d.tgWall; if (x.wall !== 'slab') x.feet = []; }
  else if (d.tgFeet) x.feet = tog(x.feet, d.tgFeet);
  else if (d.tgStyle) { if (x.style !== d.tgStyle) { x.style = d.tgStyle; x.sub = {}; } else { x.style = null; x.sub = {}; } }
  else if (d.tgQ) x.sub[d.tgQ] = tog(x.sub[d.tgQ] || [], d.tgO);
  else return;
  const keep = Object.entries(d).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${v}"]`).join('');
  renderTagForm();
  $('#tags-body').querySelector(keep)?.focus();
}

// iPad photos are big: draw onto a canvas ≤1600 px on the long side, JPEG ≤1 MB (usually ~250 KB)
async function shrinkPhoto(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = src; await img.decode();
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
      if (blob && blob.size <= 1_000_000) return blob;
    }
    throw new Error('too big');
  } finally { URL.revokeObjectURL(src); }
}
async function photoWrite(rid, b, blob) { // blob = upload, null = delete → the new version
  const res = await fetch(`${SYNC_URL}/photo${blob ? '' : '/delete'}?device=${encodeURIComponent(store.device)}&${phQ(rid, b)}`,
    { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Comp-Key': await apiKey() }, body: blob });
  if (!res.ok) throw new Error(String(res.status));
  const { v } = await res.json(); const id = rid + ':' + b;
  phLocal.set(id, { v, del: !blob });
  if (blob) photoCache.set(id, { v, url: URL.createObjectURL(blob), fail: 0 }); // show it right away, no download
  if (SIM_AT != null) { const sp = simPhotos[rid] = simPhotos[rid] || { at: Date.now(), list: {} }; if (blob) sp.list[b] = v; else delete sp.list[b]; }
  else syncNow();
}
async function uploadPhoto(rid, b, file) {
  const id = rid + ':' + b; busyPh.add(id); renderPhotoGrid();
  try { await photoWrite(rid, b, await shrinkPhoto(file)); showToast('התמונה הועלתה'); }
  catch { showToast('לא הועלה · בדוק חיבור ונסה שוב'); }
  finally { busyPh.delete(id); renderPhotoGrid(); }
}
function deletePhoto(rid, b) {
  askConfirm('מחיקת תמונה', `התמונה של בולדר ${b} תימחק מכל המכשירים ומהצופים.`, 'מחיקה', async () => {
    const id = rid + ':' + b; busyPh.add(id); renderPhotoGrid();
    try { await photoWrite(rid, b, null); showToast('התמונה נמחקה'); }
    catch { showToast('לא נמחק · בדוק חיבור ונסה שוב'); }
    finally { busyPh.delete(id); renderPhotoGrid(); }
  });
}

// ---- feedback (like Wingate): everyone sends a bug / suggestion; Roei (coach code) sees all, sets status + reply ----
const FB_STATUS = { new: 'חדש', in_progress: 'בטיפול', done: 'טופל', wont_do: 'לא יטופל' };
const FB_TYPE = { bug: 'תקלה', suggestion: 'הצעה' };
let fbType = 'bug', fbFilter = 'open', fbAll = [];
async function fbCall(path, body) {
  const res = await fetch(SYNC_URL + path, { method: body ? 'POST' : 'GET', headers: await authHeaders(VIEWER), body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || String(res.status));
  return data;
}
const fbDate = ms => new Date(ms).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
const fbItem = (i, owner) => `<div class="fb-item st-${i.status}"><div class="fb-head"><b>${FB_TYPE[i.type]}</b><span class="fb-st">${FB_STATUS[i.status]}</span><span class="muted small">${fbDate(i.created)}</span></div>
  <p class="fb-body">${esc(i.text)}</p>${owner ? `<p class="muted small">${esc([i.name, i.role === 'viewer' ? 'צופה' : 'מאמן', i.version && 'גרסה ' + i.version, i.screen, i.device].filter(Boolean).join(' · '))}</p>` : ''}
  ${owner ? `<div class="fb-admin"><select data-fbst="${i.id}" aria-label="סטטוס">${Object.entries(FB_STATUS).map(([k, v]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <input type="text" class="fb-reply" data-fbreply="${i.id}" value="${esc(i.reply)}" placeholder="תשובה לשולח" maxlength="2000"><button type="button" class="btn btn-sm btn-ghost" data-fbsave="${i.id}">שמור</button></div>`
    : i.reply ? `<p class="fb-reply-text">תשובה: ${esc(i.reply)}</p>` : ''}</div>`;
async function loadMyFeedback() {
  const box = $('#fb-mine');
  if (!store.fbIds.length) { box.innerHTML = '<p class="ios-row muted small">עוד לא שלחת משוב מהמכשיר הזה.</p>'; return; }
  try { const { items } = await fbCall('/feedback/mine?ids=' + store.fbIds.join(',')); box.innerHTML = items.map(i => fbItem(i, false)).join('') || '<p class="ios-row muted small">—</p>'; }
  catch { box.innerHTML = '<p class="ios-row muted small">אין חיבור כרגע.</p>'; }
}
function renderAllFeedback() {
  const list = fbAll.filter(i => fbFilter === 'all' || (fbFilter === 'open' ? ['new', 'in_progress'].includes(i.status) : i.type === fbFilter));
  $('#fb-all').innerHTML = list.map(i => fbItem(i, true)).join('') || '<p class="ios-row muted small">אין משובים כאן.</p>';
  document.querySelectorAll('[data-fbf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fbf === fbFilter)));
}
async function loadAllFeedback() {
  $('#fb-all').innerHTML = '<p class="ios-row muted small">טוען…</p>';
  try { fbAll = (await fbCall('/feedback/all')).items; renderAllFeedback(); updateFbCount(); }
  catch { $('#fb-all').innerHTML = '<p class="ios-row muted small">אין חיבור כרגע.</p>'; }
}
function updateFbCount() { const n = fbAll.filter(i => i.status === 'new').length; if ($('#v-fbadmin')) $('#v-fbadmin').textContent = n ? `${n} חדשים` : ''; }
async function sendFeedback() {
  const text = $('#fb-text').value.trim();
  if (text.length < 3) { $('#fb-msg').textContent = 'כתוב כמה מילים על התקלה או ההצעה.'; return; }
  $('#fb-send').disabled = true; $('#fb-msg').textContent = 'שולח…';
  try {
    const { id } = await fbCall('/feedback', { type: fbType, text, name: VIEWER ? $('#fb-name').value.trim() : 'רועי', version: APP_VERSION,
      device: navigator.userAgent, screen: `${innerWidth}×${innerHeight}${matchMedia('(display-mode: standalone)').matches || navigator.standalone ? ' · אפליקציה' : ''}` });
    store.addFbId(id); $('#fb-text').value = ''; $('#fb-msg').textContent = 'נשלח ✓ תודה! אפשר לראות כאן למטה את הסטטוס והתשובה.'; loadMyFeedback();
  } catch { $('#fb-msg').textContent = 'אין חיבור כרגע. הטקסט נשאר כאן, נסה שוב כשיש קליטה.'; }
  $('#fb-send').disabled = false;
}

// ---- settings ----
const THEME_BG = { light: '#F5F1EA', plum: '#1A1024', charcoal: '#141216', black: '#000000' };
const DARK_NAMES = { plum: 'שזיף', charcoal: 'פחם', black: 'שחור' };
function applySettings() {
  const st = store.settings;
  const dark = DARK_NAMES[st.dark] ? st.dark : 'plum';
  const isDark = st.theme === 'dark' || (st.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const theme = isDark ? dark : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BG[theme]);
  $('#adj-minus').innerHTML = `<bdi dir="ltr">−${st.step}</bdi>`; $('#adj-minus').setAttribute('aria-label', `מקדים ${st.step} שניות`);
  $('#adj-plus').innerHTML = `<bdi dir="ltr">+${st.step}</bdi>`; $('#adj-plus').setAttribute('aria-label', `מאחר ${st.step} שניות`);
  document.querySelectorAll('.cbtn').forEach(b => { b.disabled = st.lock; });
  // segmented bar (Roei chose option B, 2026-10-12): locked = highlighted segment
  const lb = $('#lock-btn');
  lb.querySelector('span').textContent = st.lock ? 'נעול' : 'נעל';
  lb.querySelector('use').setAttribute('href', st.lock ? '#i-lock' : '#i-unlock');
  lb.classList.toggle('on', st.lock); lb.setAttribute('aria-pressed', String(st.lock));
  lb.setAttribute('aria-label', st.lock ? 'הכיול נעול · לחץ לפתיחה' : 'נעל כיול');
  document.body.classList.toggle('calib-locked', st.lock);
}

// ---- settings screen (iPhone style, like Wingate): a main list of rows → one page per topic ----
const PAGE_TITLES = { main: 'הגדרות', alerts: 'מתי להתריע', push: 'מסך נעול', sound: 'צליל', calib: 'כיול', mine: 'הספורטאים שלי', look: 'מראה', data: 'הערות וערעורים', sync: 'סנכרון בין מכשירים', feedback: 'תקלה או הצעה', fbadmin: 'משובים שהתקבלו', updates: 'עדכונים' };
function setPage(pg) {
  document.querySelectorAll('#settings-dlg .ios-page').forEach(el => { el.hidden = el.dataset.pg !== pg; });
  $('#set-title').textContent = PAGE_TITLES[pg] || 'הגדרות';
  $('#set-back').hidden = pg === 'main';
  if (pg === 'main') renderSettingsMain();
  if (pg === 'push') renderPushState();
  if (pg === 'sync') { renderSyncState(); syncNow(); }
  if (pg === 'feedback') loadMyFeedback();
  if (pg === 'fbadmin') loadAllFeedback();
  $('#settings-form').scrollTop = 0; $('#settings-dlg').scrollTop = 0;
  $('#set-title').focus({ focusVisible: false });
}
function renderSettingsMain() {
  const st = store.settings;
  const al = [['w2', '2 סבבים'], ['w1', 'סבב'], ['m2', '2 דק׳'], ['m1', 'דקה'], ['s10', '10 ש׳'], ['s0', 'בעלייה'], ['transfer', 'נורמן']].filter(([k]) => st.alerts[k]).map(([, l]) => l);
  $('#v-alerts').textContent = al.length ? al.join(' · ') : 'כבוי';
  $('#v-push').textContent = store.push.on && pushEnv() === 'ready' ? 'פעיל' : 'כבוי';
  $('#v-sound').textContent = st.sound.on ? { chime: 'פעמון', beep: 'ביפים', alarm: 'אזעקה' }[st.sound.tone] : 'כבוי';
  $('#v-calib').textContent = `${st.lock ? 'נעול' : 'פתוח'} · ${st.step} ש׳`;
  $('#v-mine').textContent = `${mineOf(current).length} בראונד`;
  $('#v-look').textContent = st.theme === 'light' ? 'בהיר' : `${st.theme === 'auto' ? 'לפי המכשיר' : 'כהה'} · ${DARK_NAMES[st.dark] || 'שזיף'}`;
  const n = store.notes().length + store.appeals().length;
  $('#v-data').textContent = n ? String(n) : '';
  $('#v-updates').textContent = APP_VERSION;
  $('#v-sync').textContent = syncLabel(true);
  $('#dark-group').hidden = st.theme === 'light';
}

function renderMineList() {
  const id = $('#mine-round').value; const r = round(id); const mk = mineK(id);
  const base = new Set((DATA.mine[id] || []).map(m => m.k));
  // Hub athletes = copper, athletes the coach added by hand = a different (blue) color, so they stand apart.
  $('#mine-list').innerHTML = r.slots.length ? r.slots.map((s, k) => s ? `<label class="ios-row${mk.has(k) ? (base.has(k) ? ' on' : ' on added') : ''}">
    <span class="lbl">#${s.order} ${esc(s.name)}${base.has(k) ? ' <span class="tag-hub">Hub</span>' : mk.has(k) ? ' <span class="tag-added">נוסף</span>' : ''}</span>
    <input type="checkbox" class="ios-sw" data-mine-k="${k}" data-base="${base.has(k) ? 1 : ''}" ${mk.has(k) ? 'checked' : ''}></label>` : '').join('')
    : '<p class="ios-row muted small">סדר העלייה עוד לא התקבל.</p>';
}

function openSettings() {
  const st = store.settings; const f = $('#settings-form');
  f.querySelectorAll('[data-set]').forEach(el => {
    const [a, b] = el.dataset.set.split('.'); const v = b ? st[a][b] : st[a];
    if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'radio') el.checked = el.value === String(v); else el.value = String(v);
  });
  $('#dev-name').value = store.devName;
  $('#mine-round').innerHTML = EVENTS().map(e => `<optgroup label="${esc(e.title)}">${roundsOf(e).map(r => `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${dayLabel(r.date)} · ${esc(r.title)}</option>`).join('')}</optgroup>`).join('');
  renderMineList();
  $('#version-info').textContent = `גרסת אפליקציה ${APP_VERSION} · סדרי עלייה עודכנו ${new Date(DATA.builtAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`;
  $('#update-msg').textContent = '';
  renderChangelog();
  setPage('main');
  $('#settings-dlg').showModal();
  $('#set-title').focus({ focusVisible: false }); // iPadOS ringed "סיום" (first button) on open — start on the title instead
  if (!VIEWER && SIM_AT == null) fbCall('/feedback/all').then(r => { fbAll = r.items; updateFbCount(); }).catch(() => {});
}

// Version history (changelog.js, like Wingate): newest first, the running version marked; start-list updates in between.
function renderChangelog() {
  const fmtDate = d => d.split('-').reverse().join('/');
  $('#changelog').innerHTML = CHANGELOG.map(e => `<div class="cl-entry">
    <div class="cl-head">${e.data ? '<b class="cl-data">סדר עלייה</b>' : `<b dir="ltr">${esc(e.v)}</b>`}${e.v === APP_VERSION ? '<span class="cl-now">הגרסה שלך</span>' : ''}<span class="cl-date">${fmtDate(e.date)}</span></div>
    <ul>${e.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
}

// New start list (data builtAt) or new app version on the server → 'update' | 'none' | 'offline'.
async function findUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    const fresh = res.ok ? await decryptJSON(await res.json(), store.code) : null;
    const codeRes = await fetch('app.js', { cache: 'no-store' });
    const newVer = codeRes.ok ? ((await codeRes.text()).match(/APP_VERSION = '([^']+)'/) || [])[1] : null;
    if (!fresh) return 'offline';
    return fresh.builtAt !== DATA.builtAt || (newVer && newVer !== APP_VERSION) ? 'update' : 'none';
  } catch { return 'offline'; }
}

async function checkUpdate() {
  $('#update-msg').textContent = 'בודק…';
  const r = await findUpdate();
  if (r === 'update') { $('#update-msg').textContent = 'נמצא עדכון · טוען מחדש…'; setTimeout(() => location.reload(), 800); }
  else $('#update-msg').textContent = r === 'none' ? 'הכל מעודכן ✓' : 'אין חיבור כרגע. נסה שוב.';
}

// Pull down to refresh — Home Screen app only (Safari has its own). At the top of the page, drag down ≥70px and release:
// sync now (coach) / pull calibration (viewer) + check for a new start list or version (→ reload). No reload otherwise.
let viewPull = null;
function setupPullRefresh() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!standalone && !params.has('ptr')) return;
  const ind = document.createElement('div'); ind.className = 'ptr'; ind.innerHTML = '<svg class="ptr-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M5 13l7 7 7-7"/></svg><span class="ptr-text"></span>';
  document.body.append(ind);
  const TRIGGER = 70; let y0 = null, dy = 0, busy = false;
  const show = (d, text) => { ind.style.transform = `translate(-50%, ${Math.min(d, 110) - 56}px)`; ind.querySelector('.ptr-text').textContent = text; ind.classList.toggle('ready', d >= TRIGGER); };
  const hide = () => { ind.classList.add('back'); ind.style.transform = ''; ind.classList.remove('ready', 'busy'); setTimeout(() => ind.classList.remove('back'), 250); };
  addEventListener('touchstart', e => {
    if (busy || e.touches.length !== 1 || scrollY > 0 || document.querySelector('dialog[open]')) { y0 = null; return; }
    if (e.target.closest('.full-wrap')?.scrollTop > 0) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 == null) return;
    dy = (e.touches[0].clientY - y0) * 0.55; // resistance
    if (dy <= 0 || scrollY > 0) { if (dy < 0) y0 = null; ind.style.transform = ''; return; }
    show(dy, dy >= TRIGGER ? 'שחרר לרענון' : 'משוך לרענון');
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 == null) return; y0 = null;
    if (dy < TRIGGER) { hide(); return; }
    busy = true; ind.classList.add('busy'); show(TRIGGER, 'מרענן…');
    await Promise.all([VIEWER ? viewPull?.() : syncNow(), findUpdate().then(r => {
      if (r === 'update') { show(TRIGGER, 'נמצא עדכון · טוען מחדש…'); setTimeout(() => location.reload(), 600); busy = 'reload'; }
      else showToast(r === 'none' ? 'הכל מעודכן ✓' : 'אין חיבור כרגע');
    })]).catch(() => {});
    if (busy === 'reload') return;
    render(); hide(); busy = false;
  });
}

// list = the notes/appeals on screen (log filter, 3.1.0); none = everything (settings)
function exportFile(list) {
  const a = document.createElement('a');
  const json = list ? JSON.stringify({ device: store.devName, notes: list.filter(i => i.type === 'note'), appeals: list.filter(i => i.type === 'appeal') }, null, 2) : store.exportAll();
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = `comp-notes-${new Date(now()).toISOString().slice(0, 10)}.json`; a.click();
}

function start() {
  for (const [id, res] of Object.entries(DATA.results || {})) if (res.final == null) res.final = lastRound(id); // a results file without `final`
  VIEWER = DATA.role === 'viewer';
  document.body.classList.toggle('viewer', VIEWER);
  if (VIEWER) { $('[data-view="mine"]').textContent = MINE_NAME(); $('#arm-btn').hidden = true; }
  $('#app').hidden = false;
  document.querySelectorAll('.app-ver').forEach(el => { el.textContent = APP_VERSION; });
  current = params.get('round') && round(params.get('round')) ? params.get('round') : pickDefaultRound();
  if (SIM_AT != null) $('#sim-bar').hidden = false;
  const liveNow = DATA.rounds.some(r => r.slots.length && stateAt(r, now(), off(r.id)).phase === 'live');
  screen = params.get('round') || liveNow ? 'round' : 'home';
  $('#home').hidden = screen !== 'home'; $('#round-screen').hidden = screen !== 'round';
  $('#home-btn').setAttribute('aria-pressed', String(screen === 'home'));
  if (screen === 'round') openRoundView(); // a link to a finished round with results opens on them
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.page) { setPage(d.page); return; }
    if (d.final) { const [ev, key, from] = d.final.split(':'); homeFinal = { ev: Number(ev), key, from }; render(); window.scrollTo(0, 0); return; }
    if (b.id === 'final-back') { if (homeFinal.from === 'list') { homeOpenEvent = null; homeListPicked = true; } else homeOpenEvent = homeFinal.ev; homeFinal = null; render(); return; }
    if (d.ev != null) { homeOpenEvent = Number(d.ev); render(); return; }
    if (b.id === 'home-back') { homeOpenEvent = null; homeListPicked = true; render(); return; }
    if (d.open) { lastTabTap = Date.now(); current = d.open; for (const x of ['mine', 'all', 'results']) $('#view-' + x)._html = null; openRoundView(); showScreen('round'); }
    else if (b.id === 'home-btn') { homeOpenEvent = null; homeListPicked = false; homeFinal = null; showScreen('home'); }
    else if (d.round) { lastTabTap = Date.now(); current = d.round; if (screen !== 'round') { screen = 'round'; $('#home').hidden = true; $('#round-screen').hidden = false; $('#home-btn').setAttribute('aria-pressed', 'false'); } for (const x of ['mine', 'all', 'results']) $('#view-' + x)._html = null; openRoundView(); render(); }
    else if (d.photo) openPhoto($('#photos-dlg').open ? gridRound : current, Number(d.photo));
    else if (b.id === 'photos-btn') openPhotos();
    else if (b.id === 'tags-btn') openTags();
    else if (d.phAdd) { gridRound = current; upTarget = Number(d.phAdd); $('#photo-file').value = ''; $('#photo-file').click(); }
    else if (d.phUp) { upTarget = Number(d.phUp); $('#photo-file').value = ''; $('#photo-file').click(); }
    else if (d.phDel) deletePhoto(gridRound, Number(d.phDel));
    else if (d.adj) adjust(d.adj);
    else if (d.view) setView(d.view);
    else if (d.rescat) { resCat[current] = d.rescat; $('#view-results')._html = null; render(); }
    else if (d.lock) lockResults(d.lock);
    else if (d.unlock) unlockResults(d.unlock);
    else if (d.sync) syncFromSlot(Number(d.sync));
    else if (d.note) openNote(Number(d.note), d.nr);
    else if (d.appeal) openAppeal(Number(d.appeal), d.nr);
    else if (d.goRound) goRound(d.goRound);
    else if (b.id === 'clock-btn') openClock();
    else if (d.scLen) { document.querySelectorAll('[data-sc-len]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#sc-custom').hidden = d.scLen !== 'custom'; }
    else if (b.id === 'sc-start') startClock();
    else if (b.id === 'sc-pause') pauseClock();
    else if (b.id === 'sc-stop' || b.id === 'sc-close') stopClock();
    else if (d.copy) copy(appealFull(store.appeals(a => a.id === d.copy)[0]));
    else if (d.share) navigator.share({ text: appealFull(store.appeals(a => a.id === d.share)[0]) }).catch(() => {});
    else if (d.delNote) askConfirm('מחיקת הערה', 'ההערה תימחק מכל המכשירים.', 'מחיקה', () => { store.deleteNote(d.delNote); render(); });
    else if (d.delAppeal) askConfirm('מחיקת ערעור', 'הערעור יימחק מכל המכשירים.', 'מחיקה', () => { store.deleteAppeal(d.delAppeal); render(); });
    else if (d.logAll != null) { logAll = d.logAll === '1'; logName = null; editId = null; render(); }
    else if (d.logName != null) { logName = d.logName || null; render(); }
    else if (d.edit) { editId = d.edit; render(); const ta = document.getElementById('edit-' + d.edit); ta?.focus(); ta?.setSelectionRange(ta.value.length, ta.value.length); }
    else if (d.editCancel != null) { editId = null; render(); }
    else if (d.editSave) { const v = document.getElementById('edit-' + d.editSave)?.value.trim(); if (v) store.editNote(d.editSave, v, now()); editId = null; render(); }
    else if (d.apSt) { store.setAppeal(d.ap, { status: d.apSt }); render(); }
    else if (b.id === 'export-btn') exportFile(logItems().shown);
    else if (b.id === 'export-btn2') exportFile();
    else if (b.id === 'settings-btn') openSettings();
    else if (b.id === 'test-sound') { ensureAudio(); chime(true); }
    else if (b.id === 'lock-btn') { store.setSetting('lock', !store.settings.lock); applySettings(); }
    else if (b.id === 'check-update') checkUpdate();
    else if (d.fbtype) { fbType = d.fbtype; document.querySelectorAll('[data-fbtype]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }
    else if (b.id === 'fb-send') sendFeedback();
    else if (d.fbf) { fbFilter = d.fbf; renderAllFeedback(); }
    else if (d.fbsave) {
      const id = d.fbsave; const status = document.querySelector(`[data-fbst="${id}"]`).value, reply = document.querySelector(`[data-fbreply="${id}"]`).value.trim();
      fbCall('/feedback/update', { id, status, reply }).then(() => { const it = fbAll.find(i => i.id === id); Object.assign(it, { status, reply }); renderAllFeedback(); updateFbCount(); showToast('נשמר'); }).catch(() => showToast('אין חיבור כרגע'));
    }
    else if (b.id === 'sync-now') { $('#sync-state').textContent = 'מסנכרן…'; syncNow(); }
    else if (b.id === 'push-toggle') { if (store.push.on && pushEnv() === 'ready') pushDisable(); else pushEnable(); }
    else if (b.id === 'push-test') pushCall('/test', {}).then(r => showToast(r.ok ? 'נשלחה התראת ניסיון · נעל את האייפד ובדוק' : 'השליחה נכשלה')).catch(() => showToast('אין חיבור לשרת ההתראות'));
    else if (b.id === 'reset-all') askConfirm('איפוס כיול', 'הכיול יתאפס בכל הראונדים ובכל המכשירים, והשעון יחזור לזמנים שבסדר העלייה.', 'איפוס', () => { store.resetOffsets(); render(); showToast('הכיול אופס'); });
    else if (b.id === 'logout-btn') askConfirm('יציאה', 'בכניסה הבאה תצטרך להזין את הקוד שוב. ההערות והכיולים נשארים באייפד.', 'יציאה', () => { store.logout(); location.href = './'; });
    else if (b.id === 'copy-all-btn') copy(logItems().shown.map(i => (i.type === 'appeal' ? appealFull(i) : noteText(i))).join('\n\n')); // what is on screen (3.1.0)
    else if (b.id === 'reset-btn') { store.setOffset(current, 0); if (store.delay(current)) store.setDelay(current, 0); render(); }
    else if (b.id === 'delay-btn') {
      if (store.settings.lock) showToast('הכיול נעול · אפשר לפתוח בהגדרות או ב"נעול"');
      else { const d0 = store.delay(current), d = (d0 + 1) % 3; store.setOffset(current, delayOffset(round(current), now(), off(current), d0, d)); store.setDelay(current, d); render(); showToast(d ? `השהיה ${d}ש׳ בכל מעבר סבב` : 'ללא השהיה'); }
    }
    else if (d.mineTg != null) { const k = Number(d.mineTg); store.toggleMine(current, k, mineK(current).has(k), false); $('#view-all')._html = null; $('#view-mine')._html = null; render(); }
    else if (b.id === 'manual-btn') openManual();
    else if (b.id === 'sim-btn') openSim();
    else if (b.id === 'arm-btn') { if (armed) disarm(); else { arm(); chime(true); } }
  });
  $('#settings-form').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.mineK != null) {
      store.toggleMine($('#mine-round').value, Number(el.dataset.mineK), !el.checked, !!el.dataset.base);
      renderMineList(); for (const x of ['mine', 'all']) $('#view-' + x)._html = null; render(); return;
    }
    if (el.id === 'mine-round') { renderMineList(); return; }
    if (el.id === 'dev-name') { store.setDevName(el.value); el.value = store.devName; renderSyncState(); return; }
    if (!el.dataset.set) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.dataset.num != null ? Number(el.value) : el.value;
    if (el.type === 'radio' && !el.checked) return;
    store.setSetting(el.dataset.set, v);
    applySettings(); renderSettingsMain(); render();
  });
  $('#view-log').addEventListener('change', e => { const id = e.target.dataset?.apOut; if (id) { store.setAppeal(id, { outcome: e.target.value.trim() }); render(); } });
  $('#photo-file').addEventListener('change', e => { const f = e.target.files?.[0]; if (f && upTarget != null && !VIEWER) uploadPhoto(gridRound, upTarget, f); });
  $('#photo-dlg').addEventListener('click', () => $('#photo-dlg').close()); // tap anywhere closes the big photo
  $('#tags-dlg').addEventListener('click', tagClick);
  // tag popover on the board: tap a tag → show; tap anywhere else / scroll → hide
  document.addEventListener('click', e => { const b = e.target.closest('[data-tg-pop]'); if (b) showTagPop(b); else $('#tag-pop').hidden = true; }, true);
  addEventListener('scroll', () => { $('#tag-pop').hidden = true; }, { passive: true });
  $('#tags-dlg').addEventListener('close', () => { tagEdit = null; });
  $('#dev-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }); // Enter must not close the dialog
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);
  applySettings();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (armed) { if (audio && audio.state !== 'running') audio.resume().catch(() => {}); keepAwake(); }
    render();
  });
  render();
  setInterval(render, 250);
  setInterval(() => pollLive(), 5000);
  loadLocked(); setInterval(loadLocked, 120000);
  setInterval(() => syncPush(), 5000); syncPush(true);
  addEventListener('online', () => syncPush(true));
  if (SIM_AT == null && VIEWER) viewPull = startViewSync(onRemote);
  else if (SIM_AT == null) startSync({ onRemote, onStatus: renderSyncState });
  if (SIM_AT == null) setupPullRefresh();
  setupSwipe(); setupAutoArm();
  if ('serviceWorker' in navigator && SIM_AT == null) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch(() => { $('#gate').hidden = false; });
