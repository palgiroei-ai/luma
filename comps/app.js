import { decryptJSON } from './decrypt.js';
import { stateAt, athleteStatus, slotStartMs, roundStart, syncWindowNow, delayOffset, syncSlotNow, syncManualStart, windowCount, alertPlan, climbOverlaps, roundEndMs as engineEnd, boardGone, zonedMs, zoneParts, deviceOffZone, dayIn } from './engine.js';
import { store } from './store.js';
import { startSync, startViewSync, syncNow, syncState, authHeaders, apiKey, SYNC_URL } from './sync.js';
import { CHANGELOG } from './changelog.js';
import { rankRows, analyze, boulderStats, pts, kind, r1, catOptions, catLabel, rankInCats, isLastRound, finalStandings, tzText } from './results.js';
import { setupInstall } from './install.js';
import { catHe, roundTitle, hm, hms, range, placeOnce, fileSource } from './labels.js';
const srcOf = res => (res.live || res.locked || res.intl ? res.source : fileSource(res.source));
import { liveRows, liveGroup, fetchLive, liveEvents, liveLeadRows, liveLeadEvents } from './live.js';
import { toLeadResults } from './leadRank.js';
import { quota } from './results.js';
import { WALLS, STYLES, FEET, styleOf, wallOf } from './tags.js';
import { planIfscRounds, sortIntl } from './ifscPlan.js';
import { ifscAnyResults, leadRanked, leadTableHtml, esc, genderOf, fetchIfsc, isIsr, intlMineByBib, ifscRanked, ifscPhaseOf, withCombos, IFSC_POLL_MS, lastName, appealsOf, appealNearLine, appealEvents } from './ifsc.js';
import { takeEntry, isEntry, ENTRY_FAIL, pushNeedsCompsScope, pushScopeOk, openTarget, appTheme, backToApp } from './entry.js';
import { myHistory, catParts } from './mine.js';
import { roundPickList } from './roundpick.js';
import { leadBoardHtml, leadHomeLine, isLeadLive, leadRoutes, leadColor, leadColor2, leadPickColor, routeColors, leadMineHtml, leadAllHtml, leadOverlapHtml, leadParHint, leadParMineHtml, topoB, routeNoteText, leadAlertEntries } from './leadView.js';
import { markNext, undoMark, toManual, toAuto, legStatus, withLive, ownCtl } from './lead.js';
import { bySeason, seasonLabel, seasonsOf, CANCEL_TAG, tbdMark, evTone, filterOptions, filterLabel, filterEvents, effectiveFilter, seasonSummary, pickNow, TYPES, AGES, DISC } from './seasons.js';

export const APP_VERSION = '3.27.0';

const $ = s => document.querySelector(s);

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
const fmtClock = ms => hms(ms); // H:MM:SS for windows (labels.js)
const fmtClockIn = ms => { const d = zoneParts(ms); return `${pad(d.h)}:${pad(d.mi)}:${pad(d.s)}`; }; // padded: inputs + ?at= urls
const fmtHM = ms => hm(ms);
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

// stage A (2026-10-23): opened from the Palgi app (#entry=<pass>) → the app Worker answers with the code + role.
// Anything wrong (expired / used / forged pass, no connection) → the gate with "פתחו שוב מהאפליקציה" — never a blank
// screen, never the code stored from an earlier visit. A pass for an athlete / viewer must open the viewer file.
// loading screen (index.html #splash, consistency round §2): bar to 100%, fade, then gone — on every load, as soon as
// the app, the gate or an entry error shows
function hideSplash() {
  const sp = document.getElementById('splash'); if (!sp || sp.classList.contains('out')) return;
  sp.classList.add('out');
  const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => sp.remove(), instant ? 0 : 350);
}
function showGate(err, fromApp = false) {
  hideSplash();
  $('#gate').hidden = false;
  if (err) { $('#gate-error').textContent = err; $('#gate-error').hidden = false; }
  if (fromApp) document.querySelectorAll('#gate [data-install-open]').forEach(el => { el.hidden = true; }); // the app's origin: no portal icon
}
const NODATA = 'אין חיבור לנתונים כרגע. בדוק אינטרנט ונסה שוב.';
async function boot() {
  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('#gate-btn').disabled = true;
    const code = $('#code').value.trim();
    const d = await unlock(code);
    $('#gate-btn').disabled = false;
    if (!d || d === 'nodata') {
      $('#gate-error').textContent = d === 'nodata' ? NODATA : 'הקוד שגוי, נסה שוב.';
      $('#gate-error').hidden = false; return;
    }
    DATA = d;
    store.code = code;
    store.appEntry = null; // a typed code = the code path (no "שלי", no link back to the app)
    $('#gate').hidden = true;
    start();
  });
  if (isEntry(location.hash)) {
    // a new pass replaces whoever entered from the app before: drop that identity first, so a refused pass + a later plain
    // reload lands on the gate, never on the previous athlete / coach. A typed code (iPad, parents) never has appEntry.
    if (store.appEntry) store.logout();
    const e = await takeEntry();
    const d = e ? await unlock(e.code) : null;
    if (d && d !== 'nodata' && (e.role === 'coach' || d.role === 'viewer')) {
      store.code = e.code; store.appEntry = { role: e.role, athlete: e.athlete };
      DATA = d; start();
      // the app's "שעון סימולציה" button (&go=clock): straight into the training clock; closing it goes back to the app
      if (e.go === 'clock') openClock(backToApp(history, document.referrer, location.href));
      return;
    }
    return showGate(d === 'nodata' ? NODATA : ENTRY_FAIL, true);
  }
  if (store.code) {
    const d = await unlock(store.code);
    if (d && d !== 'nodata') { DATA = d; return start(); }
  }
  showGate(null, !!store.appEntry);
}
// the app opened the portal again while this page is open (same document, only the hash changed) → take the new pass
addEventListener('hashchange', () => { if (isEntry(location.hash)) location.reload(); });

// ---- helpers over data ----
const round = id => DATA.rounds.find(r => r.id === id);
// several competitions (Super League 1–3…): each round names its event; old data had a single DATA.event
const EVENTS = () => DATA.events || [{ id: 'bl1', ...DATA.event }];
// competition name as shown: championships get a trophy before the name (Roei 2026-10-13)
const evName = e => (e?.champ ? '🏆 ' : '') + (e?.title || '');
// a title of ' · ' parts ("גביע עולם · בולדר · Arco, ITA"): each part isolated, so a Latin place never splits in RTL
const bidiParts = s => String(s || '').split(' · ').map(x => `<bdi${/[A-Za-z]/.test(x) ? ' class="lat"' : ''}>${esc(x)}</bdi>`).join(' · '); // a Latin part (a place) stays on one line
const evOf = r => EVENTS().find(e => e.id === (r?.event || 'bl1')) || EVENTS()[0];
// viewer: only rounds still ahead (or running now)
const todayStr = () => { const d = zoneParts(now()); return `${d.y}-${pad(d.mo)}-${pad(d.d)}`; };
// a competition's "today": its venue's day (SLC is 9 h behind Israel — 3.11.0); times on screen stay Israel time
const evToday = e => (e?.tz ? dayIn(now(), e.tz) : todayStr());
// international rounds (3.11.0) stay visible to viewers, also after they end
const visible = r => !VIEWER || !!r.ifsc || !!resultsOf(r.id) || (r.slots.length ? roundEndMs(r) > now() : r.date >= todayStr());
// results (2.7.0): DATA.results[roundId] = { source, rows } from src/results.mjs; round 2 counts back to round 1
// live (3.4.0): a round without an official file shows the federation's live data while it runs (see live.js)
// no next round in this competition → no cut line / "next round" (seniors R2 = the final; audit 2026-10-15)
const lastRound = id => isLastRound(id, DATA.rounds.map(x => x.id));
// international rounds (3.11.0): World Climbing through the Worker (ifscRes) instead of locked / federation live
const resultsOf = id => (LIVE_FORCE && liveOf(id)) || DATA.results?.[id] || (round(id)?.ifsc ? ifscRes(id) : LOCKED[id] || liveOf(id)) || null;

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
      const src = `ההתאחדות · תוצאות רשמיות · נקבע כרשמי ${fbDate(v.at)}`;
      next[id] = old && old.at === v.at ? old : round(id)?.lead ? { ...toLeadResults({ rows: v.rows }, id, leadPrevRank(id)), source: src, at: v.at, locked: true } // 3.26.0 lead
        : { source: src, at: v.at, locked: true, final: lastRound(id),
        rows: v.rows.map(r => ({ ...r, bs: r.bs.some(Boolean) ? r.bs : [] })) }; // nothing entered = did not start (DNS)
    }
    LOCKED = next; render();
  } catch { /* offline / no server: keep what we have */ }
}
function lockResults(id) {
  const res = resultsOf(id); if (!res?.live) return;
  const miss = res.total - res.done, u = res.lead ? 'מסלולים' : 'בולדרים';
  // 3.26.0 lead: the climbers' route scores (res.file = the live rows before ranking), no boulder cells
  const rows = res.lead ? res.file.map(({ bib, name, club, cat, A, B }) => ({ bib, name, club, cat, bs: [], ...(A != null ? { A } : {}), ...(B != null ? { B } : {}) }))
    : res.rows.map(({ bib, name, club, cat, bs }) => ({ bib, name, club, cat, bs }));
  askConfirm('קביעה כתוצאות רשמיות', `${roundTitle(round(id).title)}: התוצאות החיות כפי שהן עכשיו (${res.done}/${res.total} ${u}${miss ? `, ${miss} חסרים — יירשמו בלי תוצאה` : ''}) יישמרו כתוצאות הראונד ויוצגו לכולם בירוק. אפשר לבטל אחר כך.`, 'קבע כרשמי', async () => {
    try {
      await fbCall('/locked', { round: id, source: `תוצאות חיות מההתאחדות, עודכן ${fmtClock(res.updated)}`, rows });
      await loadLocked(); showToast('נקבע כתוצאות רשמיות ✓');
    } catch { showToast('לא נשמר — אין חיבור לשרת. נסה שוב.'); }
  });
}
function unlockResults(id) {
  askConfirm('ביטול התוצאות הרשמיות', `${roundTitle(round(id).title)}: לחזור לתוצאות החיות (אם ההתאחדות עוד מציגה את הראונד)?`, 'בטל', async () => {
    try { await fbCall('/locked/delete', { round: id }); await loadLocked(); showToast('בוטל'); } catch { showToast('לא בוטל — אין חיבור לשרת.'); }
  });
}
const rankCache = {};
function rankedOf(id) {
  const res = resultsOf(id); if (!res) return null;
  if (rankCache[id]?.res === res) return rankCache[id].v;
  if (res.lead) return (rankCache[id] = { res, v: leadRanked(res.rows) }).v; // 3.16.0 lead: World Climbing's place only
  const v = rankRows(res.rows, prevRankOf(id));
  return (rankCache[id] = { res, v: res.intl ? ifscRanked(v) : v }).v; // international: the place = IFSC's rank (review 2026-10-16)
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
  if (r.lead) return (liveCache[id] = { key, v: liveLeadOf(r) }).v;
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
    v = { ...lr, live: true, final: lastRound(id), source: `ההתאחדות · תוצאות חיות · לא רשמי · עודכן ${fmtClock(lr.updated)}` };
  }
  liveCache[id] = { key, v };
  return v;
}
// 3.26.0: lead rounds from the same judging app (it took lead on 27/10) → ranked like a manual file (World Climbing rules),
// red + LIVE like boulder; a new route result → toast. Round 2 counts back to round 1's places.
function leadPrevRank(id) {
  const prevId = id.replace(/-r2$/, '-r1');
  return prevId !== id && resultsOf(prevId) ? new Map(rankedOf(prevId).filter(x => x.rank != null).map(x => [x.bib, x.rank])) : null;
}
function liveLeadOf(r) {
  const lr = liveLeadRows(r, live.data.cfg, live.data.results, now()); if (!lr) return null;
  const evs = liveLeadEvents(liveSeen[r.id], lr.rows, lr.routes);
  liveSeen[r.id] = lr.rows.map(x => ({ ...x }));
  if (r.id === current && screen === 'round') evs.forEach(e => liveToast({ ...e, kind: 'lead' }));
  const res = toLeadResults({ rows: lr.rows }, r.id, leadPrevRank(r.id));
  return { ...res, file: lr.rows, live: true, complete: lr.complete, done: lr.done, total: lr.total, started: lr.started, updated: lr.updated,
    source: `ההתאחדות · תוצאות חיות · לא רשמי · עודכן ${fmtClock(lr.updated)}` };
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
// ---- international rounds (3.11.0): World Climbing results through the Worker (/ifsc), polled every 15 s while the
// round's screen or its competition on home is open and the round is not finished (finished: once per app open).
// Israelis (country ISR) = "my athletes" there: highlighted, and only their new zones/tops toast + blink.
const IFSC = {}; // round id → { data, res, at, err, busy, seen }
const ifscRes = id => IFSC[id]?.res || null;
async function pollIfsc(id, force = false) {
  if (round(id)?.ifscStatic) return; // 3.13.0: saved results (finished competitions) — nothing to fetch
  const s = IFSC[id] || (IFSC[id] = { data: null, res: null, at: 0, err: false, busy: false, seen: null });
  if (s.busy || (document.hidden && !force)) return;
  // done (or the venue's day is over) = fetched once per app open; a group IFSC gives no status for is only inferred
  // 'finished' → on its own day keep checking every minute in case that was early (review 2026-10-16)
  const r = round(id), past = venueDay(r) > lastDay(r);
  if (s.data && (past || (s.data.status === 'finished' && Date.now() - s.at < 60000))) return;
  if (s.data && !r.dateGuess && now() < roundStart(r) - IFSC_EARLY_MS) return; // 3.11.1: before the start = once per app open
  if (!force && Date.now() - s.at < IFSC_POLL_MS - 500) return;
  s.busy = true;
  try { applyIfsc(id, await fetchIfsc(SYNC_URL, await authHeaders(VIEWER), r.ifscRef || id)); s.err = false; } catch { s.err = true; } // keep the last data
  s.at = Date.now(); s.busy = false; render();
}
function applyIfsc(id, d) {
  const s = IFSC[id], res = ifscAnyResults(d), r = round(id); // 3.16.0: saved lead rounds too
  if (venueDay(r) > lastDay(r)) { res.live = false; res.complete = true; } // safety net: the venue's day is over = finished
  if (r.adv) res.final = false; // 3.12.1: a qualifying line (r.adv advance; split groups: per group)
  res.source = r.ifscStatic ? 'World Climbing · תוצאות סופיות' : `World Climbing · תוצאות חיות · עודכן ${fmtHM(res.updated || Date.now())}`;
  const isr = res.rows.filter(isIsr), evs = [...liveEvents(s.seen, isr), ...appealEvents(s.seen, isr)];
  if (s.seen) { const m = liveFresh[id] || (liveFresh[id] = new Map()); for (const e of evs) m.set(`${e.bib}:${e.b - 1}`, Date.now()); }
  s.seen = isr.map(x => ({ bib: x.bib, name: x.name, bs: x.bs.map(c => c && [...c]), ap: x.ap }));
  if ((id === current || round(current)?.combo?.includes(id)) && screen === 'round') evs.forEach(e => liveToast({ ...e, name: '🇮🇱 ' + e.name }));
  s.data = d; s.res = res;
}
// international round phase (3.11.1): live from the start time or the first result — never from IFSC's 'active' alone
const IFSC_EARLY_MS = 10 * 60000; // polling starts 10 min before the start
// 3.12.0 combined A + B entry: live if a group is live, done when both are
const ifscIds = r => r.combo || [r.id];
const ifscPhase = r => (r.combo ? (ps => (ps.includes('live') ? 'live' : ps.every(p => p === 'after') ? 'after' : 'before'))(r.combo.map(id => ifscPhase(round(id))))
  : ifscPhaseOf({ nowMs: now(), startMs: r.auto && r.noTime ? Infinity : roundStart(r), date: lastDay(r), venueDay: venueDay(r), status: IFSC[r.id]?.data?.status ?? (r.ifscStatus === 'finished' ? 'finished' : undefined), started: IFSC[r.id]?.res?.started || 0 }));
const venueDay = r => evToday(evOf(r));
// 3.21.0: a round whose day is only a guess (no infosheet time) is never "over" before its competition's last day
const lastDay = r => (r.dateGuess ? evDates(evOf(r)).at(-1) || r.date : r.date);

// 3.21.0 (Roei 2026-10-24: every competition with ALL its rounds, also the ones still to come): a World Climbing event's
// round list from the Worker (/ifsc/event, every 5 min while it is near) → the missing rounds are added here, results
// live through /ifsc?r=<ref>. The last answer is kept on the device, so the rounds are there offline and at once.
const IFSC_EV_MS = 5 * 60000, IFSC_EV_KEY = id => 'comps.ifscEv.' + id, ifscEvAt = {};
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function autoEvents() {
  const t = todayStr();
  return EVENTS().filter(e => e.ifscId && e.ifscPre && !e.cancelled && (d => d.length && d.at(-1) >= addDays(t, -2) && d[0] <= addDays(t, 30))(evDates(e)));
}
function addAutoRounds(ev, info) {
  const plan = planIfscRounds(ev, info);
  for (const r of DATA.rounds) if (r.auto && r.event === ev.id) { const p = plan.find(x => x.id === r.id); if (p) r.ifscStatus = p.ifscStatus; }
  // review 2026-10-24: an app event abroad comes with Israel's zone → the venue's own zone decides when its day is over
  if (info.tz && (!ev.tz || ev.tz === 'Asia/Jerusalem')) ev.tz = info.tz;
  const have = new Set(DATA.rounds.map(r => r.id)), add = plan.filter(r => !have.has(r.id));
  if (!add.length) return false;
  const at = DATA.rounds.findIndex(r => r.event === ev.id), own = DATA.rounds.filter(r => r.event === ev.id && !r.combo);
  const rest = DATA.rounds.filter(r => r.event !== ev.id), next = withCombos(sortIntl([...own, ...add]));
  rest.splice(at < 0 ? rest.length : at, 0, ...next);
  DATA.rounds = rest; applyDelays();
  return true;
}
function loadIfscEventsCached() { // any event seen before, also long after it ended (its rounds stay)
  for (const ev of EVENTS().filter(e => e.ifscId && e.ifscPre)) { try { const info = JSON.parse(localStorage.getItem(IFSC_EV_KEY(ev.ifscId)) || 'null'); if (info) addAutoRounds(ev, info); } catch { /* no storage */ } }
}
// a link to a round that arrives with the round list (?round=, e.g. from an alert, first visit = nothing cached) → open it once
let linkDone = false;
function openPendingLink() {
  const want = params.get('round');
  if (linkDone || !want || current === want || !round(want) || Date.now() - T_LOAD > 20000) return; // not after the user moved on
  linkDone = true; current = want; screen = 'round';
  $('#home').hidden = true; $('#round-screen').hidden = false; $('#home-btn').setAttribute('aria-pressed', 'false');
  for (const x of ['mine', 'all', 'results', 'log']) $('#view-' + x)._html = null;
  openRoundView();
}
async function syncIfscEvents(force = false) {
  if (document.hidden && !force) return;
  for (const ev of autoEvents()) {
    if (!force && Date.now() - (ifscEvAt[ev.id] || 0) < IFSC_EV_MS) continue;
    ifscEvAt[ev.id] = Date.now();
    try {
      const res = await fetch(`${SYNC_URL}/ifsc/event?id=${ev.ifscId}`, { headers: await authHeaders(VIEWER), cache: 'no-store' });
      if (!res.ok) continue;
      const info = await res.json();
      try { localStorage.setItem(IFSC_EV_KEY(ev.ifscId), JSON.stringify(info)); } catch { /* private mode */ }
      if (addAutoRounds(ev, info)) { openPendingLink(); render(); }
    } catch { /* offline: the cached list stays */ }
  }
}
// the rounds to poll now: the open international round, or the international competition shown on home
function ifscWanted() {
  if (screen === 'round') { const r = round(current); return r?.ifsc ? ifscIds(r) : []; }
  if (homeFinal) return [];
  const evs = homeEvents(), ev = homeOpenEvent == null ? null : evs[homeOpenEvent];
  // home (competition or list): once per app open, then every 15 s only from 10 min before a round's start until it is
  // done (review 2026-10-16 + 3.11.1: 7 rounds × every client was too much)
  const want = r => r.ifsc && !r.combo && (!IFSC[r.id]?.at || (r.ifscStatus !== 'pending' && now() >= roundStart(r) - IFSC_EARLY_MS && ifscPhase(r) !== 'after')); // 3.21.0: a round World Climbing has not opened yet = once (its status comes with the round list every 5 min)
  if (ev) return ev.event.intl ? ev.rounds.filter(want).map(r => r.id) : [];
  return evs.filter(e => e.event.intl).flatMap(e => e.rounds.filter(want).map(r => r.id));
}
// 3.9.1: wording by the round's gender (women's rounds: מטפסת, סיימה, לא התחילה…)
const gw = (id, m, f) => (genderOf(id) === 'W' ? f : m);
let resFem = false; // set by renderResults for the result cards built inside it
const resCat = {}; // chosen category per round (this session)
const resIsr = {}; // 3.11.0: international round → table shows only Israelis (this session)
const roundsOf = ev => DATA.rounds.filter(r => (r.event || 'bl1') === ev.id && visible(r));
const MINE_NAME = () => (VIEWER ? 'ספורטאי הפלגיה' : 'שלי');
let MINE_H = 'הספורטאים שלי'; // the section title (index.html); international rounds say 'תוצאות' instead
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
    case 'climbing': return 'על הקיר'; // 3.22.0 lead
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

// round screen: one button naming the round (opens the list "ראונדים באירוע"); the home screen has no row (its cards list the rounds)
function renderTabs() {
  $('#round-tabs').classList.toggle('rp-host', screen === 'round');
  if (screen !== 'round') { patch($('#round-tabs'), ''); return; }
  const cur = round(current), has = roundsOf(evOf(cur)).length > 0; // tabs = the competition of the open round
  patch($('#round-tabs'), has ? `<button type="button" class="rp-btn" id="round-pick-btn" aria-haspopup="dialog"><span class="rp-k">ראונד</span><bdi class="rp-name">${esc(roundTitle(cur.title))}</bdi><span class="dd-caret" aria-hidden="true"></span></button>` : '');
}

// ---- round picker "ראונדים באירוע" ----
const isrCount = id => { const r = round(id); return r?.combo ? r.combo.reduce((n, g) => n + isrCount(g), 0) : (resultsOf(id) ? rankedOf(id) : []).filter(isIsr).length; };
const pickCount = id => (round(id)?.ifsc ? isrCount(id) : mineOf(id).length);
const pickPhase = r => (r.ifsc ? ifscPhase(r) : r.slots.length ? stateAt(r, now(), off(r.id)).phase : 'wait');
const PICK_ST = { live: 'חי', done: 'הסתיים', soon: 'בקרוב' };
function openRoundPick() {
  const r = round(current), ev = evOf(r), dlg = $('#round-pick');
  const list = roundPickList(ev, roundsOf(ev), now(), pickCount, { phaseOf: pickPhase, off });
  if (!list.length) return;
  const cnt = (x, ifsc) => (!x.count ? '' : ifsc ? `${x.count} ישראלים` : VIEWER ? `${x.count} מספורטאי הפלגיה` : `${x.count} שלי`);
  $('#round-pick-body').innerHTML = list.map(g => `<section class="rp-day"><h3 class="rp-day-t">${dayLabel(g.day)}</h3>${g.items.map(x => {
    const rr = round(x.id), on = x.id === current;
    return `<button type="button" class="rp-row" data-round="${x.id}" aria-current="${on}"><span class="rp-mark" aria-hidden="true">${on ? '✓' : ''}</span><span class="rp-main"><bdi class="rp-title">${esc(x.title)}</bdi><span class="rp-meta">${x.time ? `<span class="rp-time">${x.time}</span>` : ''}<span class="hb ${x.status}">${PICK_ST[x.status]}</span>${cnt(x, rr.ifsc) ? `<span class="rp-cnt">${cnt(x, rr.ifsc)}</span>` : ''}</span></span></button>`;
  }).join('')}</section>`).join('');
  // phone = bottom sheet (CSS); wider = popover under the button
  const b = $('#round-pick-btn'), pop = innerWidth >= 600 && b;
  dlg.classList.toggle('rp-pop', !!pop);
  dlg.style.top = dlg.style.insetInlineStart = '';
  dlg.showModal();
  if (pop) { const q = b.getBoundingClientRect(); dlg.style.top = `${q.bottom + 6}px`; dlg.style.insetInlineStart = `${Math.max(8, innerWidth - q.right)}px`; }
  dlg.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
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
  const cells = [];
  const thumb = b => { const u = photoUrl(r.id, b); return u ? `<button type="button" class="ph-thumb" data-photo="${b}" data-ph-round="${r.id}" aria-label="תמונת בולדר ${b}"><img src="${u}" alt=""></button>` : ''; };
  // no photo yet → coach gets an empty photo spot with "+" right on the board (2.3.0, Roei picked option A); viewers see the plain card
  const addSpot = b => (VIEWER || photoV(r.id, b) ? '' : `<button type="button" class="ph-add" data-ph-add="${b}" data-ph-round="${r.id}" aria-label="הוספת תמונה לבולדר ${b}"${busyPh.has(r.id + ':' + b) ? ' disabled' : ''}>${
    busyPh.has(r.id + ':' + b) ? '<span class="ph-add-busy">מעלה…</span>' : `<span class="plus">+</span><span class="ph-add-t">בולדר ${b}</span><span class="ph-add-l">הוסף תמונה</span>`}</button>`);
  const label = (b, th, add) => (th ? `${th}בולדר ${b}` : add ? `${add}<span class="ph-ttl">בולדר ${b}</span>` : `בולדר ${b}`);
  if (r.combo) { // 3.12.0 combined A + B: each group's boulders in its own labeled row (photos / tags stay per group)
    const tmp = document.createElement('div');
    patch(el, r.combo.map(id => { const g = round(id); tmp._html = null; renderBoard(g, null, tmp); return `<div class="combo-board"><b class="combo-h">קבוצה ${esc(g.group)}</b>${tmp.innerHTML}</div>`; }).join(''));
    return;
  }
  if (r.lead) { patch(el, ''); return; } // 3.16.0 lead: no boulder cards / photos / tags (body.lead-round hides the board)
  if (r.ifsc) { // 3.11.0 international round: no start list here — the boulders with photos + tags (coach adds, viewers see)
    for (let b = 1; b <= r.boulders; b++) { const th = thumb(b), add = th ? '' : addSpot(b);
      cells.push(`<div class="lane boulder${th ? ' has-ph' : add ? ' no-ph' : ''}"><div class="lane-label">${label(b, th, add)}</div>${boardTag(r.id, b)}</div>`); }
    patch(el, `<div class="lanes intl" style="grid-template-columns:repeat(${r.boulders},minmax(0,1fr))">${cells.join('')}</div>`); return;
  }
  if (!r.slots.length) { patch(el, `<div class="board-msg">סדר העלייה לראונד הזה עוד לא התקבל.</div>`); return; }
  for (let j = 0; j < r.boulders; j++) {
    const th = thumb(j + 1), add = th ? '' : addSpot(j + 1);
    const bt = boardTag(r.id, j + 1);
    cells.push(slotCard(r, s.boulders[j], `lane boulder${th ? ' has-ph' : add ? ' no-ph' : ''}`, label(j + 1, th, add), bt));
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
    sub.innerHTML = [`התחלה ${fmtClock(startMs)}`, r.preview && esc(`צפייה במסלולים ${range(r.preview.from, r.preview.to)}`), ...calibParts(r, 0)].filter(Boolean).join(' · ');
    timer.className = 'timer';
  } else if (s.phase === 'after') {
    label.textContent = 'הראונד הסתיים'; timer.textContent = '0:00'; sub.textContent = ''; timer.className = 'timer done';
  } else {
    label.textContent = `רוטציה ${s.n + 1} מתוך ${total} · נותר`;
    timer.textContent = fmtDur(s.slotLeftMs);
    timer.className = 'timer' + (s.slotLeftMs <= 60000 ? ' warn' : '');
    sub.innerHTML = [`הרוטציה הבאה ${fmtClock(s.slotEndMs)}`, ...calibParts(r, s.n + 1)].join(' · ');
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
  b.setAttribute('aria-label', d ? `השהיה של ${d} שניות בכל מעבר רוטציה · לחץ לשינוי` : 'ללא השהיה בין רוטציות · לחץ להוספה');
}
// "השהיה": the federation clock adds 0–2 s at every window change → each window lasts slotSec + delay (shared, per round)
function applyDelays() {
  for (const r of DATA.rounds) { if (r.slotSec0 == null) r.slotSec0 = r.slotSec; r.slotSec = r.slotSec0 + store.delay(r.id); }
  // 3.22.0: lead live board — each route's shared mode + marks (store, synced) → round.leadCtl, read by engine.js / lead.js
  // 3.27.0: + the federation's live results move each route on (withLive, derived — the store keeps the coach's own marks)
  for (const r of DATA.rounds) if (isLeadLive(r)) {
    const at = leadResAt(r);
    r.leadCtl = Object.fromEntries(leadRoutes(r).map(x => [x, withLive(r, x, store.leadCtl(r.id, x), at?.[x], now())]));
  }
}
// route → Map slot k → when that climber's live result arrived (null: no live data for this round)
function leadResAt(r) {
  if (!live.data || r.ifsc) return null;
  const lr = liveLeadRows(r, live.data.cfg, live.data.results, now()); if (!lr) return null;
  const kOf = new Map(r.slots.map((x, k) => [x?.bib, k])), out = {};
  for (const row of lr.rows) for (const [x, t] of Object.entries(row.at || {})) if (kOf.has(row.bib)) (out[x] ||= new Map()).set(kOf.get(row.bib), t);
  return out;
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
    patch($('#view-mine'), `<h3 class="par-h">${esc(roundTitle(r.title))}</h3>${cards(r)}<h3 class="par-h">${esc(roundTitle(par.title))} · במקביל</h3>${cards(par)}`);
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
  return { res, q: res.intl ? r.adv || 0 : quota(res.live ? res.rows.length : ok.length), overall, by: Object.fromEntries(shown.map(x => [x.bib, x])), all: Object.fromEntries(full.map(x => [x.bib, x])) };
}
// 3.8.1: a boulder that just got a zone/top (live) blinks here too
const bsTxt = (bs, fr, bib) => bs.map((b, j) => (b ? (fr?.has(`${bib}:${j}`) ? `<span class="lfresh">B${j + 1} ${cellTxt(b)}</span>` : `B${j + 1} ${cellTxt(b)}`) : null)).filter(Boolean).join(' · ');
const provisional = R => (R.res.live && !R.res.complete ? ' (זמני)' : '');
function resLine(R, bib, rid) {
  const x = R?.by[bib]; if (!x || x.rank == null) return '';
  const cut = R.res.final ? '' : R.overall[bib] <= R.q ? ' · <span class="yes">בפנים</span>' : ' · <span class="out">בחוץ</span>';
  return `<p class="res-line${R.res.live ? ' live' : ''}"><b>מקום ${x.rank}${provisional(R)}</b> · ${x.score.toFixed(1)} נק׳ · <bdi dir="ltr">${bsTxt(x.bs, R.res.live ? freshOf(rid) : null, bib)}</bdi>${cut}</p>`;
}
// ---- 3.22.0 national lead before the start lists (lead league 1, Roei 2026-10-24): the programme from the info sheet +
// the registered athletes (r.reg, my athletes = DATA.regMine). No rotations / clock — those come with the start lists.
const natLeadWait = r => !!(r?.lead && !r.ifsc && !r.slots.length);
const regMineOf = id => (DATA.regMine || {})[id] || [];
const r1Of = r => (r.info?.from ? round(r.info.from) : null);
const catLbl = (c, id) => (/^(Senior|U\d+)$/.test(c) ? catHe(c, genderOf(id)) : c);
function natLeadFacts(r) {
  const i = r.info || {};
  return [i.climb && `טיפוס ${range(i.climb[0], i.climb[1])}`, unitsOf(r), i.method, `${i.minutes} דקות למסלול`, i.groups > 1 && `${i.groups} קבוצות`].filter(Boolean).join(' · ');
}
function natLeadMineHtml(r) {
  const r1 = r1Of(r), list = regMineOf(r1 ? r1.id : r.id), reg = (r1 || r).reg || [];
  if (!list.length) return '';
  return `<ul class="h-mine">${list.map(m => `<li><b>${esc(m.short)}</b> <span>${esc(catLbl(reg[m.i].cat, r.id))}${r1 ? ` · ${gw(r.id, 'אם יעלה', 'אם תעלה')} מראונד 1` : ` · ${gw(r.id, 'רשום', 'רשומה')}`}</span></li>`).join('')}</ul>`;
}
function natLeadPanel(r) {
  const i = r.info || {}, r1 = r1Of(r), n = (r1 || r).reg?.length || 0;
  const times = [i.checkin && `<div><dt>רישום</dt><dd>${range(i.checkin[0], i.checkin[1])}</dd></div>`, r.iso && `<div><dt>בידוד</dt><dd>${range(r.iso.open, r.iso.close)}</dd></div>`,
    r.iso?.preview && `<div><dt>צפייה במסלולים</dt><dd>${r.iso.preview}</dd></div>`, i.climb && `<div><dt>טיפוס</dt><dd>${range(i.climb[0], i.climb[1])}</dd></div>`].filter(Boolean).join('');
  const mine = natLeadMineHtml(r);
  return `<div class="card nl-card"><h3>לפני סדר העלייה</h3>
    <p class="muted small">${i.listsOn ? `סדר העלייה יפורסם ${esc(i.listsOn)}. ` : ''}עד אז: הלו״ז ומי ${r1 ? 'יכול לעלות' : 'רשום'}.</p>
    <dl class="ath-meta nl-times">${times}</dl>
    <p class="small">${esc([unitsOf(r), i.method, `${i.minutes} דקות למסלול`, i.order, i.groups > 1 && `${i.groups} קבוצות`].filter(Boolean).join(' · '))}</p>
    ${r1 ? `<p class="small">עולים לראונד הזה: ${i.quota} הראשונים מראונד 1 (${n} ${gw(r.id, 'רשומים', 'רשומות')}).</p>` : `<p class="small">${n} ${gw(r.id, 'רשומים', 'רשומות')} · לראונד 2 ${gw(r.id, 'עולים', 'עולות')} ${i.quota}.</p>`}
    ${mine ? `<h4>${VIEWER ? 'ספורטאי הפלגיה' : 'הספורטאים שלי'}</h4>${mine}` : `<p class="muted small">${VIEWER ? 'אין ספורטאי הפלגיה ברשימה.' : 'אין ספורטאים שלי ברשימה.'}</p>`}</div>`;
}
function natLeadRegHtml(r) {
  const r1 = r1Of(r), reg = (r1 || r).reg || [], mineI = new Set(regMineOf((r1 || r).id).map(m => m.i));
  if (!reg.length) return '<p class="muted">רשימת הרשומים לא התקבלה.</p>';
  const cats = [...new Set(reg.map(x => x.cat))];
  return (r1 ? `<p class="muted small">מי שיעלה מראונד 1 (${r1.info?.quota || ''} ${gw(r.id, 'הראשונים', 'הראשונות')}). הרשימה של ראונד 1:</p>` : '') + cats.map(c => `<div class="card nl-reg"><div class="tbl-head"><b>${esc(catLbl(c, r.id))}</b><span class="muted small">${reg.filter(x => x.cat === c).length}</span></div>
    <ul class="nl-list">${reg.map((x, i) => [x, i]).filter(([x]) => x.cat === c).map(([x, i]) => `<li${mineI.has(i) ? ' class="mine"' : ''}><b>${esc(x.name)}</b><span class="muted small">${esc(x.club)}</span></li>`).join('')}</ul></div>`).join('');
}

function mineCards(r, t, el) {
  if (natLeadWait(r)) { patch(el, natLeadPanel(r)); return; }
  const list = mineOf(r.id), R = resByBib(r);
  if (!list.length) { patch(el, `<p class="muted">${r.slots.length ? (VIEWER ? 'אין ספורטאי הפלגיה בראונד הזה.' : 'אין ספורטאים שלי בראונד הזה.') : 'סדר העלייה עוד לא התקבל.'}</p>`); return; }
  if (isLeadLive(r)) { // 3.22.0 lead: one row per route per athlete + the amber overlap line (no boulder layout)
    const c = { ...leadCtx(r), now: t, mine: list, notes: k => store.notes(n => n.round === r.id && n.k === k), appeals: k => store.appeals(a => a.round === r.id && a.k === k) };
    const par = leadParRound(r), pm = par ? mineOf(par.id) : [];
    const pc = par && { ...leadCtx(par), now: t, mine: pm, notes: k => store.notes(n => n.round === par.id && n.k === k), appeals: k => store.appeals(a => a.round === par.id && a.k === k) };
    patch(el, (VIEWER ? '<p class="muted small viewer-hint">מודגשים: ספורטאי הפלגיה</p>' : leadOverlapHtml(r, c)) + leadMineHtml(r, c) + (par ? leadParMineHtml(par, pc) : '')); return;
  }
  patch(el, (VIEWER ? '<p class="muted small viewer-hint">מודגשים: ספורטאי הפלגיה</p>' : overlapHtml(r, t)) + list.map(m => {
    const s = r.slots[m.k];
    const st = athleteStatus(r, m.k, t, off(r.id));
    const notes = store.notes(n => n.round === r.id && n.k === m.k);
    const appeals = store.appeals(a => a.round === r.id && a.k === m.k);
    const big = st.kind === 'waiting' ? `עולה בעוד <span data-until="${st.startMs}"></span>` : statusText(r, st);
    return `<article class="ath card ${st.kind}">
      <header><h3>${esc(m.short)}</h3><span class="muted small">${esc(s.name)} · ${esc(/^(Senior|S|U\d+)$/.test(m.cat) ? catHe(m.cat, genderOf(r.id)) : m.cat)}</span></header>
      <div class="ath-status">${big}</div>
      <dl class="ath-meta"><div><dt>סדר</dt><dd>#${s.order}</dd></div><div><dt>גב</dt><dd>${s.bib}</dd></div>
        <div><dt>עלייה</dt><dd>${fmtClock(st.startMs)}</dd></div><div><dt>מעבר לנורמן</dt><dd>${fmtHM(s.transfer ? zonedMs(`${r.date}T${s.transfer.padStart(8, '0')}`) + off(r.id) : st.startMs - 80 * 60000)}</dd></div></dl>
      ${resLine(R, s.bib, r.id)}
      ${notes.length ? `<p class="last-note">📝 ${esc(notes[notes.length - 1].text)}${notes.length > 1 ? ` <span class="muted">(+${notes.length - 1})</span>` : ''}</p>` : ''}
      ${appeals.length ? `<p class="last-note appeal-tag">⚑ ${appeals.length} ערעור${appeals.length > 1 ? 'ים' : ''}</p>` : ''}
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-secondary" data-note="${m.k}" data-nr="${r.id}">הערה</button>
        <button type="button" class="btn btn-sm btn-appeal" data-appeal="${m.k}" data-nr="${r.id}">ערעור</button></div>
    </article>`;
  }).join(''));
}

function renderAll(r) {
  const t = now(); const mk = mineK(r.id); const base = new Set((DATA.mine[r.id] || []).map(m => m.k));
  if (natLeadWait(r)) { patch($('#view-all'), natLeadRegHtml(r)); return; } // 3.22.0: the registered athletes
  if (!r.slots.length) { patch($('#view-all'), '<p class="muted">סדר העלייה עוד לא התקבל.</p>'); return; }
  if (isLeadLive(r)) { patch($('#view-all'), leadAllHtml(r, { ...leadCtx(r), now: t, mine: mineOf(r.id), base })); scrollToBand(); return; } // 3.22.0 lead: per route, band = on a wall
  const live = stateAt(r, t, off(r.id)).phase === 'live';
  let nextDone = !live;
  const R = resByBib(r), nc = R ? 7 : 6; // results column (3.4.0) only when the round has results / live results
  const resTd = s => !R ? '' : `<td class="c-res${R.res.live ? ' live' : ''}">${R.all[s.bib]?.rank != null ? `<b>${R.all[s.bib].rank}</b> · ${R.all[s.bib].score.toFixed(1)}` : ''}</td>` // full list = everyone → overall place;
  // 3.0.0: band on whoever is on a boulder / resting between boulders now + a "הבא בתור" line before the first one waiting;
  // circle next to the name adds / removes a not-mine athlete for this round (Hub athletes have none)
  patch($('#view-all'), `<p class="muted small hint">סנכרון לפי מי שמטפס: לחץ "מתחיל עכשיו" ליד המתחרה שעולה עכשיו לבולדר 1. ערעור אפשר על כל מתחרה.${VIEWER ? '' : ' ○ ליד שם = הוספה לספורטאים שלי בראונד הזה.'}</p><div class="full-wrap"><table class="full"><thead><tr><th>סדר</th><th class="c-bib">גב</th><th>שם</th><th>עלייה</th><th>מצב</th>${R ? `<th>תוצאה${provisional(R)}</th>` : ''}<th></th></tr></thead><tbody>${
    r.slots.map((s, k) => {
      const st = s ? athleteStatus(r, k, t, off(r.id)) : null;
      let pre = '';
      if (!nextDone && (st ? st.kind === 'waiting' : slotStartMs(r, k, off(r.id)) > t)) { nextDone = true; pre = `<tr class="next-line"><td colspan="${nc}"><span>הבא בתור</span></td></tr>`; }
      if (!s) return pre + `<tr class="empty-row"><td colspan="3">רוטציה ריקה</td><td>${fmtClock(slotStartMs(r, k, off(r.id)))}</td><td></td>${R ? '<td></td>' : ''}<td></td></tr>`;
      const added = mk.has(k) && mineOf(r.id).find(m => m.k === k)?.added;
      const now_ = st.kind === 'boulder' || st.kind === 'rest';
      const tg = VIEWER || base.has(k) ? '' : `<button type="button" class="mine-tg" data-mine-tg="${k}" aria-pressed="${mk.has(k)}" aria-label="${mk.has(k) ? 'הסרה מהספורטאים שלי' : 'הוספה לספורטאים שלי'} · ${esc(s.name)}"></button>`;
      return pre + `<tr class="${mk.has(k) ? 'mine' : ''}${added ? ' added' : ''}${now_ ? ' now' : ''} st-${st.kind}"><td>${s.order}</td><td class="c-bib">${s.bib}</td><td class="c-name"><span class="nm-in">${tg}<span>${esc(s.name)}${mk.has(k) ? ` <b>(${esc(shortOf(r.id, k))})</b>` : ''}</span></span></td>
        <td>${fmtClock(st.startMs)}</td><td class="c-st">${statusText(r, st)}</td>${resTd(s)}
        <td class="row-actions">${isLeadLive(r) ? '' : `<button type="button" class="sync-btn" data-sync="${k}">${gw(r.id, 'מתחיל עכשיו', 'מתחילה עכשיו')}</button>`}
          <button type="button" class="sync-btn btn-appeal" data-appeal="${k}">ערעור</button></td></tr>`;
    }).join('')}</tbody></table></div>`);
  scrollToBand();
}
function scrollToBand() {
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
  if (r.ifsc) { ifscIds(r).forEach(id => pollIfsc(id, true)); if (view !== 'results') setView('results'); return; } // 3.11.0: results only
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

function resCard(ranked, row, who, final, full, q0 = null) {
  const a = analyze(ranked, row, full, q0), inCat = ranked !== full;
  const soleJ = a.sole.flatMap((k, j) => (k ? [j] : [])), soleKinds = [...new Set(soleJ.map(j => a.sole[j]))];
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const what = o => row.rank === 1 ? `יתרון ${sgn(o.gain)}` : `${o.rank < row.rank ? 'מקום ' + o.rank : 'נשאר ' + row.rank}<small class="d">${sgn(o.gain)}</small>${o.advances && !final ? '<span class="up">עולה</span>' : ''}`;
  const bars = row.bs.map((b, j) => { const k = kind(b), p = pts(b);
    return `<div class="bar${row.ap?.includes(j) ? ' appeal' : ''}" title="בולדר ${j + 1}: ${p.toFixed(1)}"><div class="fill-wrap"><div class="fill ${k}" style="height:${p / 25 * 100}%"></div>${a.sole[j] ? `<span class="sole" title="${SOLE[a.sole[j]]}" aria-label="${SOLE[a.sole[j]]}">${STAR}</span>` : ''}</div><span class="lb">B${j + 1} (T${b?.[0] || 0}Z${b?.[1] || 0})</span></div>`; }).join('');
  return `<article class="card fc${who.added ? ' added' : ''}${who.picked ? ' picked' : ''}">
    <div class="top"><div><div class="nm">${esc(row.name)}</div><div class="club">${esc(row.club)} · מס׳ ${row.bib}</div></div><div class="rk">${row.rank}<small>/${a.n}</small>${inCat ? `<span class="rk-all">כללי ${a.overallRank}</span>` : ''}</div></div>
    <div class="sc"><b>${row.score.toFixed(1)}</b> נק׳ · ${a.tops} טופים · ${a.zones} זונים</div>
    <div class="bars" style="grid-template-columns:repeat(${row.bs.length},1fr)">${bars}</div>
    ${soleKinds.length ? `<div class="sole-key"><span class="sole-ic">${STAR}</span> = ${soleKinds.length > 1 ? 'הטופ/הזון היחיד' : SOLE[soleKinds[0]]}</div>` : ''}
    <div class="ins">
      <div class="grp"><span class="gh">מיקום</span>
        ${final ? '' : kv('ראונד הבא', a.advances ? '<span class="yes">עולה ✓</span>' : `חסרו ${a.missing.toFixed(1)} נק׳<small class="d">קו ${a.cutScore.toFixed(1)}</small>`)}
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
  if (row.rank == null) return `<article class="card fc live${who.added ? ' added' : ''}${who.picked ? ' picked' : ''}">${head('–')}<p class="muted small">עדיין בלי תוצאה — יופיע כאן אחרי הבולדר הראשון.</p></article>`;
  const ok = ranked.filter(x => x.rank != null), all = full.filter(x => x.rank != null), i = ok.indexOf(row);
  const overall = all.find(x => x.bib === row.bib)?.rank ?? row.rank, nDone = row.bs.filter(Boolean).length;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const above = ok.slice(0, i).reverse().find(x => x.score > row.score), below = ok.slice(i + 1).find(x => x.score < row.score);
  const bars = row.bs.map((b, j) => b ? `<div class="bar${fresh.has(`${row.bib}:${j}`) ? ' fresh' : ''}${row.ap?.includes(j) ? ' appeal' : ''}"><div class="fill-wrap"><div class="fill ${kind(b)}" style="height:${pts(b) / 25 * 100}%"></div></div><span class="lb">B${j + 1} (T${b[0] || 0}Z${b[1] || 0})</span></div>`
    : `<div class="bar wait"><div class="fill-wrap"></div><span class="lb">B${j + 1} · עוד לא</span></div>`).join('');
  let cut = '';
  if (!final) {
    const lastIn = all[Math.min(q, all.length) - 1], firstOut = all[q];
    cut = overall <= q ? kv('קו העלייה כרגע', `<span class="yes">בפנים</span>${firstOut ? `<small class="d">יתרון ${r1(row.score - firstOut.score).toFixed(1)} על מקום ${firstOut.rank}</small>` : ''}`)
      : kv('קו העלייה כרגע', `חסרות ${r1(lastIn.score - row.score + 0.1).toFixed(1)} נק׳<small class="d">מקום ${q} · ${lastIn.score.toFixed(1)}</small>`);
  }
  return `<article class="card fc live${who.added ? ' added' : ''}${who.picked ? ' picked' : ''}">${head(`${row.rank}<small>/${ok.length}</small><em>זמני</em>${ranked !== full ? `<span class="rk-all">כללי ${overall}</span>` : ''}`)}
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
  if (VIEWER || res.intl || (SIM_AT != null && location.hostname !== 'localhost')) return ''; // World Climbing results are theirs (3.11.0)
  if (res.locked) return `<div class="lock-bar"><span>✓ נקבע כתוצאות רשמיות מהתוצאות החיות</span><button type="button" class="btn btn-sm btn-secondary" data-unlock="${r.id}">ביטול</button></div>`;
  if (!res.live || !(res.complete || stateAt(r, now(), off(r.id)).phase === 'after')) return '';
  const u = res.lead ? 'מסלולים' : 'בולדרים';
  return `<div class="lock-bar"><span>${res.complete ? `כל ה${u} הוזנו.` : `הראונד נגמר · ${res.done}/${res.total} ${u} הוזנו.`} לשמור את המצב הזה כתוצאות הרשמיות של הראונד?</span><button type="button" class="btn btn-sm btn-primary" data-lock="${r.id}">קבע כתוצאות רשמיות</button></div>`;
}

// "Firstname LASTNAME" → the first name in its own span: the phone table hides it (the end of a Latin name is cut in RTL)
function intlName(n) {
  const w = n.split(' '); let i = w.length;
  while (i > 1 && /\p{L}/u.test(w[i - 1]) && w[i - 1] === w[i - 1].toUpperCase()) i--;
  return i && i < w.length ? `<span class="fn">${esc(w.slice(0, i).join(' '))} </span>${esc(w.slice(i).join(' '))}` : esc(n);
}
// → the results HTML. 3.12.0: part 'cards' = only the analysis cards (no wrapper), 'group' = everything but the chips and
// cards (one group inside the combined A + B screen); isrKey = whose "רק ישראלים" choice applies
function renderResults(r, part = null, isrKey = r.id) {
  resFem = genderOf(r.id) === 'W';
  if (resultsOf(r.id).lead) return renderLead(r, part, isrKey);
  const res = resultsOf(r.id), full = rankedOf(r.id), g = genderOf(r.id);
  if (res.intl && !res.rows.length) return part === 'cards' ? '' : `<p class="muted intl-wait">סדר העלייה לראונד הזה עוד לא פורסם ב-World Climbing. התוצאות יופיעו כאן כשהראונד יתחיל.</p>`;
  const opts = catOptions(res.rows, g), opt = opts.find(o => o.key === resCat[r.id]) || opts[0];
  const sub = opt?.cats ? rankInCats(res.rows, opt.cats, prevRankOf(r.id)) : full;
  const ranked = sub.length === full.length ? full : sub; // a view of everyone = the overall ranking (no "כללי")
  const overallOf = Object.fromEntries(full.map(x => [x.bib, x.rank]));
  const ok = ranked.filter(x => x.rank != null), nB = r.boulders;
  // 3.11.0 international round: Israelis highlighted; analysis cards + boulder stats coach only. 3.18.0 (Roei): the cards and
  // the per-boulder dots are my athletes only (World Climbing name from the Palgi app), not every Israeli
  const intl = !!res.intl;
  let whoByBib = {};
  if (intl) whoByBib = intlMineByBib(res.rows, DATA.intlMine);
  else for (const m of mineOf(r.id)) { const s = r.slots[m.k]; if (s) whoByBib[s.bib] = m; }
  const nIsr = intl ? res.rows.filter(isIsr).length : 0, onlyIsr = !!(intl && nIsr && resIsr[isrKey]);
  const chips = opts.length > 1 ? `<div class="choices res-cats" role="group" aria-label="קטגוריה">${opts.map(o => `<button type="button" class="choice" data-rescat="${o.key}" aria-pressed="${o === opt}">${esc(o.label)}</button>`).join('')}</div>` : '';
  const isrChips = intl && nIsr && part !== 'cards' ? isrSeg(onlyIsr, resFem) : ''; // 3.18.0: right above the table (each group's own in A + B, same choice)
  const analysis = !(intl && VIEWER);
  const running = res.live && !res.complete;
  // 3.8.0: who is on the wall right now (rotation model + calibration) → label next to the name + frame on that boulder
  const onWall = {};
  if (res.live) { const s = stateAt(r, now(), off(r.id)); if (s.phase === 'live') s.boulders.forEach((sl, j) => { if (sl) onWall[sl.bib] = j + 1; }); }
  const wallTag = bib => (onWall[bib] ? `<span class="onwall"><i></i>על הקיר · B${onWall[bib]}</span>` : '');
  const fresh = freshOf(r.id);
  const q = intl ? r.adv || 0 : res.live ? quota(res.rows.length) : analyze(full, full[0]).quota; // 3.12.1: intl = World Climbing's number
  const mine = (running ? ranked : ok).filter(x => whoByBib[x.bib]);
  // stage A: opened from "שלי" → that athlete's card first and marked (only the national cards viewers already see)
  if (pick?.round === r.id && pick.bibs.size) { for (const x of mine) if (pick.bibs.has(String(x.bib))) whoByBib[x.bib] = { ...whoByBib[x.bib], picked: true }; mine.sort((a, b) => !!whoByBib[b.bib].picked - !!whoByBib[a.bib].picked); }
  if (part === 'cards') return analysis ? mine.map(x => running ? liveCard(ranked, x, whoByBib[x.bib], q, res.final, full, wallTag(x.bib), fresh) : resCard(ranked, x, whoByBib[x.bib], res.final, full, intl && q > 0 ? q : null)).join('') : '';
  const cards = !analysis || part ? '' : mine.length ? `<div class="focus">${mine.map(x => running ? liveCard(ranked, x, whoByBib[x.bib], q, res.final, full, wallTag(x.bib), fresh) : resCard(ranked, x, whoByBib[x.bib], res.final, full, intl && q > 0 ? q : null)).join('')}</div>`
    : `<p class="muted">${intl && !nIsr ? (res.rows.length ? gw(r.id, 'אין ישראלים בראונד הזה.', 'אין ישראליות בראונד הזה.') : '') : VIEWER ? 'אין ספורטאי הפלגיה בראונד הזה.' : 'אין ספורטאים שלי בראונד הזה.'}</p>`;
  const stats = boulderStats(ranked, nB).map(b => {
    const md = mine.map(x => `<span>${esc(whoByBib[x.bib].short)} ${cellTxt(x.bs[b.boulder - 1])}</span>`).join('');
    return `<div class="bs-row"><b>בולדר ${b.boulder}</b><div class="stack"><span class="t" style="width:${b.tops / b.n * 100}%"></span><span class="z" style="width:${b.zoneOnly / b.n * 100}%"></span></div>
      <span class="c">${b.tops} טופ · ${b.tops + b.zoneOnly} זון / ${b.n}</span><span></span>
      <div class="mydots">${md}<span class="avg">ממוצע ניסיונות לטופ ${b.avgTop ?? '–'}</span><span class="avg">ממוצע ניסיונות לזון ${b.avgZone ?? '–'}</span></div></div>`;
  }).join('');
  const apOf = Object.fromEntries(res.rows.filter(x => x.ap).map(x => [x.bib, x.ap])); // 3.12.2: boulders under appeal
  const cell = (b, j, bib) => { const k = kind(b), ap = apOf[bib]?.includes(j), ex = (onWall[bib] === j + 1 ? ' climbing' : '') + (fresh.has(`${bib}:${j}`) ? ' fresh' : '') + (ap ? ' appeal' : '');
    if (k === 'w') return `<div class="cell w${ex}"><span class="a">${ex.includes('climbing') ? (resFem ? 'מטפסת' : 'מטפס') : '·'}</span><span class="p"></span></div>`;
    return `<div class="cell ${k}${ex}"${ap ? ' title="בערעור"' : ''}>${ap ? '<span class="aptag">ערעור</span>' : ''}<span class="a">${k === 'n' ? '—' : (b[0] ? 'T' + b[0] + ' ' : '') + 'Z' + b[1]}</span><span class="s">${k === 'n' ? '—' : b[0] ? 'T' + b[0] : 'Z' + b[1]}</span><span class="p">${k === 'n' ? '0' : pts(b).toFixed(1)}</span></div>`; };
  let cutDone = false;
  const near = intl && q ? appealNearLine(full, q) : []; // 3.12.2: an open appeal that could move someone across the line
  const rows = (onlyIsr ? ranked.filter(isIsr) : ranked).map(x => {
    const w = whoByBib[x.bib], isr = intl && isIsr(x), cls = w ? (w.added ? 'mine added' : 'mine') : isr ? 'isr' : '';
    let pre = '';
    if (!res.final && !cutDone && x.rank != null && overallOf[x.bib] > q) { cutDone = true; const ct = `קו העלייה לראונד הבא · ${q} עולים${ranked === full ? ` (${ok.length} התחילו)` : ' לפי הדירוג הכללי'}${near.length ? ` · <span class="ap-near">⚖️ ייתכן שינוי (ערעור של ${near.map(x => esc(lastName(x.name))).join(', ')})</span>` : ''}`;
      // 3.9.0: phone hides 2 columns → a cell spanning them would add a phantom column; one row per layout
      pre = `<tr class="cut cut-wide"><td colspan="${nB + 5}">${ct}</td></tr><tr class="cut cut-narrow"><td colspan="${nB + 3}">${ct}</td></tr>`; }
    return pre + `<tr class="${cls}"><td class="rk">${x.rank ?? '–'}${ranked !== full && x.rank != null ? `<small class="rk-all">כללי ${overallOf[x.bib]}</small>` : ''}</td><td class="n"><b>${isr ? '<span class="flag" aria-label="ישראל">🇮🇱</span> ' : ''}${intl ? intlName(x.name) : esc(x.name)}${w ? ` <span class="tag">${esc(w.short)}</span>` : ''}</b>${wallTag(x.bib)}<small>${esc(x.club)}${x.cat && x.cat !== 'S' && (!opt?.cats || opt.cats.length > 1) ? ` · ${catLabel(x.cat, g)}` : ''}</small></td><td class="bib">${x.bib}</td>
      ${x.rank == null ? `<td colspan="${nB}" class="muted small">${res.live && !res.complete ? 'עדיין בלי תוצאה' : resFem ? 'לא התחילה (DNS)' : 'לא התחיל (DNS)'}</td><td class="tz"></td><td class="tt">–</td>` : x.bs.map((b, j) => `<td>${cell(b, j, x.bib)}</td>`).join('') + `<td class="tz">${tzText(x.bs)}</td><td class="tt">${x.score.toFixed(1)}</td>`}</tr>`;
  }).join('');
  return `<div class="res${res.live ? ' is-live' : ''}">
    ${part ? '' : chips}
    ${res.live ? (err => `<div class="live-bar${err ? ' err' : ''}">${LTAG}<b>${res.complete ? 'כל הבולדרים הוזנו' : 'תוצאות חיות'}</b><span>${res.done}/${res.total} בולדרים הוזנו · ${res.started} התחילו</span>${intl ? appealsOf(res.rows).map(a => `<span class="ap-line">⚖️ ערעור פתוח: ${esc(lastName(a.name))} · B${a.b}</span>`).join('') : ''}${err ? '<span>אין חיבור כרגע — מוצג המצב האחרון</span>' : ''}<span class="muted">מתעדכן כל 15 שניות · ${intl ? 'World Climbing' : 'לא רשמי'}</span></div>`)(intl ? IFSC[r.id]?.err : live.err) : ''}
    ${lockBar(r, res)}
    <div class="res-head"><span class="muted small">מקור: ${esc(srcOf(res))}</span>
      <span class="legend"><span><i class="cell t lg">T</i> טופ</span><span><i class="cell z lg">Z</i> זון בלי טופ</span><span><i class="cell n lg">—</i> בלי זון</span><span class="muted">T2 = טופ בניסיון השני</span></span></div>
    ${cards}
    ${analysis ? `<div class="card bstats"><h3>הבולדרים בראונד: כמה הגיעו לטופ ולזון</h3>${stats}</div>` : ''}
    ${isrChips}
    <div class="card"><div class="tbl-head"><b>${onlyIsr ? (resFem ? 'הישראליות' : 'הישראלים') : resFem ? 'כל המתחרות' : 'כל המתחרים'}</b><span class="muted small">${intl ? (Object.keys(whoByBib).length ? `רקע = ${resFem ? 'ישראליות' : 'ישראלים'} · פס בצד = שלי` : `שורה מסומנת = ${resFem ? 'ישראליות' : 'ישראלים'}`) : `שורה מסומנת = ${VIEWER ? 'ספורטאי הפלגיה' : 'שלי'}`}</span></div>
      <div class="tbl-wrap"><table class="res-tbl"><thead><tr><th class="rk">#</th><th class="n">${resFem ? 'מטפסת' : 'מטפס'}</th><th class="bib">מס׳</th>${Array.from({ length: nB }, (_, j) => `<th class="bh"><span class="hl">בולדר </span><span class="hs">B</span>${j + 1}</th>`).join('')}<th class="tz">T / Z</th><th class="tt">ניקוד</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    <p class="muted small">ניקוד: טופ 25, זון 10, מינוס 0.1 על כל ניסיון שנכשל לפני. ${intl ? '' : 'תיקו: השוואה לראונד הקודם (אם היה), אחר כך פחות ניסיונות לטופים, אחר כך פחות ניסיונות לזונים. '}${intl ? `הדירוג לפי World Climbing (של הראונד הזה בלבד). ${r.adv ? `עולים לראונד הבא: ${r.adv}${r.group ? ' מכל קבוצה' : ''}; תיקו על המקום האחרון — לפי World Climbing.` : /-f(-[a-z])?$/.test(r.id) ? 'ראונד אחרון — אין ראונד המשך.' : ''}` : res.final ? 'ראונד אחרון בתחרות — אין ראונד המשך.' : `עולים: ${q} (לפי אמות המידה של ההתאחדות); תיקו על המקום האחרון עולה.`}</p>
  </div>`;
}
// 3.16.0 saved lead round (World Climbing format): rank, climber + country, height per route ("+" = a move past the
// hold; quals: route place in brackets + combined points), Israelis highlighted, "רק ישראלים", qualifying line. No cards.
function renderLead(r, part, isrKey) {
  if (part === 'cards') return '';
  if (!resultsOf(r.id).intl) return renderNatLead(r, part);
  const res = resultsOf(r.id), fem = resFem, nIsr = res.rows.filter(isIsr).length, onlyIsr = !!(nIsr && resIsr[isrKey]);
  const chips = !part && nIsr ? isrSeg(onlyIsr, fem) : '';
  const last = /-f$/.test(r.id), mineBy = intlMineByBib(res.rows, DATA.intlMine), bibOf = Object.fromEntries(res.rows.filter(isIsr).map(x => [x.name, x.bib]));
  const nameHtml = n => intlName(n) + (mineBy[bibOf[n]] ? ` <span class="tag">${esc(mineBy[bibOf[n]].short)}</span>` : ''); // 3.18.0: my athletes tagged
  const mine = Object.keys(mineBy).length ? new Set(Object.keys(mineBy).map(Number)) : null;
  return `<div class="res lead-res">
    <div class="res-head"><span class="muted small">מקור: ${esc(srcOf(res))}</span></div>
    ${nIsr ? '' : `<p class="muted">${fem ? 'אין ישראליות בראונד הזה.' : 'אין ישראלים בראונד הזה.'}</p>`}
    ${chips}
    <div class="card"><div class="tbl-head"><b>${onlyIsr ? (fem ? 'הישראליות' : 'הישראלים') : !res.started && res.status !== 'finished' ? 'סדר העלייה' : fem ? 'כל המתחרות' : 'כל המתחרים'}</b><span class="muted small">${mine ? `רקע = ${fem ? 'ישראליות' : 'ישראלים'} · פס בצד = שלי` : `שורה מסומנת = ${fem ? 'ישראליות' : 'ישראלים'}`}</span></div>
      <div class="tbl-wrap">${res.rows.length ? leadTableHtml(rankedOf(r.id), { nR: r.boulders, adv: r.adv || 0, onlyIsr, fem, nameHtml, mine, waiting: res.status !== 'finished' && !res.complete })
        : `<p class="muted">${gw(r.id, 'רשימת המטפסים', 'רשימת המטפסות')} תתפרסם לפני הראונד.</p>`}</div></div>
    <p class="muted small">גובה = מספר האחיזה האחרונה שהוחזקה; <bdi dir="ltr">+</bdi> = תנועה ממנה הלאה; TOP = עד סוף המסלול. ${r.boulders > 1 ? 'במוקדמות: ניקוד משולב של המסלולים (נמוך יותר = טוב יותר), ובסוגריים המקום בכל מסלול. ' : ''}הדירוג לפי World Climbing. ${r.adv ? `עולים לראונד הבא: ${r.adv}.` : last ? 'ראונד אחרון — אין ראונד המשך.' : ''}</p>
  </div>`;
}
// 3.26.0 national lead round (federation live / locked): same World Climbing table, my athletes marked (the "שלי"
// rows), the live bar + lock bar like boulder, qualifying line = the info sheet quota. No cards.
function renderNatLead(r, part) {
  const res = resultsOf(r.id), fem = resFem, ranked = rankedOf(r.id);
  const mineBy = {}; for (const m of mineOf(r.id)) { const s = r.slots[m.k]; if (s) mineBy[s.bib] = m; }
  const nameHtml = n => { const x = res.rows.find(y => y.name === n), m = x && mineBy[x.bib]; return esc(n) + (m ? ` <span class="tag">${esc(m.short)}</span>` : ''); };
  const last = res.final || lastRound(r.id), q = last ? 0 : r.info?.quota || 0;
  const running = res.live && !res.complete;
  return `<div class="res lead-res${res.live ? ' is-live' : ''}">
    ${res.live ? `<div class="live-bar${live.err ? ' err' : ''}">${LTAG}<b>${res.complete ? 'כל המסלולים הוזנו' : 'תוצאות חיות'}</b><span>${res.done}/${res.total} מסלולים הוזנו · ${res.started} התחילו</span>${live.err ? '<span>אין חיבור כרגע — מוצג המצב האחרון</span>' : ''}<span class="muted">מתעדכן כל 15 שניות · לא רשמי</span></div>` : ''}
    ${part ? '' : lockBar(r, res)}
    <div class="res-head"><span class="muted small">מקור: ${esc(srcOf(res))}</span></div>
    <div class="card"><div class="tbl-head"><b>${fem ? 'כל המתחרות' : 'כל המתחרים'}</b><span class="muted small">שורה מסומנת = ${VIEWER ? 'ספורטאי הפלגיה' : 'שלי'}</span></div>
      <div class="tbl-wrap">${leadTableHtml(ranked, { nR: r.boulders, adv: q, fem, nameHtml, mine: new Set(Object.keys(mineBy).map(Number)), waiting: running })}</div></div>
    <p class="muted small">גובה = מספר האחיזה האחרונה שהוחזקה; <bdi dir="ltr">+</bdi> = תנועה ממנה הלאה; TOP = עד סוף המסלול. ${r.boulders > 1 ? 'בראונד הראשון: ניקוד משולב של שני המסלולים (נמוך יותר = טוב יותר), ובסוגריים המקום בכל מסלול. ' : 'תיקו: לפי המקום בראונד הראשון. '}${last ? 'ראונד אחרון — אין ראונד המשך.' : q ? `עולים לראונד הבא: ${q}; תיקו על המקום האחרון עולה.` : ''}</p>
  </div>`;
}
// 3.16.0: lead rounds count routes, boulder rounds boulders
const unitsOf = r => (r.lead ? (r.boulders === 1 ? 'מסלול אחד' : `${r.boulders} מסלולים`) : `${r.boulders} בולדרים`);

// 3.12.0 combined A + B (Roei): my athletes' cards of both groups on top (3.18.0) (coach), then each group's own table — side by
// side on wide screens (A on the right), stacked on narrow ones. Rankings are never merged.
function renderCombo(r) {
  const gs = r.combo.map(round);
  const cards = VIEWER ? '' : gs.map(g => (resultsOf(g.id) ? renderResults(g, 'cards', r.id) : '')).join('');
  const groups = gs.map(g => `<section class="combo-g"><h3 class="combo-h">קבוצה ${esc(g.group)}</h3>${resultsOf(g.id) ? renderResults(g, 'group', r.id)
    : `<p class="muted intl-wait">${IFSC[g.id]?.err ? 'אין חיבור כרגע לתוצאות של World Climbing — מנסה שוב…' : 'טוען תוצאות מ-World Climbing…'}</p>`}</section>`).join('');
  return `<div class="res combo-res">${cards ? `<div class="focus">${cards}</div>` : ''}<div class="combo-grid">${groups}</div></div>`;
}
// "כולם / רק ישראלים" (3.18.0: one place, right above the results table)
const isrSeg = (only, fem) => `<div class="choices res-cats res-isr" role="group" aria-label="סינון"><button type="button" class="choice" data-resisr="0" aria-pressed="${!only}">כולם</button><button type="button" class="choice" data-resisr="1" aria-pressed="${only}">🇮🇱 ${fem ? 'רק ישראליות' : 'רק ישראלים'}</button></div>`;

function appealText(a) { // 3.22.0 lead: route A/B, start lists without bibs
  const r = round(a.round);
  return [`ערעור — ${evOf(r).title} · ${roundTitle(r.title)} (${dayLabel(r.date)})`, `ספורטאי: ${a.name}${a.bib != null ? ` · מס' גב ${a.bib}` : ''} · סדר עלייה ${a.order}`,
    `${/^[AB]$/.test(a.boulder) ? 'מסלול' : 'בולדר'}: ${a.boulder}`, `שעה: ${a.time}`, `תיאור: ${a.text}`].join('\n');
}

// ---- notes & appeals (3.1.0): this round or all rounds, filter by name, edit notes, appeal status ----
let logAll = false, logName = null, editId = null;
const APPEAL_ST = [['pending', 'ממתין'], ['ok', 'התקבל ✓'], ['no', 'נדחה ✗']];
function logItems() {
  const inScope = i => logAll || i.round === current;
  const all = [...store.notes(inScope).map(n => ({ ...n, type: 'note' })), ...store.appeals(inScope).map(a => ({ ...a, type: 'appeal' }))];
  return { all, shown: (logName ? all.filter(i => i.short === logName) : all).sort((a, b) => b.at - a.at) };
}
const noteText = n => `${n.short} · ${roundTitle(round(n.round)?.title)} · ${fmtClock(n.at)}${n.ctx ? ` · ${n.ctx}` : ''}${n.edited ? ` · נערך ${fmtClock(n.edited)}` : ''}\n${n.text}`;
const appealFull = a => appealText(a) + (a.status && a.status !== 'pending' ? `\nסטטוס: ${APPEAL_ST.find(x => x[0] === a.status)[1]}${a.outcome ? ' · ' + a.outcome : ''}` : '');
function logCard(i) {
  const r = round(i.round);
  const from = store.deviceCount > 1 && store.deviceName(i.dev) ? ` · ${esc(store.deviceName(i.dev))}` : '';
  if (i.type === 'appeal') {
    const st = i.status || 'pending';
    return `<article class="log card appeal st-${st}"><header><b>⚑ ערעור · ${esc(i.short)}</b><span class="muted small">${esc(roundTitle(r?.title))} · ${esc(i.time)}${from}</span></header>
      <pre>${esc(appealText(i))}</pre>
      <div class="seg ap-st" role="group" aria-label="סטטוס הערעור">${APPEAL_ST.map(([k, l]) => `<button type="button" data-ap-st="${k}" data-ap="${i.id}" aria-pressed="${st === k}">${l}</button>`).join('')}</div>
      ${st !== 'pending' ? `<input type="text" class="ap-out" id="out-${i.id}" data-ap-out="${i.id}" maxlength="120" placeholder="מה הוחלט? (רשות) למשל: קיבלו טופ, עלה למקום 12" value="${esc(i.outcome || '')}">` : ''}
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-secondary" data-copy="${i.id}">העתק</button>
      ${navigator.share ? `<button type="button" class="btn btn-sm btn-secondary" data-share="${i.id}">שתף</button>` : ''}
      <button type="button" class="btn btn-sm btn-secondary btn-danger-text" data-del-appeal="${i.id}">מחיקה</button></div></article>`;
  }
  const editing = editId === i.id;
  return `<article class="log card"><header><b>📝 ${esc(i.short)}</b><span class="muted small">${esc(roundTitle(r?.title))} · ${fmtClock(i.at)}${i.ctx ? ` · ${esc(i.ctx)}` : ''}${i.edited ? ` · נערך ${fmtClock(i.edited)}` : ''}${from}</span></header>
    ${editing ? `<textarea class="note-edit" id="edit-${i.id}" rows="3" aria-label="עריכת ההערה">${esc(i.text)}</textarea>
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-primary" data-edit-save="${i.id}">שמירה</button><button type="button" class="btn btn-sm btn-secondary" data-edit-cancel>ביטול</button></div>`
    : `<p>${esc(i.text)}</p><div class="ath-actions"><button type="button" class="btn btn-sm btn-secondary" data-edit="${i.id}">עריכה</button><button type="button" class="btn btn-sm btn-secondary btn-danger-text" data-del-note="${i.id}">מחיקה</button></div>`}</article>`;
}
function renderLog() {
  const { all, shown } = logItems();
  const names = [...new Set(all.map(i => i.short))].sort((a, b) => a.localeCompare(b, 'he'));
  if (logName && !names.includes(logName)) logName = null;
  const cnt = n => all.filter(i => i.short === n).length;
  let body;
  if (!shown.length) body = `<p class="muted">${logAll ? 'עוד אין הערות או ערעורים.' : 'אין עדיין הערות או ערעורים בראונד הזה.'}</p>`;
  else if (!logAll) body = shown.map(logCard).join('');
  else { // all rounds: grouped by round, the round with the newest item first
    const groups = [];
    for (const i of shown) { let g = groups.find(x => x.id === i.round); if (!g) groups.push(g = { id: i.round, items: [] }); g.items.push(i); }
    body = groups.map(g => { const r = round(g.id); return `<h3 class="log-round">${r ? `${esc(evOf(r).title)} · ${dayLabel(r.date)} · ${esc(roundTitle(r.title))}` : 'ראונד'}</h3>${g.items.map(logCard).join('')}`; }).join('');
  }
  const pend = shown.filter(i => i.type === 'appeal' && (i.status || 'pending') === 'pending').length;
  // keep what the coach is typing (the list re-renders on sync / every second)
  const ae = document.activeElement, keep = ae?.closest?.('#view-log') && ae.id ? { id: ae.id, v: ae.value, a: ae.selectionStart, b: ae.selectionEnd } : null;
  patch($('#view-log'), `<div class="log-filters">
      <div class="seg" role="group" aria-label="איזה ראונדים"><button type="button" data-log-all="0" aria-pressed="${!logAll}">הראונד הזה</button><button type="button" data-log-all="1" aria-pressed="${logAll}">כל הראונדים</button></div>
      ${names.length > 1 ? `<div class="choices log-names" role="group" aria-label="סינון לפי שם"><button type="button" class="choice" data-log-name="" aria-pressed="${!logName}">הכל</button>${names.map(n => `<button type="button" class="choice" data-log-name="${esc(n)}" aria-pressed="${logName === n}">${esc(n)} <span class="n">${cnt(n)}</span></button>`).join('')}</div>` : ''}
    </div>
    <div class="log-actions"><button type="button" class="btn btn-sm btn-secondary" id="export-btn">ייצוא קובץ</button>
    <button type="button" class="btn btn-sm btn-secondary" id="copy-all-btn">העתק הכל</button>${pend ? `<span class="pend-count">⚑ ${pend} ממתין${pend > 1 ? 'ים' : ''} להחלטה</span>` : ''}<span class="muted small log-sync">${esc(syncLabel())}</span></div>` + body);
  if (keep) { const el = document.getElementById(keep.id); if (el && el !== document.activeElement) { el.value = keep.v; el.focus(); try { el.setSelectionRange(keep.a, keep.b); } catch { /* ignore */ } } }
}

// ---- home: all rounds by event / day, tap to open ----
function roundEndMs(r) { return engineEnd(r, off(r.id)); }

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
    return `<li class="${cls}"><span class="ovl-at">${range(fmtClock(w.startMs), fmtClock(w.endMs))}</span><span class="ovl-list">${who}</span>${cls === 'now' ? '<span class="ovl-badge">עכשיו</span>' : ''}</li>`;
  }).join('');
  return `<div class="ovl card"><div class="ovl-head"><b>⚠︎ חפיפות בטיפוס</b><span class="muted small">${ov.length} רוטציות שבהן ${max > 2 ? 'עד ' + max : 'שניים'} שלך מטפסים במקביל</span></div><ol>${rows}</ol></div>`;
}

let homeOpenEvent = null; // list view: which event is opened (null = the list)
let homeSeason = null;   // 3.14.0 list level: which season is open (null = the seasons level)
let homeFrom = null;     // where the open competition came from: a season id → back to that list; null → seasons level
let evFilter = loadFilter(); // { disc: [], type: [], age: [] } — [] = all
function loadFilter() { try { return { disc: [], type: [], age: [], ...JSON.parse(localStorage.getItem('comp-filters-v1') || '{}') }; } catch { return { disc: [], type: [], age: [] }; } }
function saveFilter() { try { localStorage.setItem('comp-filters-v1', JSON.stringify(evFilter)); } catch {} }
// Every competition by date. A competition without rounds (lead leagues for now) is listed by its `dates` only.
// Viewer: only rounds still ahead, and competitions with something still ahead.
const hasRounds = e => DATA.rounds.some(r => (r.event || 'bl1') === e.id);
const evDates = e => e.dates || [...new Set(DATA.rounds.filter(r => (r.event || 'bl1') === e.id).map(r => r.date))].sort();
function homeEvents() {
  // 3.11.0: by season (national first, then international), each by date — every data-ev index follows this order
  const all = bySeason(EVENTS().map(e => ({ event: e, rounds: roundsOf(e), dates: evDates(e) })));
  const v = all.filter(x => x.rounds.length || (!hasRounds(x.event) && (!VIEWER || x.dates.at(-1) >= evToday(x.event))));
  return v.length ? v : all.slice(-1);
}
// phase of a whole competition: live / before / after (by its rounds, or by its dates when it has none)
function evPhase(ev, t = now()) {
  if (ev.rounds.length) {
    const rs = ev.rounds.filter(r => r.slots.length);
    if (rs.some(r => stateAt(r, t, off(r.id)).phase === 'live') || ev.rounds.some(r => r.ifsc && ifscPhase(r) === 'live')) return 'live';
    const done = r => (r.ifsc ? ifscPhase(r) === 'after' : isLeadLive(r) ? stateAt(r, t).phase === 'after' // 3.22.0 lead: by its routes
      : roundStart(r) + off(r.id) + (r.slots.length ? windowCount(r) * r.slotSec * 1000 : 12 * 3600e3) < t);
    return ev.rounds.every(done) ? 'after' : 'before';
  }
  const today = evToday(ev.event);
  return ev.dates.at(-1) < today ? 'after' : ev.dates[0] <= today ? 'live' : 'before';
}
// the competition to show by default: the earliest one not finished yet, else the latest (by date — the list is by season)
function focusEventIdx() {
  const evs = homeEvents(); let i = -1, last = 0;
  evs.forEach((ev, j) => { if (evPhase(ev) !== 'after' && (i < 0 || ev.dates[0] < evs[i].dates[0])) i = j; if (ev.dates[0] > evs[last].dates[0]) last = j; });
  return i < 0 ? last : i;
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
  if (ev.event.cancelled) return CANCEL_TAG;
  const ph = evPhase(ev);
  if (ph === 'live') return ev.rounds.length ? '<span class="hb live">חי עכשיו</span>' : '<span class="hb live">היום</span>';
  if (ph === 'after') return '<span class="hb done">הסתיים</span>';
  // 3.11.1 international, between rounds on its days: the next round's start (Israel time)
  const next = ev.event.intl && ev.rounds.filter(r => r.ifsc && ifscPhase(r) === 'before').sort((a, b) => roundStart(a) - roundStart(b))[0];
  if (next && ev.dates[0] <= evToday(ev.event)) return `<span class="hb soon">היום · ${fmtHM(roundStart(next))}</span>`;
  if (evs.find(x => evPhase(x) === 'before') === ev) return '<span class="hb soon">בקרוב</span>';
  const days = Math.round((new Date(ev.dates[0] + 'T12:00:00') - new Date(evToday(ev.event) + 'T12:00:00')) / 864e5);
  return `<span class="hb later">בעוד ${days} ימים</span>`;
}

// ---- 3.10.0 (Roei): final standings per category — one round = its ranking; two rounds = round 2 for whoever got
// there, round 1 for the rest (finalStandings). Ready once every round of the category has official (not live) results.
const catKey = id => id.replace(/-r\d$/, '');
const CUP = '<svg class="cup" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.7V7Zm10 0v2.7A2 2 0 0 0 18 8V7h-1Z"/></svg>';
function finalsOf(ev) {
  if (ev.event.intl) return []; // international: only round rankings (no cumulative IFSC ranking — out of scope 3.11.0)
  const groups = {};
  for (const r of DATA.rounds.filter(r => (r.event || 'bl1') === ev.event.id)) (groups[catKey(r.id)] ||= []).push(r);
  return Object.keys(groups).sort().map(key => {
    const rs = groups[key].sort((a, b) => (a.id < b.id ? -1 : 1));
    const ready = rs.every(r => { const res = resultsOf(r.id); return res && !res.live; });
    const mine = new Map(rs.flatMap(r => mineOf(r.id).map(m => [r.slots[m.k]?.bib, m.short])));
    // (club: round 1's when a later round's row has none)
    const club = Object.fromEntries(rs.flatMap(r => resultsOf(r.id)?.rows || []).filter(x => x.club).map(x => [x.bib, x.club]));
    return { key, id: rs.at(-1).id, title: roundTitle(rs[0].title).split(' · ')[0], ready, mine, rows: ready ? finalStandings(rs.map(r => rankedOf(r.id))).map(x => (x.club ? x : { ...x, club: club[x.bib] })) : null };
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
  const body = f.rows.map((x, i) => (two && i === firstOut ? `<tr class="fin-cut"><td colspan="4">לא עלו לראונד השני · לפי הראונד הראשון</td></tr>` : '') + tr(x)).join('');
  patch($('#home'), `<div class="h-head"><button type="button" class="icon-btn h-back" id="final-back" aria-label="חזרה"><span class="ios-back-chev" aria-hidden="true"></span></button><h2 class="h-event fin-h">${CUP}תוצאות סופיות <span class="muted">· ${esc(evName(cur.event))}</span></h2></div>
    <div class="fin-chips choices" role="group" aria-label="קטגוריה">${fs.map(x => `<button type="button" class="choice" data-final="${homeFinal.ev}:${x.key}:${homeFinal.from}" aria-pressed="${x === f}">${esc(x.title)}</button>`).join('')}</div>
    <p class="muted small">${two ? `מי שעלה לראונד השני (${fin}) מדורג לפי הראונד השני בלבד; השאר אחריהם לפי הראונד הראשון.` : 'ראונד אחד: הדירוג שלו הוא הדירוג הסופי.'}</p>
    <div class="card fin-tbl"><table><thead><tr><th>#</th><th class="fin-nm">מתחרה</th>${two ? '<th>נקבע ב</th>' : ''}<th>ניקוד</th></tr></thead><tbody>${body}</tbody></table></div>`);
}

// 3.6.1 (Roei): no רשימה/מפורט switch — home = the list; on a competition day it opens straight on that
// competition's detail (the back chevron goes to the list until the home button is tapped again)
function renderHome() {
  const seg = ME ? `<div class="seg h-seg me-seg" role="group" aria-label="תצוגה"><button type="button" data-home-tab="all" aria-pressed="${homeTab === 'all'}">כללי</button><button type="button" data-home-tab="me" aria-pressed="${homeTab === 'me'}">שלי</button></div>` : '';
  if (ME && homeTab === 'me') return renderMe(seg);
  if (homeFinal) return renderFinal();
  if (homeOpenEvent == null) return renderHomeList(seg);
  renderHomeDetail('', true);
}

// ---- stage A (2026-10-23): "כללי | שלי" for an athlete who opened the portal from the Palgi app ----
// "כללי" = exactly the viewer portal. "שלי" = this athlete's own history (web/mine.js, by the app id only — never anyone
// else's rows): current-season tiles, then seasons, newest first; a row opens that round's results with the athlete's card.
let ME = null; // { id, name, short } — set in start() for an athlete entry with an app id; coach / viewer / code: null
let homeTab = 'all';
let meMemo = null;
function meHistory() {
  const day = todayStr();
  if (!meMemo || meMemo.locked !== LOCKED || meMemo.day !== day) meMemo = { locked: LOCKED, day, h: myHistory(DATA, ME.id, day, { locked: LOCKED }) };
  return meMemo.h;
}
const ymd = s => { const [y, m, d] = s.split('-').map(Number); return `${d}/${m}/${y}`; };
function renderMe(seg) {
  const h = meHistory(), cur = h.current;
  const tile = (n, k) => `<div class="me-tile"><b>${n}</b><span>${k}</span></div>`;
  const tiles = cur ? `<section class="me-sum"><h3 class="season-h">${esc(seasonLabel(cur.seasonId))}</h3><div class="me-tiles">${tile(cur.count, 'תחרויות')}${tile(cur.finals, 'גמרים')}${tile(cur.best, 'מקום הכי טוב')}</div></section>` : '';
  const row = c => `<button type="button" class="card ev-row me-row" data-me-open="${esc(c.roundId)}">
      <span class="ev-main"><b>${bidiParts(c.title)}</b><span class="muted small">${[ymd(c.date), ...catParts(c)].map(x => `<bdi>${esc(x)}</bdi>`).join(' · ')}</span></span>
      <span class="ev-side"><b class="me-place">מקום ${c.place}</b>${c.line ? `<span class="small muted"><bdi dir="ltr">${esc(c.line)}</bdi></span>` : ''}${c.score != null ? `<span class="small muted"><bdi dir="ltr">${c.score.toFixed(1)}</bdi> נק׳</span>` : ''}</span><span class="chev" aria-hidden="true"></span></button>`;
  const body = h.seasons.length ? h.seasons.map(s => `<section class="me-season">${cur?.seasonId === s.id ? '' : `<h3 class="season-h">${esc(s.label)}</h3>`}<div class="ev-list">${s.comps.map(row).join('')}</div></section>`).join('')
    : `<div class="card h-empty"><p>עוד אין תוצאות שלך בפורטל</p></div>`;
  patch($('#home'), `<div class="h-head"><h2 class="h-event">${esc(ME.name || ME.short)}</h2>${seg}</div>${tiles}${body}`);
}
// a "שלי" row → the round's results (category chip = the athlete's own, as the row's place), the athlete's card first and
// marked. International rounds show no cards to viewers (as today) → the results only.
let pick = null, pickScroll = false; // { round, bibs: Set }
function openMine(id) {
  const r = round(id); if (!r) return;
  const bibs = new Set((DATA.mine?.[id] || []).filter(m => m?.id === ME.id).map(m => r.slots?.[m.k]?.bib).filter(b => b != null).map(String));
  pick = { round: id, bibs }; pickScroll = true;
  const res = resultsOf(id);
  if (res && !res.intl && !res.lead) {
    const row = res.rows.find(x => bibs.has(String(x.bib)));
    const opt = row && catOptions(res.rows, genderOf(id)).find(o => o.cats?.length === 1 && o.cats[0] === row.cat);
    if (opt) resCat[id] = opt.key;
  }
  lastTabTap = Date.now(); current = id;
  for (const x of ['mine', 'all', 'results']) $('#view-' + x)._html = null;
  window.scrollTo(0, 0); // before the results render below scrolls to the picked card
  showScreen('round'); // round screen visible first (render() drops pick only on home / another round)
  openRoundView(); if (view !== 'results' && resultsOf(id)) setView('results');
}

// one competition row of the home list (data-ev = its index in homeEvents())
function evRowHtml(ev, i, evs, t) {
  const ph = evPhase(ev, t), badge = evBadge(ev, evs);
  const meta = [placeOnce(evName(ev.event), ev.event.place) && `<bdi>${esc(ev.event.place)}</bdi>` + tbdMark(ev.event.placeTbd), rangeLabel(ev.dates) + tbdMark(ev.event.dateTbd), ev.rounds.length ? `${ev.rounds.length} ראונדים` : 'הראונדים יתווספו בהמשך'].filter(Boolean).join(' · ');
  const people = new Set(ev.rounds.flatMap(r => (r.ifsc ? (ifscRes(r.id)?.rows || []).filter(isIsr).map(x => x.name) : mineOf(r.id).map(m => r.slots[m.k].name))));
  // 3.18.0 (Roei): international → also how many of them are mine
  const myIntl = ev.event.intl ? new Set(ev.rounds.flatMap(r => (r.ifsc ? Object.values(intlMineByBib(ifscRes(r.id)?.rows, DATA.intlMine)).map(m => m.short) : []))).size : 0;
  const ovl = ev.rounds.reduce((n, r) => n + (mineOf(r.id).length > 1 ? overlapsOf(r).length : 0), 0);
  const fin = finalsReady(ev);
  const tone = `ev-t-${evTone(ev.event)}`;
  return `${fin ? `<div class="ev-item card ${tone} ph-${ph}">` : ''}<button type="button" class="ev-row${fin ? '' : ' card'} ${tone} ph-${ph}" data-ev="${i}">
      <span class="ev-main"><b>${bidiParts(evName(ev.event))}</b><span class="muted small">${meta}</span></span>
      <span class="ev-side">${badge}<span class="small">${!ev.rounds.length || !people.size ? '' : `${people.size} ${ev.event.intl ? 'ישראלים' + (myIntl ? ` · ${myIntl} ${VIEWER ? 'ספורטאי הפלגיה' : 'שלי'}` : '') : VIEWER ? 'ספורטאי הפלגיה' : 'שלי'}`}${ovl ? `${people.size ? ' · ' : ''}<span class="ovl-count">⚠︎ ${ovl} חפיפות</span>` : ''}</span></span><span class="chev"></span></button>${fin ? `<button type="button" class="fin-btn" data-final="${i}:${finalsOf(ev)[0].key}:list">${CUP}תוצאות סופיות<span class="go" aria-hidden="true">‹</span></button></div>` : ''}`;
}
let ddOpen = null; // which filter menu is open on the season screen
const seasonOf = ev => ev.event.season || 'nat-2026-27';
// 3.14.0 (Roei): home list in two levels — seasons ("עכשיו" strip + a card per season), then one season's competitions
// (international: discipline / type / age filter chips). data-ev indices stay homeEvents() order.
function renderHomeList(seg) {
  const t = now(), evs = homeEvents();
  if (homeSeason == null) { // level 1: now strip + season cards
    const ni = pickNow(evs, ev => evPhase(ev, t), ev => evToday(ev.event));
    const strip = ni < 0 ? '' : `<section class="now-strip"><h3 class="season-h">עכשיו</h3>${evRowHtml(evs[ni], ni, evs, t)}</section>`;
    const cards = seasonsOf(evs.map(x => x.event)).map(s => {
      const items = evs.filter(x => seasonOf(x) === s.id); if (!items.length) return '';
      const withRes = items.filter(x => x.rounds.some(r => resultsOf(r.id)?.started)).length;
      return `<button type="button" class="card season-card" data-season="${s.id}"><span class="ev-main"><b>${esc(s.label)}</b>
        <span class="muted small">${esc(seasonSummary(items.map(x => x.event)))}${withRes ? ` · ${withRes} עם תוצאות` : ''}</span></span><span class="chev" aria-hidden="true"></span></button>`;
    }).join('');
    return patch($('#home'), `${seg ? `<div class="h-head">${seg}</div>` : ''}${strip}<div class="season-cards">${cards}</div>`);
  }
  // level 2: one season (international: filter chips)
  const all = evs.map((ev, i) => ({ ev, i })).filter(x => seasonOf(x.ev) === homeSeason);
  const intl = homeSeason.startsWith('intl');
  if (!intl) ddOpen = null; // final review: a menu left open on an intl season must not reach a season without filters
  const opts = intl ? filterOptions(all.map(x => x.ev.event)) : null, ef = intl ? effectiveFilter(evFilter, opts) : null;
  // 4.0.0: one row of three menus (ענף / סוג / גיל); each menu holds several values (check marks), the button says what is held
  const DD = { disc: DISC, type: TYPES, age: AGES }, DD_NAME = { disc: 'ענף', type: 'סוג תחרות', age: 'גיל' };
  const dd = k => (opts[k].length < 2 ? '' : `<button type="button" class="dd${ef[k].length ? ' on' : ''}" data-dd="${k}" aria-haspopup="menu" aria-expanded="${ddOpen === k}" aria-label="${DD_NAME[k]}"><span>${esc(filterLabel(k, ef[k], opts))}</span><span class="dd-caret" aria-hidden="true"></span></button>`);
  const menu = intl && ddOpen && opts[ddOpen]?.length > 1 ? `<div class="dd-menu card" role="menu" aria-label="${DD_NAME[ddOpen]}">${opts[ddOpen].map(v => {
    const on = !ef[ddOpen].length || ef[ddOpen].includes(v);
    return `<button type="button" class="dd-item" role="menuitemcheckbox" aria-checked="${on}" data-filt="${ddOpen}:${v}"><span class="dd-mark" aria-hidden="true">${on ? '✓' : ''}</span>${esc(DD[ddOpen][v])}</button>`;
  }).join('')}</div>` : '';
  const shown = intl ? filterEvents(all.map(x => ({ ...x, event: x.ev.event })), ef) : all;
  const body = shown.length ? shown.map(x => evRowHtml(x.ev, x.i, evs, t)).join('')
    : `<div class="card h-empty"><p>אין תחרויות שמתאימות לסינון</p><button type="button" class="btn btn-sm" id="filt-reset">הצג הכל</button></div>`;
  patch($('#home'), `<div class="h-head"><button type="button" class="icon-btn h-back" id="season-back" aria-label="חזרה"><span class="ios-back-chev" aria-hidden="true"></span></button><h2 class="h-event">${esc(seasonLabel(homeSeason))}</h2>${seg}</div>
    ${intl ? `<div class="ev-fbar"><div class="ev-filters">${dd('disc')}${dd('type')}${dd('age')}${menu}</div><p class="ev-count muted small">${shown.length === 1 ? 'תחרות אחת' : `${shown.length} תחרויות`}</p></div>` : ''}<div class="ev-list">${body}</div>`);
}

// isolation open/close (+ U17 route preview) from the federation info sheet (2.4.0); close time stressed = the deadline
const isoRange = s => { const [a, b] = String(s).split('–'); return b ? range(a, b) : s; };
const isoRow = r => (r.iso ? `<div class="iso"><span class="iso-k">בידוד</span><span class="iso-t"><b>${r.iso.open}</b> נפתח</span><span class="iso-ar">←</span><span class="iso-t close"><b>${r.iso.close}</b> נסגר</span>${
  r.iso.preview ? `<span class="iso-sep"></span><span class="iso-k">צפייה במסלולים</span><span class="iso-t"><b>${isoRange(esc(r.iso.preview))}</b></span>` : ''}</div>` : '');

function renderHomeDetail(seg, fromList) {
  const t = now();
  const evs = homeEvents(); const ei = homeOpenEvent ?? focusEventIdx(); const cur = evs[Math.min(ei, evs.length - 1)]; const { event: ev, rounds } = cur;
  const days = [...new Set(rounds.map(r => r.date))].sort();
  const chips = !fromList && evs.length > 1 ? `<div class="ev-chips choices" role="group" aria-label="תחרות">${evs.map((e, i) => {
    const d0 = new Date(e.dates[0] + 'T12:00:00');
    return `<button type="button" class="choice" data-ev="${i}" aria-pressed="${i === ei}">${esc(evName(e.event).replace('ליגת העל ', ''))} <span class="muted">${d0.getDate()}/${d0.getMonth() + 1}</span></button>`;
  }).join('')}</div>` : '';
  const card = r => {
    if (r.ifsc) return intlCard(r);
    if (natLeadWait(r)) return `<button type="button" class="h-card card ph-wait" data-open="${r.id}">
      <div class="h-top"><h3>${esc(roundTitle(r.title))}</h3><span class="hb wait">ממתין לסדר עלייה</span></div>
      <p class="muted small">${natLeadFacts(r)}${r.reg?.length ? ` · ${r.reg.length} ${gw(r.id, 'רשומים', 'רשומות')}` : ` · ${gw(r.id, 'עולים', 'עולות')} ${r.info?.quota}`}</p>
      ${r.info?.checkin ? `<div class="iso"><span class="iso-k">רישום</span><span class="iso-t"><b>${range(r.info.checkin[0], r.info.checkin[1])}</b></span></div>` : ''}${isoRow(r)}${natLeadMineHtml(r)}
    </button>`; // 3.22.0 national lead before the start lists
    const ph = r.slots.length ? stateAt(r, t, off(r.id)).phase : 'wait';
    const badge = { live: '<span class="hb live">חי עכשיו</span>', before: '<span class="hb soon">בקרוב</span>', after: '<span class="hb done">הסתיים</span>', wait: '<span class="hb wait">ממתין לסדר עלייה</span>' }[ph];
    const rk = rankedOf(r.id), rankOfK = k => rk?.find(x => x.bib === r.slots[k].bib)?.rank;
    const LL = isLeadLive(r); // 3.22.0 lead: a climber's time = her next leg (done → סיימה)
    const leadAt = k => { const a = athleteStatus(r, k, t); return a.kind === 'done' ? gw(r.id, 'סיים', 'סיימה') : fmtHM(a.startMs); };
    const mine = mineOf(r.id).map(m => `<li><b>${esc(m.short)}</b> <span>${rk ? (rankOfK(m.k) ? `מקום ${rankOfK(m.k)}` : gw(r.id, 'לא התחיל', 'לא התחילה')) : `#${r.slots[m.k].order} · ${LL ? leadAt(m.k) : fmtHM(slotStartMs(r, m.k, off(r.id)))}`}</span></li>`).join('');
    const live = ph !== 'live' ? '' : LL ? leadHomeLine(r, t)
      : (() => { const s = stateAt(r, t, off(r.id)); const b1 = s.boulders[0]; return `<p class="h-live">רוטציה ${s.n + 1} מתוך ${windowCount(r)} · בולדר 1: ${b1 ? `#${b1.order} ${esc(b1.name)}` : '—'}</p>`; })();
    return `<button type="button" class="h-card card ph-${ph}" data-open="${r.id}">
      <div class="h-top"><h3>${esc(roundTitle(r.title))}</h3>${rk ? '<span class="hb res">תוצאות</span>' : ''}${badge}</div>
      <p class="muted small">${r.slots.length ? range(fmtHM(roundStart(r) + off(r.id)), fmtHM(roundEndMs(r))) : fmtHM(roundStart(r) + off(r.id))} · ${LL ? unitsOf(r) : `${r.boulders} בולדרים · רוטציה ${fmtDur(r.slotSec0 * 1000)}`}${r.slots.length ? ` · ${r.slots.filter(Boolean).length} מתחרים` : ''}</p>
      ${isoRow(r)}${live}${mine ? `<ul class="h-mine">${mine}</ul>` : `<p class="muted small">${r.slots.length ? 'אין ספורטאים שלי' : ''}</p>`}
      ${mineOf(r.id).length > 1 && !LL ? (n => n ? `<p class="small ovl-count">⚠︎ ${n} רוטציות של חפיפה בטיפוס</p>` : '<p class="small ok-text">✓ ללא חפיפות בטיפוס</p>')(overlapsOf(r).length) : ''}
    </button>`;
  };
  patch($('#home'), `<div class="h-head">${fromList ? '<button type="button" class="icon-btn h-back" id="home-back" aria-label="חזרה"><span class="ios-back-chev" aria-hidden="true"></span></button>' : ''}<h2 class="h-event">${bidiParts(evName(ev))} <span class="muted">· ${placeOnce(evName(ev), ev.place) ? `<bdi>${esc(ev.place)}</bdi>` + tbdMark(ev.placeTbd) + ' · ' : ''}${rangeLabel(cur.dates)}${tbdMark(ev.dateTbd)}</span></h2>${seg}</div>${chips}` +
    (rounds.length ? '' : `<div class="card h-empty"><p><b>${evBadge(cur, evs)}</b></p><p class="muted">הראונדים וסדרי העלייה יתווספו כשיתפרסמו.${ev.place ? '' : ' המיקום עוד לא פורסם.'}</p></div>`) +
    finalCards(cur, ei) + days.map(d => `<section class="h-day"><h3 class="h-day-title">${dayLabel(d)}</h3><div class="h-grid">${rounds.filter(r => r.date === d).map(card).join('')}</div></section>`).join(''));
}

// 3.11.0 home card of an international round: date + boulders (no times — IFSC gives none), Israelis + their place
function intlCard(r) {
  if (r.combo) return comboCard(r);
  const ph = ifscPhase(r), res = resultsOf(r.id), rk = res ? rankedOf(r.id) : null;
  const st = roundStart(r), ilDay = dayIn(st), when = r.noTime ? '' : `${ilDay !== r.date ? dayLabel(ilDay) + ' ' : ''}${fmtHM(st)}`; // Israel time (3.13.0 saved past rounds: no time)
  const badge = { live: '<span class="hb live">חי עכשיו</span>', before: `<span class="hb soon">בקרוב · ${fmtHM(st)}</span>`, after: '<span class="hb done">הסתיים</span>' }[ph];
  const my = intlMineByBib(res?.rows, DATA.intlMine), tag = x => (my[x.bib] ? ` <span class="tag">${esc(my[x.bib].short)}</span>` : '');
  const isr = (rk || []).filter(isIsr).map(x => `<li><b>🇮🇱 ${esc(x.name)}${tag(x)}</b> <span>${x.rank ? `מקום ${x.rank}` : res.live ? gw(r.id, 'עוד לא טיפס', 'עוד לא טיפסה') : gw(r.id, 'לא התחיל', 'לא התחילה')}</span></li>`).join('');
  return `<button type="button" class="h-card card ph-${ph}" data-open="${r.id}">
      <div class="h-top"><h3>${esc(roundTitle(r.title))}</h3>${res?.started ? '<span class="hb res">תוצאות</span>' : ''}${badge}</div>
      <p class="muted small">${[when, unitsOf(r)].filter(Boolean).join(' · ')}${res?.rows.length ? ` · ${res.rows.length} ${gw(r.id, 'מתחרים', 'מתחרות')}` : ''}</p>
      ${isr ? `<ul class="h-mine">${isr}</ul>` : `<p class="muted small">${res && res.rows.length ? gw(r.id, 'אין ישראלים בראונד', 'אין ישראליות בראונד') : ''}</p>`}
    </button>`;
}

// 3.12.0 combined A + B home card: time + badge like its groups, the Israelis of both with their place in their group
function comboCard(r) {
  const ph = ifscPhase(r), gs = r.combo.map(round), st = roundStart(r), ilDay = dayIn(st);
  const badge = { live: '<span class="hb live">חי עכשיו</span>', before: `<span class="hb soon">בקרוב · ${fmtHM(st)}</span>`, after: '<span class="hb done">הסתיים</span>' }[ph];
  const isr = gs.flatMap(g => { const res = resultsOf(g.id), my = intlMineByBib(res?.rows, DATA.intlMine); return (res ? rankedOf(g.id) : []).filter(isIsr).map(x =>
    `<li><b>🇮🇱 ${esc(x.name)}${my[x.bib] ? ` <span class="tag">${esc(my[x.bib].short)}</span>` : ''}</b> <span>${x.rank ? `מקום ${x.rank}` : res.live ? gw(g.id, 'עוד לא טיפס', 'עוד לא טיפסה') : gw(g.id, 'לא התחיל', 'לא התחילה')} · ${esc(g.group)}</span></li>`); }).join('');
  const n = gs.reduce((s, g) => s + (resultsOf(g.id)?.rows.length || 0), 0), started = gs.some(g => resultsOf(g.id)?.started);
  return `<button type="button" class="h-card card combo-card ph-${ph}" data-open="${r.id}">
      <div class="h-top"><h3>${esc(roundTitle(r.title))}</h3>${started ? '<span class="hb res">תוצאות</span>' : ''}${badge}</div>
      <p class="muted small">${r.noTime ? '' : `${ilDay !== r.date ? dayLabel(ilDay) + ' ' : ''}${fmtHM(st)} · `}${r.boulders} בולדרים · ${gs.length} קבוצות${n ? ` · ${n} ${gw(r.id, 'מתחרים', 'מתחרות')}` : ''}</p>
      ${isr ? `<ul class="h-mine">${isr}</ul>` : ''}
    </button>`;
}

function showScreen(sc) {
  screen = sc;
  $('#home').hidden = sc !== 'home';
  $('#round-screen').hidden = sc !== 'round';
  $('#home-btn').setAttribute('aria-pressed', String(sc === 'home'));
  $('#round-tabs')._html = null;
  render();
}

// header title: HTML (bidi-safe parts) + plain sub line; empty → the block is hidden
function setTitle(html, sub) {
  const h = $('#event-title');
  if (h._html !== html) { h._html = html; h.innerHTML = html; }
  $('#round-sub').textContent = sub;
  $('.title-block').classList.toggle('empty', !html && !sub);
}

function render() {
  document.body.classList.toggle('in-round', screen !== 'home'); // the sticky header + button row block (CSS .top-stack)
  if (pick && (screen === 'home' || pick.round !== current)) { pick = null; pickScroll = false; } // left that round → no ring on a later visit
  applyDelays();
  if (DATA.rounds.some(r => r.ifsc)) ifscWanted().forEach(id => pollIfsc(id)); // 3.11.0: each round waits 15 s between fetches itself
  if (screen === 'home') {
    document.body.classList.remove('intl-round', 'combo-round', 'lead-round', 'board-gone');
    $('#clock').textContent = fmtClock(now());
    // portal consistency round: no competition title in the header on home / season / event (only inside a round)
    setTitle('', '');
    renderTabs(); renderHome(); checkAlerts();
    return;
  }
  // (not while reading results: a finished round with results stays put — 2.7.2)
  if (view !== 'results' && !round(current).ifsc && Date.now() - lastTabTap > 5 * 60000 && stateAt(round(current), now(), off(current)).phase === 'after') {
    const next = pickDefaultRound();
    if (next !== current) { current = next; for (const x of ['mine', 'all']) $('#view-' + x)._html = null; }
  }
  const r = round(current);
  const s = stateAt(r, now(), off(r.id));
  $('#clock').textContent = fmtClock(now());
  setTitle(bidiParts(evName(evOf(r))), `${r.ifsc && !r.noTime ? `${dayLabel(dayIn(roundStart(r)))} ${fmtHM(roundStart(r))}` : dayLabel(r.date)} · ${roundTitle(r.title)} · ${unitsOf(r)}${r.ifsc || r.lead ? '' : ` · רוטציה ${fmtDur(r.slotSec0 * 1000)}`}${SIM_AT != null ? ' · מצב הדמיה' : ''}`);
  // 3.11.0 international round: board (photos + tags) + results only — no clock, start list, "mine", notes (CSS)
  document.body.classList.toggle('intl-round', !!r.ifsc);
  document.body.classList.toggle('lead-round', !!r.lead);
  document.body.classList.toggle('nat-lead-wait', natLeadWait(r)); // 3.22.0: no clock / next-up before the start lists
  document.body.classList.toggle('lead-live', isLeadLive(r)); // 3.22.0: route cards replace the board, clock and next-up
  const phT = $('#photos-btn').lastChild, phL = isLeadLive(r) ? 'טופו' : 'תמונות בולדרים'; // 3.22.0 Task 7: replace / delete a topo
  if (phT.textContent !== phL) phT.textContent = phL;
  // consistency round §10: the section heading names the selected tab
  const allLbl = natLeadWait(r) ? 'הרשומים' : 'סדר עלייה מלא'; // 3.22.0: before the start lists the list = who registered
  $('[data-view="all"]').textContent = allLbl;
  $('#mine-h').textContent = r.ifsc ? 'תוצאות' : ({ all: allLbl, log: 'הערות וערעורים', results: 'תוצאות' }[view] || MINE_H);
  // portal consistency round (Roei: "15 דק אחרי סיום"): 15 min after the end the board, timer, calibration and next-up
  // go away (CSS body.board-gone); results open as today; before results the coach sees a short ended state instead
  const rs = resultsOf(r.id), gone = boardGone(r, now(), off(r.id));
  document.body.classList.toggle('board-gone', gone);
  $('#board').hidden = gone && !!rs;
  renderTabs();
  if (gone) patch($('#board'), rs ? '' : '<div class="board-msg ended">הראונד הסתיים · התוצאות יופיעו כאן</div>');
  else if (isLeadLive(r)) patch($('#board'), leadBoardHtml(r, leadCtx(r)));
  else { renderBoard(r, s); renderTimer(r, s); renderNext(r, s); }
  if (gone) $('#par').hidden = true; // §5 board gone: no parallel-round box on an ended round either (final review)
  else renderPar(r);
  const rb = $('[data-view="results"]'), lv = !!rs?.live;
  rb.hidden = !rs;
  if (rb.classList.contains('lv') !== lv) { rb.classList.toggle('lv', lv); rb.innerHTML = 'תוצאות' + (lv ? LTAG : ''); rb.setAttribute('aria-label', lv ? 'תוצאות — חי, לא רשמי' : 'תוצאות'); }
  document.body.classList.toggle('combo-round', !!r.combo);
  if (r.ifsc && view !== 'results') { setView('results'); return; }
  if (view === 'results' && !resultsOf(r.id) && !r.ifsc) { setView('mine'); return; }
  // a results problem must never stop the clock + alerts below (audit 2026-10-15)
  if (view === 'results' && r.combo) try { patch($('#view-results'), renderCombo(r)); } catch (e) { console.error('results', e); }
  else if (view === 'results' && !resultsOf(r.id)) patch($('#view-results'), `<p class="muted intl-wait">${IFSC[r.id]?.err ? 'אין חיבור כרגע לתוצאות של World Climbing — מנסה שוב…' : 'טוען תוצאות מ-World Climbing…'}</p>`);
  else if (view === 'results') try { patch($('#view-results'), renderResults(r)); } catch (e) { console.error('results', e); }
  if (pickScroll && view === 'results' && resultsOf(r.id)) { pickScroll = false; $('#view-results .fc.picked')?.scrollIntoView({ block: 'center' }); }
  if (view === 'mine') renderMine(r);
  if (view === 'all') renderAll(r);
  if (view === 'log') renderLog();
  const t = now();
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = fmtDur(Number(el.dataset.until) - t); });
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = fmtDur(t - Number(el.dataset.since)); }); // 3.22.0 lead: time on the wall
  document.querySelectorAll('[data-bar-since]').forEach(el => { el.style.width = `${Math.min(100, Math.max(0, (t - Number(el.dataset.barSince)) / 3600))}%`; }); // of 6:00
  checkAlerts();
}

// ---- 3.22.0 lead live board: context for web/leadView.js + the coach's route controls (shared marks / settings in store) ----
const leadPick = {}; // round → route whose colour picker is open (this session)
function leadCtx(r) {
  return { now: now(), ctls: r.leadCtl || {}, set: store.leadSet(r.id), mineKs: mineK(r.id), viewer: VIEWER, pick: leadPick[r.id] || null, holds: r.holds, video: r.video,
    // 3.22.0 Task 7: topo = the round's photo b 1 (A) / 2 (B); route notes = notes with k: null + route (coach only — viewers never sync notes)
    topoUrl: x => photoUrl(r.id, topoB(x)), topoHas: x => !!photoV(r.id, topoB(x)), topoBusy: x => busyPh.has(r.id + ':' + topoB(x)),
    routeNote: x => (VIEWER ? null : routeNoteText(store.notes(n => n.round === r.id), x)) };
}
// 3.22.0 Task 7: a note on a whole route (the existing note kind, no athlete: k null) — listed on the notes screen as "מסלול A"
function openRouteNote(x) {
  const r = round(current);
  if (VIEWER || !isLeadLive(r) || !leadRoutes(r).includes(x)) return;
  const name = `מסלול ${x}`;
  $('#note-title').textContent = `הערה · ${name}`;
  $('#note-ctx').textContent = `${roundTitle(r.title)} · ${fmtClock(now())}`;
  $('#note-text').value = '';
  const dlg = $('#note-dlg'); dlg.returnValue = '';
  dlg.onclose = () => {
    const text = $('#note-text').value.trim();
    if (dlg.returnValue !== 'save' || !text) return;
    store.addNote({ round: r.id, k: null, route: x, name, short: name, at: now(), ctx: '', text });
    render();
  };
  dlg.showModal();
}
function leadCtlSet(x, f) {
  const r = round(current);
  if (VIEWER || !isLeadLive(r) || !leadRoutes(r).includes(x)) return;
  const c = store.leadCtl(r.id, x), n = f(r, x, ownCtl(r.leadCtl?.[x]) || c); // 3.27.0: a tap goes on from what the board shows
  if (n && n !== c) store.setLeadCtl(r.id, x, n);
  render();
}
function leadSetClick(d) {
  const r = round(current);
  if (VIEWER || !isLeadLive(r)) return;
  if (d.leadPick) leadPick[r.id] = leadPick[r.id] === d.leadPick ? null : d.leadPick;
  else if (d.leadColor) { // 3.23.0: the picker stays open — a second tap may add the second colour
    const [x, c] = d.leadColor.split('|'), cur = store.leadSet(r.id);
    if (leadRoutes(r).includes(x) && leadColor2(c)) {
      const now2 = routeColors(cur, x, r.holds), p = leadPickColor(now2.c1, now2.c2, leadColor2(c)); // 3.24.0: from the shown colours (default holds too)
      store.setLeadSet(r.id, { colors: { [x]: p.c1 }, colors2: { [x]: p.c2 } });
    }
  }
  else store.setLeadSet(r.id, { swap: !store.leadSet(r.id).swap });
  render();
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
let clockBack = false; // opened by the app's button → closing returns to the app (history.back())
function openClock(back = false) {
  clockBack = !!back;
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
  $('#sc-round').textContent = s.phase === 'count' ? 'מתחילים בעוד' : s.phase === 'done' ? 'הסימולציה הסתיימה' : `רוטציה ${s.w + 1} מתוך ${sc.n}`;
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
  if (!r.slots.length || r.lead || !mineOf(r.id).length) return null; // 3.22.0: no #par box on/for lead rounds (spec §8: swipe)
  const a0 = roundStart(r) + off(r.id), a1 = roundEndMs(r);
  return DATA.rounds.find(x => x.id !== r.id && x.slots.length && !x.lead && x.date === r.date && mineOf(x.id).length
    && roundStart(x) + off(x.id) < a1 && roundEndMs(x) > a0) || null;
}
// 3.22.0 Task 9: a lead round running at the same time as this one (same competition, both with my athletes) → hint line, swipe to it
function leadParRound(r) {
  if (!isLeadLive(r) || !mineOf(r.id).length) return null;
  const a0 = roundStart(r), a1 = roundEndMs(r), t = now();
  return roundsOf(evOf(r)).find(x => x.id !== r.id && isLeadLive(x) && mineOf(x.id).length && Number.isFinite(roundEndMs(x))
    && roundStart(x) < a1 && roundEndMs(x) > a0 && stateAt(x, t).phase !== 'after') || null;
}
function renderLeadPar(r, el) {
  const par = leadParRound(r), h = par ? leadParHint(r, par, { now: now(), ctls: par.leadCtl || {}, mine: mineOf(par.id) }) : '';
  const html = h ? `<button type="button" class="lead-par-hint" data-go-round="${par.id}">${esc(h)}</button>` : '';
  el.hidden = !h; el.classList.toggle('lead-par', !!h);
  if (h && el.nextElementSibling?.id !== 'board') $('#board').before(el); // above the board
  if (el.dataset.lp !== html) { el.innerHTML = html; el.dataset.lp = html; }
}
function renderPar(r) {
  const el = $('#par');
  if (isLeadLive(r)) return renderLeadPar(r, el);
  if (el.dataset.lp) { el.innerHTML = ''; el.dataset.lp = ''; } el.classList.remove('lead-par');
  if (el.previousElementSibling?.id !== 'board') $('#board').after(el); // back to its place below the board
  const par = parRound(r);
  el.hidden = !par; if (!par) return;
  const s = stateAt(par, now(), off(par.id));
  const head = s.phase === 'live' ? `רוטציה ${s.n + 1} · נותר <b class="par-t${s.slotLeftMs <= 60000 ? ' warn' : ''}">${fmtDur(s.slotLeftMs)}</b>`
    : s.phase === 'before' ? `מתחיל בעוד <b class="par-t">${fmtDur(roundStart(par) + off(par.id) - now())}</b>` : 'הסתיים';
  if (!el.querySelector('.par-board')) el.innerHTML = '<div class="par-top"></div><div class="par-board board"></div>';
  patch(el.querySelector('.par-top'), `<b>במקביל: ${esc(roundTitle(par.title))}</b><span class="par-clock">${head}</span><button type="button" class="btn btn-sm btn-secondary" data-go-round="${par.id}">לעבור לראונד</button>`);
  renderBoard(par, s, el.querySelector('.par-board'));
}
// the rounds a swipe steps through: the open competition, by start time; by default only rounds with my athletes
function swipeSeq() {
  const r = round(current);
  return roundsOf(evOf(r)).filter(x => x.id === current || x.ifsc || !store.settings.swipeMine || mineOf(x.id).length)
    .sort((a, b) => roundStart(a) - roundStart(b));
}
function goRound(id) {
  lastTabTap = Date.now(); current = id;
  for (const x of ['mine', 'all', 'results', 'log']) $('#view-' + x)._html = null;
  $('#par').innerHTML = ''; $('#par').dataset.lp = ''; editId = null;
  openRoundView(); render();
}
function swipeToast(seq, i) {
  document.querySelectorAll('.toast.swipe').forEach(x => x.remove());
  const el = document.createElement('div'); el.className = 'toast swipe';
  el.innerHTML = `<b>${esc(roundTitle(seq[i].title))}</b> <span class="muted-on-dark">${dayLabel(seq[i].date)}</span><span class="dots" aria-hidden="true">${seq.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</span>`;
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
    if (tg.closest('input, textarea, select, .rp-btn, #round-pick')) return;
    // 3.11.1: only areas that really scroll sideways (the phone results table fits — 3.9.0 — so swiping works over it)
    for (let el = tg.closest('.full-wrap, .tbl-wrap, .seg, .choices, #round-tabs, .ev-chips, .ev-filters'); el; el = el.parentElement?.closest('.full-wrap, .tbl-wrap, .seg, .choices, #round-tabs, .ev-chips, .ev-filters')) {
      if (el.scrollWidth > el.clientWidth + 1) return;
    }
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
    if (i < 0 || j < 0 || j >= seq.length) { back(); showToast(dx > 0 ? 'זה הראונד האחרון' : 'זה הראונד הראשון'); return; }
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
const ALERT_LBL = { w2: '2 רוטציות', w1: 'רוטציה', m2: '2 דקות', m1: 'דקה', s10: '10 שניות' };
function alertEntries() {
  applyDelays();
  const out = [], t = now();
  for (const r of DATA.rounds) {
    // 3.22.0 Task 8: lead = N climbers before her / 10 min before her estimate, per route (r.leadCtl from applyDelays)
    if (isLeadLive(r)) { out.push(...leadAlertEntries(r, mineOf(r.id), t, store.settings.leadAlert, roundTitle(r.title))); continue; }
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
          body: `${text} · ${roundTitle(r.title)}` });
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
// Stage A: Roei opened the portal from the Palgi app → alerts go through the app (one fixed app device on the Worker,
// /subscribe-app), never a browser push subscription — the page shares the app's origin and service worker.
const APP_PUSH_DEVICE = 'app-coach';
const viaApp = () => !VIEWER && store.appEntry?.role === 'coach';
const pushDevice = () => (viaApp() ? APP_PUSH_DEVICE : store.push.device);
// typed code on the app's host (…/comps/): Web Push only through the portal's own /comps/ service worker (web/entry.js)
let pushNoScope = false;
async function pushReg() {
  if (!pushNeedsCompsScope(location.hostname, location.pathname)) return navigator.serviceWorker.ready;
  const reg = await navigator.serviceWorker.getRegistration('./');
  if (!pushScopeOk(reg?.scope)) { pushNoScope = true; throw new Error('scope'); }
  const w = reg.installing || reg.waiting; // just registered: wait until it is active (or gone)
  if (!reg.active && w) await new Promise(res => { const on = () => { if (w.state === 'activated' || w.state === 'redundant') res(); }; w.addEventListener('statechange', on); on(); });
  return reg;
}
async function pushHeaders() {
  if (!pushKey) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('comp-push:' + store.code));
    pushKey = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return { 'Content-Type': 'application/json', 'X-Comp-Key': pushKey };
}
async function pushCall(path, body) {
  const res = await fetch(PUSH_URL + path, { method: 'POST', headers: await pushHeaders(), body: JSON.stringify({ device: pushDevice(), ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || String(res.status));
  return data;
}
function pushEnv() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (SIM_AT != null) return 'sim';
  if (viaApp()) return 'ready';
  if (pushNoScope) return 'unsupported';
  if (ios && !standalone) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}
async function syncPush(force = false) {
  if (VIEWER) return;
  if (!store.push.on || pushEnv() !== 'ready' || (!viaApp() && Notification.permission !== 'granted')) return;
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
  if (viaApp()) return pushCall('/subscribe-app', {});
  const reg = await pushReg();
  const { publicKey } = await (await fetch(PUSH_URL + '/key')).json();
  const b64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const key = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await pushCall('/subscribe', { sub: sub.toJSON() });
}
async function pushEnable() {
  if (viaApp()) {
    store.setPush(true);
    try { await pushSubscribe(); pushSent = ''; await syncPush(true); showToast('התראות דרך האפליקציה הופעלו ✓'); }
    catch { store.setPush(false); showToast('אין חיבור לשרת ההתראות. נסה שוב.'); }
    return renderPushState();
  }
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
    showToast(e.message === 'perm' ? 'לא אושרו התראות. אפשר לאשר בהגדרות האייפד → התראות → פורטל התחרויות'
      : e.message === 'scope' ? 'המכשיר לא תומך בהתראות (צריך iPadOS 16.4 ומעלה).' : 'אין חיבור לשרת ההתראות. נסה שוב.');
  }
  renderPushState();
}
async function pushDisable() {
  store.setPush(false);
  try { await pushCall('/unsubscribe', {}); } catch { /* offline: the server drops it when the push fails */ }
  if (!viaApp()) try { await (await (await pushReg()).pushManager.getSubscription())?.unsubscribe(); } catch { /* ignore */ } // app: never the app's own subscription
  pushSent = ''; renderPushState();
}
async function renderPushState() {
  const box = $('#push-state'); if (!box) return;
  const env = pushEnv(), on = store.push.on && env === 'ready';
  const label = viaApp() ? 'התראות דרך האפליקציה' : 'התראות על מסך נעול';
  $('#push-toggle').previousElementSibling.textContent = label; $('#push-toggle').setAttribute('aria-label', label);
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
  if (msg) { box.textContent = msg; if (env === 'ios-install' && !store.appEntry) box.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-sm btn-secondary" data-install-open>איך מוסיפים?</button>'); return; }
  if (!on) { box.textContent = 'כבוי · ההתראות מופיעות רק כשהאפליקציה פתוחה.'; return; }
  box.textContent = pushSent ? 'פעיל ✓ · בודק בשרת…' : 'פעיל · ממתין לחיבור לשרת…';
  try {
    const st = await (await fetch(`${PUSH_URL}/status?device=${encodeURIComponent(pushDevice())}`, { headers: await pushHeaders() })).json();
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
  $('#note-ctx').textContent = `${roundTitle(r.title)} · ${fmtClock(now())} · ${currentCtx(r, k)}`;
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
  const who = shortOf(r.id, k) || s.name, LL = isLeadLive(r);
  $('#appeal-who').textContent = `${shortOf(r.id, k) ? `${who} · ` : ''}${s.name} · #${s.order}${s.bib != null ? ` · גב ${s.bib}` : ''} · ${roundTitle(r.title)}`;
  $('#appeal-unit').textContent = LL ? 'מסלול' : 'בולדר';
  // 3.22.0 lead: pick the route — default = the leg she is on / waiting for now (else the last one)
  const lr = LL ? leadRoutes(r) : null, ld = LL && (lr.find(x => ['wall', 'prep', 'wait'].includes(legStatus(r, k, x, now(), r.leadCtl?.[x]).kind)) || lr.at(-1));
  $('#appeal-boulder').innerHTML = LL ? lr.map(x => `<option ${x === ld ? 'selected' : ''}>${x}</option>`).join('')
    : Array.from({ length: r.boulders }, (_, i) => `<option ${i + 1 === def ? 'selected' : ''}>${i + 1}</option>`).join('');
  $('#appeal-time').value = fmtClockIn(now());
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
    return confirmSync('הרוטציה מתחילה עכשיו?', `השעון יזוז ${d >= 0 ? 'אחורה (התחרות מאחרת)' : 'קדימה (התחרות מקדימה)'} בכ-${fmtDur(Math.abs(d))}. אחרי הסנכרון על בולדר 1: ${b1 ? `#${b1.order} ${b1.name}` : 'אף אחד (רוטציה ריקה)'}. אם זה לא מי שעולה עכשיו — לחץ ביטול והשתמש ב"מתחיל עכשיו" ליד המתחרה בסדר העלייה המלא.`, () => syncWindowNow(r, now(), off(r.id)));
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
  confirmSync(`#${s.order} ${s.name} ${gw(r.id, 'מתחיל', 'מתחילה')} עכשיו?`, `כל הרוטציות יכוילו כך ש-#${s.order} עולה עכשיו לבולדר 1 (${o === off(r.id) ? 'ללא שינוי' : `${o > off(r.id) ? 'מאחר' : 'מקדים'} ב-${fmtDur(Math.abs(o - off(r.id)))} לעומת הכיול הנוכחי`}).`, () => syncSlotNow(r, k, now()));
}

function openManual() {
  if (store.settings.lock) { showToast('הכיול נעול · אפשר לפתוח בהגדרות'); return; }
  const r = round(current);
  const cur = roundStart(r) + off(r.id);
  $('#manual-ctx').textContent = `${roundTitle(r.title)} · לפי סדר העלייה ${fmtClock(roundStart(r))} · כרגע ${fmtClock(cur)}`;
  $('#manual-time').value = fmtClockIn(cur);
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
    .map(r => `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${dayLabel(r.date)} · ${esc(roundTitle(r.title))}</option>`).join('');
  const dlg = $('#sim-dlg'); dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'go') return;
    const r = round($('#sim-round').value); const S = r.slotSec * 1000; const T0 = roundStart(r);
    const LL = isLeadLive(r), end = LL ? engineEnd(r) : NaN; // 3.22.0 lead: by its NET times (none → like an empty round)
    const span = LL ? (Number.isFinite(end) ? end - T0 : 0) : windowCount(r) * S;
    const from = $('#sim-from').value;
    const firstMine = mineOf(r.id)[0];
    const leadMine = () => { const st = athleteStatus(r, firstMine.k, T0 - 1).startMs; return st != null ? st - 5 * 60000 : T0 - 120000; }; // no leg → round start
    const at = from === 'mine' && firstMine ? (LL ? leadMine() : T0 + (firstMine.k - 1) * S - 5000)
      : from === 'mid' ? T0 + span / 2 : from === 'end' ? T0 + span - 15 * 60000 : T0 - 120000;
    const d = zoneParts(at);
    const iso = `${d.y}-${pad(d.mo)}-${pad(d.d)}T${fmtClockIn(at)}`;
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
  el.innerHTML = e.kind?.startsWith('appeal') ? `<span class="k">⚖️</span>${esc(e.name)} · בולדר ${e.b} · ${e.kind === 'appeal' ? 'נפתח ערעור' : 'הערעור הוכרע'}` // 3.12.2
    : `<span class="k">${e.kind === 'top' ? 'T' : 'Z'}</span>${esc(e.name)} · בולדר ${e.b} · ${e.kind === 'top' ? 'טופ' : 'זון'} בניסיון ${e.att}`;
  if (e.kind === 'lead') el.innerHTML = `<span class="k">${e.score === 'TOP' ? 'T' : '↑'}</span>${esc(e.name)} · מסלול ${e.route} · <bdi dir="ltr">${esc(e.score)}</bdi>`; // 3.26.0
  if (e.kind?.startsWith('appeal')) el.classList.add('appeal');
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
    showToast(`הכיול${r ? ' של ' + roundTitle(r.title) : ''} עודכן ממכשיר אחר${store.deviceName(other[0].dev) ? ' (' + store.deviceName(other[0].dev) + ')' : ''}`);
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
// 3.22.0 Task 7: on a live lead round the photos are the topos — b 1 = route A, b 2 = route B
const phLabel = (r, b) => (isLeadLive(r) ? `טופו · מסלול ${b === 2 ? 'B' : 'A'}` : `בולדר ${b}`);
function renderPhotoGrid() {
  const r = round(gridRound); if (!r) return;
  const LL = isLeadLive(r), bs = LL ? leadRoutes(r).map(topoB) : Array.from({ length: r.boulders }, (_, j) => j + 1);
  $('#photos-title').textContent = `${LL ? 'טופו' : 'תמונות בולדרים'} · ${roundTitle(r.title)}`;
  $('#photos-grid').innerHTML = bs.map(b => {
    const v = photoV(r.id, b), u = photoUrl(r.id, b), busy = busyPh.has(r.id + ':' + b), dis = busy ? ' disabled' : '';
    const pic = u && !busy ? `<button type="button" class="ph-pic" data-photo="${b}" aria-label="הגדלת ${phLabel(r, b)}"><img src="${u}" alt="${phLabel(r, b)}"></button>`
      : `<div class="ph-empty">${busy ? 'מעלה…' : v ? 'טוען…' : 'אין תמונה'}</div>`;
    const acts = VIEWER ? '' : v ? `<div class="ph-acts"><button type="button" class="btn btn-secondary btn-sm" data-ph-up="${b}"${dis}>החלף</button><button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-ph-del="${b}"${dis}>מחק</button></div>`
      : `<button type="button" class="btn btn-primary btn-sm" data-ph-up="${b}"${dis}><svg class="bico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>הוסף תמונה</button>`;
    return `<div class="ph-cell"><b>${phLabel(r, b)}</b>${pic}${acts}</div>`;
  }).join('');
}
// 3.24.0: route demo video — YouTube (no-cookie) in a dialog; closing empties the iframe so the sound stops
function openLeadVideo(x) {
  const r = round(current), id = r?.video?.[x];
  if (!id || !/^[\w-]{11}$/.test(id)) return;
  $('#video-title').textContent = `סרטון הדגמה · מסלול ${x} · ${roundTitle(r.title)}`;
  $('#video-frame').src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;
  $('#video-dlg').showModal();
}
function openPhoto(rid, b) {
  const u = photoUrl(rid, b); if (!u) return;
  $('#photo-title').textContent = `${phLabel(round(rid), b)} · ${roundTitle(round(rid).title)}`;
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
  $('#tags-title').textContent = `תיוג בולדרים · ${roundTitle(r.title)}`;
  $('#tags-body').innerHTML = `<div class="tg-list">${Array.from({ length: r.boulders }, (_, j) => {
    const b = j + 1, t = store.tag(r.id, b), u = photoUrl(r.id, b);
    return `<div class="tg-cell${t ? '' : ' empty'}">
      <div class="tg-cell-h">${u ? `<img src="${u}" alt="">` : ''}<b>בולדר ${b}</b>
        <button type="button" class="btn ${t ? 'btn-secondary' : 'btn-primary'} btn-sm" data-tg-open="${b}">${t ? 'עריכה' : 'תייג'}</button></div>
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
    <div class="dlg-actions">${store.tag(r.id, b) ? '<button type="button" class="btn btn-secondary btn-sm btn-danger-text" data-tg-clear="1">מחיקת התיוג</button>' : ''}
      <button type="button" class="btn btn-secondary" data-tg-back="1">ביטול</button><button type="button" class="btn btn-primary" data-tg-save="1">שמירה</button></div>`;
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
  askConfirm('מחיקת תמונה', `התמונה של ${phLabel(round(rid), b)} תימחק מכל המכשירים ומהצופים.`, 'מחיקה', async () => {
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
    <input type="text" class="fb-reply" data-fbreply="${i.id}" value="${esc(i.reply)}" placeholder="תשובה לשולח" maxlength="2000"><button type="button" class="btn btn-sm btn-secondary" data-fbsave="${i.id}">שמור</button></div>`
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
  const st0 = store.settings;
  // opened from the Palgi app: the app's theme (same origin localStorage, entry.js appTheme), not the portal's own
  const at = store.appEntry ? appTheme(k => localStorage.getItem(k)) : null;
  const st = at ? { ...st0, ...at } : st0;
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
const PAGE_TITLES = { main: 'הגדרות', alerts: 'מתי להתריע', push: 'מסך נעול', sound: 'צליל', calib: 'כיול', mine: 'הספורטאים שלי', look: 'מראה', data: 'הערות וערעורים', sync: 'סנכרון בין מכשירים', feedback: 'דיווח תקלה או הצעה לשיפור', fbadmin: 'משובים שהתקבלו', updates: 'עדכונים' };
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
  const al = [['w2', '2 רוטציות'], ['w1', 'רוטציה'], ['m2', '2 דק׳'], ['m1', 'דקה'], ['s10', '10 ש׳'], ['s0', 'בעלייה'], ['transfer', 'נורמן']].filter(([k]) => st.alerts[k]).map(([, l]) => l);
  $('#v-alerts').textContent = al.length ? al.join(' · ') : 'כבוי';
  syncLeadAlertSeg(); // 3.22.0 Task 8
  $('#v-push').textContent = store.push.on && pushEnv() === 'ready' ? 'פעיל' : 'כבוי';
  $('#v-sound').textContent = st.sound.on ? { chime: 'פעמון', beep: 'ביפים', alarm: 'אזעקה' }[st.sound.tone] : 'כבוי';
  $('#v-calib').textContent = `${st.lock ? 'נעול' : 'פתוח'} · ${st.step} ש׳`;
  $('#v-mine').textContent = `${mineOf(mineRoundDefault()).length} בראונד`;
  $('#v-look').textContent = st.theme === 'light' ? 'בהיר' : `${st.theme === 'auto' ? 'לפי המכשיר' : 'כהה'} · ${DARK_NAMES[st.dark] || 'שזיף'}`;
  const n = store.notes().length + store.appeals().length;
  $('#v-data').textContent = n ? String(n) : '';
  $('#v-updates').textContent = APP_VERSION;
  $('#v-sync').textContent = syncLabel(true);
  $('#dark-group').hidden = st.theme === 'light';
}

// 3.22.0 Task 8: the lead alert segmented row on the alerts page (n2 / n3 / m10)
function syncLeadAlertSeg() {
  for (const b of document.querySelectorAll('[data-lead-alert]')) b.setAttribute('aria-pressed', String(b.dataset.leadAlert === store.settings.leadAlert));
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

// settings → "הספורטאים שלי" opens on the nearest round that has a start list (still running or ahead); none ahead →
// the latest one with a list; no list anywhere → the open round (consistency round §10)
function mineRoundDefault() {
  const listed = DATA.rounds.filter(r => !r.ifsc && r.slots.length).sort((a, b) => roundStart(a) - roundStart(b));
  return (listed.find(r => roundEndMs(r) > now()) || listed[listed.length - 1] || round(current))?.id || current;
}
function openSettings() {
  const st = store.settings; const f = $('#settings-form');
  f.querySelectorAll('[data-set]').forEach(el => {
    const [a, b] = el.dataset.set.split('.'); const v = b ? st[a][b] : st[a];
    if (el.type === 'checkbox') el.checked = !!v; else if (el.type === 'radio') el.checked = el.value === String(v); else el.value = String(v);
  });
  $('#dev-name').value = store.devName;
  const mr = mineRoundDefault();
  $('#mine-round').innerHTML = EVENTS().filter(e => roundsOf(e).some(r => !r.ifsc)).map(e => `<optgroup label="${esc(e.title)}">${roundsOf(e).filter(r => !r.ifsc).map(r => `<option value="${r.id}" ${r.id === mr ? 'selected' : ''}>${dayLabel(r.date)} · ${esc(roundTitle(r.title))}</option>`).join('')}</optgroup>`).join('');
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
  DATA.rounds = withCombos(DATA.rounds); // 3.12.0: combined A + B entries for rounds split into groups
  loadIfscEventsCached(); // 3.21.0: the rounds of near World Climbing events, as last seen on this device
  // 3.13.0: saved results of finished international competitions → same path as a World Climbing answer
  for (const [id, d] of Object.entries(DATA.ifscData || {})) { IFSC[id] = { data: null, res: null, at: Date.now(), err: false, busy: false, seen: null }; applyIfsc(id, d); }
  for (const [id, res] of Object.entries(DATA.results || {})) if (res.final == null) res.final = lastRound(id); // a results file without `final`
  VIEWER = DATA.role === 'viewer';
  MINE_H = VIEWER ? MINE_NAME() : $('#mine-h').textContent;
  document.body.classList.toggle('viewer', VIEWER);
  if (VIEWER) { $('[data-view="mine"]').textContent = MINE_NAME(); $('#arm-btn').hidden = true; }
  // stage A: opened from the Palgi app → a link back to the app, no add-to-home-screen guide (the app is the icon);
  // "כללי | שלי" only for an athlete entry with an app id (coach / viewer entries and the code path: as today)
  const entry = store.appEntry;
  ME = entry?.role === 'athlete' && entry.athlete?.id ? entry.athlete : null;
  document.body.classList.toggle('app-entry', !!entry);
  $('#app-back').hidden = !entry;
  if (entry) document.querySelectorAll('[data-install-open]').forEach(el => { el.hidden = true; });
  // consistency round §8: from the app an athlete / viewer has nothing portal-specific to set → no ⚙︎ (row = ⌂ + 🔔);
  // the coach keeps ⚙︎ with the portal rows only (body.app-entry .not-in-app). A typed code keeps everything.
  $('#settings-btn').hidden = !!entry && VIEWER;
  hideSplash();
  $('#app').hidden = false;
  // --top-h = header + button row height (the phone title wraps to 1–2 lines) → the alerts sit under the sticky block
  const topH = () => document.documentElement.style.setProperty('--top-h', Math.round($('.topbar').offsetHeight + $('.tabs').offsetHeight) + 'px');
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(topH); ro.observe($('.topbar')); ro.observe($('.tabs')); }
  topH();
  document.querySelectorAll('.app-ver').forEach(el => { el.textContent = APP_VERSION; });
  current = params.get('round') && round(params.get('round')) ? params.get('round') : pickDefaultRound();
  if (SIM_AT != null) { $('#sim-bar').hidden = false; $('#sim-open').hidden = true; } // already in a replay
  // 3.18.0 (Roei): always opens on home (seasons + "עכשיו"), also during a live round; a link to a round opens it
  screen = params.get('round') ? 'round' : 'home';
  $('#home').hidden = screen !== 'home'; $('#round-screen').hidden = screen !== 'round';
  $('#home-btn').setAttribute('aria-pressed', String(screen === 'home'));
  if (screen === 'round') openRoundView(); // a link to a finished round with results opens on them
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ddOpen) { ddOpen = null; render(); } });
  document.addEventListener('click', e => {
    if (ddOpen && !e.target.closest('.ev-filters')) { ddOpen = null; render(); }
    const rp = $('#round-pick');
    if (e.target === rp) { rp.close(); return; } // tap on the dim area
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (b.id === 'round-pick-btn') { openRoundPick(); return; }
    if (b.id === 'rp-close') { rp.close(); return; }
    if (d.round && rp.open) rp.close(); // falls through to the normal open-round branch
    if (d.page) { setPage(d.page); return; }
    if (d.leadAlert) { if (!VIEWER) { store.setSetting('leadAlert', d.leadAlert); syncLeadAlertSeg(); } return; } // 3.22.0 Task 8 (the push plan follows on the 5 s syncPush tick)
    if (d.final) { const [ev, key, from] = d.final.split(':'); homeFinal = { ev: Number(ev), key, from }; render(); window.scrollTo(0, 0); return; }
    if (b.id === 'final-back') { if (homeFinal.from === 'list') homeOpenEvent = null; else homeOpenEvent = homeFinal.ev; homeFinal = null; render(); return; }
    if (d.season) { ddOpen = null; homeSeason = d.season; render(); window.scrollTo(0, 0); return; }
    if (b.id === 'season-back') { ddOpen = null; homeSeason = null; render(); window.scrollTo(0, 0); return; }
    if (d.dd) { ddOpen = ddOpen === d.dd ? null : d.dd; render(); return; }
    if (d.filt) { // 3.14.0 menu toggle: a row with nothing selected = all on; selecting every option = back to all ([])
      const [k, v] = d.filt.split(':'), opts = filterOptions(homeEvents().filter(x => seasonOf(x) === homeSeason).map(x => x.event))[k];
      const eff = effectiveFilter(evFilter, { [k]: opts })[k], cur = eff.length ? eff : opts, next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
      evFilter = { ...evFilter, [k]: opts.every(x => next.includes(x)) ? [] : next }; saveFilter(); render(); return;
    }
    if (b.id === 'filt-reset') { evFilter = { disc: [], type: [], age: [] }; saveFilter(); render(); return; }
    if (d.homeTab) { homeTab = d.homeTab === 'me' && ME ? 'me' : 'all'; render(); window.scrollTo(0, 0); return; }
    if (d.meOpen) { openMine(d.meOpen); return; }
    if (d.ev != null) { homeFrom = homeSeason; homeOpenEvent = Number(d.ev); render(); window.scrollTo(0, 0); return; }
    if (b.id === 'home-back') { homeSeason = homeFrom; homeOpenEvent = null; render(); return; }
    if (d.open) { lastTabTap = Date.now(); current = d.open; for (const x of ['mine', 'all', 'results']) $('#view-' + x)._html = null; openRoundView(); showScreen('round'); }
    else if (b.id === 'home-btn') { homeOpenEvent = null; homeFinal = null; homeSeason = null; homeFrom = null; showScreen('home'); }
    else if (d.round) { lastTabTap = Date.now(); current = d.round; if (screen !== 'round') { screen = 'round'; $('#home').hidden = true; $('#round-screen').hidden = false; $('#home-btn').setAttribute('aria-pressed', 'false'); } for (const x of ['mine', 'all', 'results']) $('#view-' + x)._html = null; openRoundView(); render(); }
    else if (d.leadManual) leadCtlSet(d.leadManual, (r, x, c) => (c?.manual ? c : toManual(r, x, now())));
    else if (d.leadNext) leadCtlSet(d.leadNext, (r, x, c) => markNext(r, x, c, now()));
    else if (d.leadUndo) leadCtlSet(d.leadUndo, (r, x, c) => undoMark(c));
    else if (d.leadAuto) leadCtlSet(d.leadAuto, () => toAuto());
    else if (d.leadPick || d.leadColor || d.leadSwap != null) leadSetClick(d);
    else if (d.leadNote) openRouteNote(d.leadNote);
    else if (d.leadVideo) openLeadVideo(d.leadVideo);
    else if (d.photo) openPhoto(d.phRound || ($('#photos-dlg').open ? gridRound : current), Number(d.photo));
    else if (b.id === 'photos-btn') openPhotos();
    else if (b.id === 'tags-btn') openTags();
    else if (d.phAdd) { gridRound = d.phRound || current; upTarget = Number(d.phAdd); $('#photo-file').value = ''; $('#photo-file').click(); }
    else if (d.phUp) { upTarget = Number(d.phUp); $('#photo-file').value = ''; $('#photo-file').click(); }
    else if (d.phDel) deletePhoto(gridRound, Number(d.phDel));
    else if (d.adj) adjust(d.adj);
    else if (d.view) setView(d.view);
    else if (d.rescat) { resCat[current] = d.rescat; $('#view-results')._html = null; render(); }
    else if (d.resisr) { resIsr[current] = d.resisr === '1'; render(); }
    else if (d.lock) lockResults(d.lock);
    else if (d.unlock) unlockResults(d.unlock);
    else if (d.sync) syncFromSlot(Number(d.sync));
    else if (d.note) openNote(Number(d.note), d.nr);
    else if (d.appeal) openAppeal(Number(d.appeal), d.nr);
    else if (d.goRound) goRound(d.goRound);
    else if (b.id === 'clock-open') { $('#settings-dlg').close(); openClock(); }
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
    else if (b.id === 'push-test') pushCall('/test', {}).then(r => showToast(r.ok ? (viaApp() ? 'נשלחה התראת ניסיון דרך האפליקציה' : 'נשלחה התראת ניסיון · נעל את האייפד ובדוק') : 'השליחה נכשלה')).catch(() => showToast('אין חיבור לשרת ההתראות'));
    else if (b.id === 'reset-all') askConfirm('איפוס כיול', 'הכיול יתאפס בכל הראונדים ובכל המכשירים, והשעון יחזור לזמנים שבסדר העלייה.', 'איפוס', () => { store.resetOffsets(); render(); showToast('הכיול אופס'); });
    else if (b.id === 'logout-btn') askConfirm('יציאה', 'בכניסה הבאה תצטרך להזין את הקוד שוב. ההערות והכיולים נשארים באייפד.', 'יציאה', () => { store.logout(); location.href = './'; });
    else if (b.id === 'copy-all-btn') copy(logItems().shown.map(i => (i.type === 'appeal' ? appealFull(i) : noteText(i))).join('\n\n')); // what is on screen (3.1.0)
    else if (b.id === 'reset-btn') { store.setOffset(current, 0); if (store.delay(current)) store.setDelay(current, 0); render(); }
    else if (b.id === 'delay-btn') {
      if (store.settings.lock) showToast('הכיול נעול · אפשר לפתוח בהגדרות או ב"נעול"');
      else { const d0 = store.delay(current), d = (d0 + 1) % 3; store.setOffset(current, delayOffset(round(current), now(), off(current), d0, d)); store.setDelay(current, d); render(); showToast(d ? `השהיה ${d}ש׳ בכל מעבר רוטציה` : 'ללא השהיה'); }
    }
    else if (d.mineTg != null) { const k = Number(d.mineTg); store.toggleMine(current, k, mineK(current).has(k), false); $('#view-all')._html = null; $('#view-mine')._html = null; render(); }
    else if (b.id === 'manual-btn') openManual();
    else if (b.id === 'sim-open') { $('#settings-dlg').close(); openSim(); }
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
  $('#photo-dlg').addEventListener('click', () => $('#photo-dlg').close());
  $('#video-x').addEventListener('click', () => $('#video-dlg').close());
  $('#video-dlg').addEventListener('close', () => { $('#video-frame').src = 'about:blank'; }); // tap anywhere closes the big photo
  $('#tags-dlg').addEventListener('click', tagClick);
  // tag popover on the board: tap a tag → show; tap anywhere else / scroll → hide
  document.addEventListener('click', e => { const b = e.target.closest('[data-tg-pop]'); if (b) showTagPop(b); else $('#tag-pop').hidden = true; }, true);
  addEventListener('scroll', () => { $('#tag-pop').hidden = true; }, { passive: true });
  $('#tags-dlg').addEventListener('close', () => { tagEdit = null; });
  $('#dev-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }); // Enter must not close the dialog
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);
  // opened from the app: its theme changed in another tab / the app window (same origin) → follow it
  addEventListener('storage', e => { if (store.appEntry && (e.key == null || String(e.key).startsWith('wa-theme-'))) applySettings(); });
  $('#clock-dlg').addEventListener('close', () => {
    clearInterval(sc.timer); sc.timer = null;
    if (clockBack) { clockBack = false; history.back(); } // came from the app → back there; otherwise stay on home
  });
  applySettings();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (armed) { if (audio && audio.state !== 'running') audio.resume().catch(() => {}); keepAwake(); }
    render();
  });
  render();
  setInterval(render, 250);
  setInterval(() => pollLive(), 5000);
  syncIfscEvents(true); setInterval(() => syncIfscEvents(), 60000); // 3.21.0
  loadLocked(); setInterval(loadLocked, 120000);
  setInterval(() => syncPush(), 5000); syncPush(true);
  addEventListener('online', () => syncPush(true));
  if (SIM_AT == null && VIEWER) viewPull = startViewSync(onRemote);
  else if (SIM_AT == null) startSync({ onRemote, onStatus: renderSyncState });
  if (SIM_AT == null) setupPullRefresh();
  setupSwipe(); setupAutoArm();
  if ('serviceWorker' in navigator && SIM_AT == null) navigator.serviceWorker.register('sw.js').catch(() => {});
  // opened from the Palgi app: a notification tap while this page is the open window → the app's SW posts { type: 'open', url }
  if (store.appEntry && 'serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => {
    const url = store.appEntry ? openTarget(e.data, location.origin) : null;
    if (url) location.href = url;
  });
}

boot().catch(() => { hideSplash(); $('#gate').hidden = false; });
