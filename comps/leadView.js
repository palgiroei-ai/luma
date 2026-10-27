// 3.22.0: lead live board — pure HTML builders for a national lead round with a start list (no DOM; app.js wires clicks).
// One card per route: colour stripe, mode chip, on the wall, pace, next 4 (first 2 = prep area), coach controls.
import { routeState, legStatus, legOrder, leadOverlaps, leadAlertTimes, LEAD_CLIMB_MS } from './lead.js';
import { hm, roundTitle } from './labels.js';
import { esc, genderOf } from './ifsc.js';

// hold colours (Roei) — the only values allowed into style="" (synced data is never trusted as CSS)
export const LEAD_COLORS = [['אדום', '#D32F2F'], ['כתום', '#EF6C00'], ['צהוב', '#F9C80E'], ['ירוק', '#2E9E4F'], ['תכלת', '#29A3D9'],
  ['כחול', '#1E4FB8'], ['סגול', '#7B3FC4'], ['ורוד', '#E0529C'], ['שחור', '#222222'], ['לבן', '#F4F4F4']];
const DEF = { A: '#D32F2F', B: '#1E4FB8' };
export const leadColor = (hex, route) => LEAD_COLORS.find(([, c]) => c === String(hex || '').toUpperCase())?.[1] || DEF[route] || DEF.A;
// 3.23.0: optional second hold colour (Roei) — palette or nothing
export const leadColor2 = hex => LEAD_COLORS.find(([, c]) => c === String(hex || '').toUpperCase())?.[1] || null;
// swatch tap: another colour = second (replaces it), tap 2 again = remove it, tap 1 with two = 2 becomes the only one
export function leadPickColor(c1, c2, c) {
  if (c === c2) return { c1, c2: null };
  if (c === c1) return { c1: c2 || c1, c2: null };
  return { c1, c2: c };
}
const colorName = c => LEAD_COLORS.find(([, x]) => x === c)?.[0] || '';
// both colours of a route; c2 null when unset, off the palette or equal to c1. css = the style="" vars, two = the class
// 3.24.0: nothing picked for the route yet → the round's default `holds` (from the demo video)
export function routeColors(set, route, holds) {
  const h = !set?.picked?.[route] && holds?.[route];
  const c1 = leadColor(h ? h[0] : set?.colors?.[route], route), x = leadColor2(h ? h[1] : set?.colors2?.[route]);
  return { c1, c2: x && x !== c1 ? x : null };
}
function paint(set, route, holds) {
  const { c1, c2 } = routeColors(set, route, holds);
  return { c1, c2, two: c2 ? ' two' : '', css: `--rc:${c1}${c2 ? `;--rc2:${c2}` : ''}` };
}
export const LEAD_ROUTES = ['A', 'B'];
// national lead round with a start list → this board; international lead / before the start lists → the old paths
export const isLeadLive = r => !!(r && r.lead && !r.ifsc && r.slots && r.slots.length > 0);
// 3.22.0 Task 7: topo of route A = photo b 1, B = b 2 (the boulder /photo pipeline; photoId accepts 1–8)
export const topoB = route => (route === 'B' ? 2 : 1);
// newest live route note (notes with k: null + route; store.notes() already drops deleted ones)
export const routeNoteText = (notes, route) => notes.filter(n => n.k == null && n.route === route).sort((a, b) => a.at - b.at).at(-1)?.text ?? null;
export const leadRoutes = r => (r.routes || ['A', 'B']).filter(x => LEAD_ROUTES.includes(x) && legOrder(r, x).length > 0); // no legs → no card

const mss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const chip = (cls, t) => `<span class="chip ${cls}">${t}</span>`;
const OBS_MS = 40000; // 3.22.0 review fix: the wall timer counts the 6:00 climb, from the end of the 0:40 observation
const SCHED_WALL = 'לפי לא-לפני: על הקיר'; // 3.22.0 review fix: auto = the schedule, never "on the wall" as observed (spec anti-goal)

function timesHtml(st) {
  return st.late ? `<s class="net">${hm(st.netMs)}</s> <bdi class="eta" dir="ltr">~${hm(st.estMs)}</bdi>` : `<span>${hm(st.netMs)}</span>`;
}

function routeCard(r, route, ctx) {
  const fem = genderOf(r.id) === 'W', g = (m, f) => (fem ? f : m);
  const ctl = ctx.ctls[route], manual = !!ctl?.manual, pt = paint(ctx.set, route, ctx.holds);
  const s = routeState(r, route, ctx.now, ctl || undefined), step = routeState(r, route, ctx.now).paceMs;
  const n = s.order.length, mine = k => ctx.mineKs.has(k), coach = !ctx.viewer;
  const late = manual && s.behindMs != null && s.behindMs >= 120000;
  const modeChip = !manual ? chip('auto', 'לפי לא-לפני') : s.cur < 0 ? '' : late ? chip('late', `באיחור ${Math.round(s.behindMs / 60000)} דק׳`) : chip('ok', 'בזמן');
  const tools = coach ? `<button type="button" class="btn btn-sm btn-secondary lr-pick" data-lead-pick="${route}" aria-label="צבע מסלול ${route}" aria-expanded="${ctx.pick === route}">🎨</button>` : '';
  const head = `<div class="lr-head"><span class="lr-name"><span class="lr-dot" aria-hidden="true"></span>מסלול ${route}${pt.c2 ? ` <small class="lr-cn">${colorName(pt.c1)}·${colorName(pt.c2)}</small>` : ''}</span><span class="lr-tools">${modeChip}${tools}</span></div>`;
  const sw = coach && ctx.pick === route ? `<div class="lr-swatches" role="group" aria-label="צבע מסלול ${route}">${LEAD_COLORS.map(([nm, c]) => { const i = c === pt.c1 ? 1 : c === pt.c2 ? 2 : 0;
      return `<button type="button" class="lr-sw" style="background:${c}" aria-label="${nm}" title="${nm}" aria-pressed="${i > 0}" data-lead-color="${route}|${c}">${i ? `<span class="k">${i}</span>` : ''}</button>`; }).join('')}<small class="lr-sw-hint">צבע נוסף = צבע שני · לחיצה שוב על 2 מורידה אותו</small></div>` : '';
  // 3.22.0 Task 7: topo = photo b 1/2 — banner (tap = the photo dialog) or the coach's upload spot; a version still loading → nothing
  const url = ctx.topoUrl?.(route), tb = topoB(route), rid = esc(r.id), busy = !!ctx.topoBusy?.(route);
  const topo = url && !busy ? `<button type="button" class="lr-topo" data-photo="${tb}" data-ph-round="${rid}"><img src="${esc(url)}" alt="טופו מסלול ${route}"><span>טופו · הקש להגדלה</span></button>`
    : coach && (busy || !ctx.topoHas?.(route)) ? `<button type="button" class="ph-add lr-topo-add" data-ph-add="${tb}" data-ph-round="${rid}"${busy ? ' disabled' : ''}>${busy ? 'מעלה…' : '📷 העלאת טופו (תמונת המסלול עם הניקוד)'}</button>` : '';
  // 3.24.0: route demo video (YouTube id in the round data) — everyone, opens #video-dlg
  const vid = /^[\w-]{11}$/.test(ctx.video?.[route] || '') ? ctx.video[route] : '';
  const video = vid ? `<button type="button" class="btn btn-sm btn-secondary lr-video" data-lead-video="${esc(route)}">▶ סרטון הדגמה</button>` : '';
  const note = coach && ctx.routeNote?.(route);
  const noteHtml = note ? `<p class="lr-note">📝 ${esc(note)}</p>` : '';
  const noteBtn = coach ? `<button type="button" class="btn btn-sm btn-secondary" data-lead-note="${route}">+ הערה למסלול</button>` : '';
  let wall;
  if (s.phase === 'after') wall = `<div class="lr-wall done"><span class="lw-lbl">המסלול הסתיים</span></div>`;
  else if (s.cur < 0) {
    const k0 = s.order[0];
    wall = `<div class="lr-wall wait"><span class="lw-lbl">${g('עולה ראשון', 'עולה ראשונה')} ${hm(s.estMs(0))}</span>${k0 != null ? `<span class="lw-who${mine(k0) ? ' mine' : ''}">${esc(r.slots[k0].name)}<small>${esc(r.slots[k0].club)}</small></span>` : ''}</div>`;
  } else {
    const k = s.curK, x = r.slots[k];
    wall = `<div class="lr-wall"><span class="lw-lbl">על הקיר · ${s.cur + 1}/${n}</span>
      <span class="lw-who${mine(k) ? ' mine' : ''}">${esc(x.name)}<small>${esc(x.club)}</small></span>
      <span class="lw-t"><span data-since="${s.curStart + OBS_MS}"></span><small> / ${mss(LEAD_CLIMB_MS - OBS_MS)}</small></span>
      <span class="lw-bar"><i data-bar-since="${s.curStart + OBS_MS}"></i></span></div>`;
  }
  const pace = s.phase === 'after' ? '' : `<div class="lr-pace">${manual && s.cur >= 1 ? `<span>קצב בפועל <b>${mss(s.paceMs)}</b> ${g('למטפס', 'למטפסת')}</span>` : ''}<span>לפי הסדר <b>${mss(step)}</b></span></div>`;
  const nextKs = s.phase === 'after' ? [] : s.order.slice(s.cur + 1, s.cur + 5);
  const next = s.phase === 'after' ? '' : `<ol class="lr-next">${nextKs.map(k => {
    const st = legStatus(r, k, route, ctx.now, ctl), x = r.slots[k];
    return `<li class="${mine(k) ? 'mine' : ''}"><span class="pos">${x[route].pos}</span><span class="nm">${esc(x.name)}${st.kind === 'prep' ? ' ' + chip('prep', 'אזור הכנה') : ''}</span><span class="times">${timesHtml(st)}</span></li>`;
  }).join('') || `<li class="muted"><span></span><span class="nm">${g('אחרון במסלול', 'אחרונה במסלול')}</span><span></span></li>`}</ol>`;
  let ctrl = '';
  if (coach && s.phase !== 'after') {
    ctrl = !manual
      ? `<div class="lr-ctrl"><button type="button" class="btn btn-sm btn-secondary" data-lead-manual="${route}">${g('עדיין לא עלה', 'עדיין לא עלתה')}</button></div>`
      : `<div class="lr-ctrl"><button type="button" class="btn btn-primary lr-go" data-lead-next="${route}"${s.cur >= n - 1 ? ' disabled' : ''}>▶ ${g('הבא', 'הבאה')} על הקיר</button>
        <button type="button" class="btn btn-secondary lr-undo" data-lead-undo="${route}" aria-label="ביטול הסימון האחרון"${s.cur < 0 ? ' disabled' : ''}>↶</button>
        <button type="button" class="btn btn-sm btn-secondary" data-lead-auto="${route}">חזרה לסנכרון</button></div>`;
  } else if (coach && manual) ctrl = `<div class="lr-ctrl"><button type="button" class="btn btn-sm btn-secondary" data-lead-undo="${route}" aria-label="ביטול הסימון האחרון">↶</button><button type="button" class="btn btn-sm btn-secondary" data-lead-auto="${route}">חזרה לסנכרון</button></div>`;
  if (noteBtn) ctrl = ctrl ? ctrl.replace(/<\/div>$/, `${noteBtn}</div>`) : `<div class="lr-ctrl">${noteBtn}</div>`;
  return `<article class="lroute card${pt.two}" data-route="${route}" style="${pt.css}">${head}${sw}${topo}${video}${noteHtml}${wall}${pace}${next}${ctrl}</article>`;
}

// ctx = { now, ctls: {A, B}, set: {colors, swap}, mineKs: Set<k>, viewer, pick?: route with the colour picker open,
//   topoUrl(route) → url|null, topoHas(route) (a version exists), topoBusy(route) (uploading), routeNote(route) → text|null }
export function leadBoardHtml(round, ctx) {
  const rs = leadRoutes(round), order = ctx.set?.swap ? rs.slice().reverse() : rs; // first = right in RTL
  const swap = !ctx.viewer && rs.length > 1 ? '<button type="button" class="btn btn-sm btn-secondary lr-swap" data-lead-swap>⇄ החלף צדדים</button>' : '';
  return `<div class="lboard">${swap}<div class="lroutes${rs.length === 1 ? ' one' : ''}">${order.map(x => routeCard(round, x, ctx)).join('')}</div></div>`;
}

// ---- 3.22.0 Task 6: "שלי" per route, the full start list, overlaps ----
// rows / columns always A then B (the board's side swap is about the walls, not reading order)
// ctx (on top of the board's) = { mine: [{k, short, cat, added?}], notes(k), appeals(k), base: Set<k> (Roster = no toggle) }
const gwOf = r => (genderOf(r.id) === 'W' ? (m, f) => f : m => m);
const lateTimes = st => `<s>לא לפני ${hm(st.netMs)}</s><bdi class="eta" dir="ltr">~${hm(st.estMs)}</bdi>`;

function mineLeg(r, k, route, ctx, g) {
  const st = legStatus(r, k, route, ctx.now, ctx.ctls[route]), pt = paint(ctx.set, route, ctx.holds), leg = r.slots[k][route];
  const obs = !!ctx.ctls[route]?.manual; // manual = the coach's taps (observed); auto = the schedule
  let txt, tm;
  if (st.kind === 'none') { txt = `<span class="big">${g('לא עלה', 'לא עלתה')}</span>`; tm = ''; }
  else if (st.kind === 'done') { txt = `<span class="big">${g('סיים', 'סיימה')}</span>${g('עלה', 'עלתה')} ב-${hm(st.estMs)}`; tm = chip('done', '✓'); }
  else if (st.kind === 'wall') {
    txt = `<span class="big${obs ? ' wall">על הקיר עכשיו' : `">${SCHED_WALL}`}</span><span data-since="${st.estMs + OBS_MS}"></span> מתוך ${mss(LEAD_CLIMB_MS - OBS_MS)}`;
    tm = obs ? chip('live', 'LIVE') : chip('auto', hm(st.netMs));
  }
  else {
    txt = `<span class="big">${st.ahead === 1 ? g('הבא בתור', 'הבאה בתור') : `עוד ${st.ahead - 1} ${g('לפניו', 'לפניה')}`}</span>מקום ${leg.pos} במסלול ${route}`;
    tm = st.late ? lateTimes(st) : `לא לפני<span class="ontime">${hm(st.netMs)}</span>`;
  }
  return { st, obs, html: `<div class="lleg ${st.kind}${pt.two}" style="${pt.css}"><span class="rt">${route}</span><span class="st">${txt}</span><span class="tm">${tm}</span></div>` };
}

export function leadMineHtml(round, ctx) {
  const g = gwOf(round), rs = leadRoutes(round);
  return ctx.mine.map(m => {
    const s = round.slots[m.k]; if (!s) return '';
    const legs = rs.map(x => mineLeg(round, m.k, x, ctx, g));
    const onWall = legs.some(l => l.st.kind === 'wall'), hot = onWall || legs.some(l => l.st.kind === 'prep');
    const seen = legs.some(l => l.st.kind === 'wall' && l.obs); // red live style only for a manual (observed) wall
    const hotChip = onWall ? (seen ? chip('live', 'על הקיר') : chip('auto', SCHED_WALL)) : hot ? chip('prep', 'להיכנס לאזור ההכנה') : ''; // fix: never the prep text while she climbs (wall wins)
    const done = legs.every(l => l.st.kind === 'done' || l.st.kind === 'none');
    const notes = ctx.notes?.(m.k) || [], appeals = ctx.appeals?.(m.k) || [];
    const acts = ctx.viewer ? '' : `<div class="ath-actions"><button type="button" class="btn btn-sm btn-secondary" data-note="${m.k}" data-nr="${round.id}">הערה</button>
        <button type="button" class="btn btn-sm btn-appeal" data-appeal="${m.k}" data-nr="${round.id}">ערעור</button></div>`;
    return `<article class="ath card lmine${hot ? ` hot${seen ? ' wall' : ''}` : done ? ' done' : ''}${m.added ? ' added' : ''}" data-k="${m.k}">
      <header><h3>${esc(m.short)}</h3><span class="muted small">${esc(s.name)} · ${esc(s.club || '')}</span>${hotChip}</header>
      ${legs.map(l => l.html).join('')}
      ${!ctx.viewer && notes.length ? `<p class="last-note">📝 ${esc(notes[notes.length - 1].text)}${notes.length > 1 ? ` <span class="muted">(+${notes.length - 1})</span>` : ''}</p>` : ''}
      ${!ctx.viewer && appeals.length ? `<p class="last-note appeal-tag">⚑ ${appeals.length} ערעור${appeals.length > 1 ? 'ים' : ''}</p>` : ''}
      ${acts}</article>`;
  }).join('');
}

// amber line(s): two of mine on different routes expected on the walls within one climb slot (coach only)
export function leadOverlapHtml(round, ctx) {
  if (ctx.viewer || ctx.mine.length < 2) return '';
  const ks = ctx.mine.map(m => m.k), short = k => esc(ctx.mine.find(m => m.k === k)?.short || round.slots[k].name);
  const fem = genderOf(round.id) === 'W', ov = leadOverlaps(round, ks, ctx.now, ctx.ctls);
  const seen = new Set();
  return ov.filter(({ a, b }) => { const key = [a.k, b.k].sort().join('|'); return !seen.has(key) && seen.add(key); }).map(({ a, b }) =>
    `<p class="lovl">${fem ? 'שתיים שלך מטפסות' : 'שניים שלך מטפסים'} בערך באותו זמן: ${short(a.k)} (מסלול ${a.route}, ~${hm(a.at)}) ו${short(b.k)} (מסלול ${b.route}, ~${hm(b.at)})</p>`).join('');
}

// home card line: who is on each wall — auto routes marked as the schedule (3.22.0 review fix), manual as observed
export function leadHomeLine(r, nowMs) {
  const rs = leadRoutes(r), auto = x => !r.leadCtl?.[x]?.manual, all = rs.every(auto);
  const who = rs.map(x => { const s = routeState(r, x, nowMs, r.leadCtl?.[x]);
    return `${x} ${!all && auto(x) ? 'לפי לא-לפני · ' : ''}${s.curK != null && s.phase === 'live' ? esc(r.slots[s.curK].name) : '—'}`; });
  return `<p class="h-live">${all ? 'לפי לא-לפני · ' : ''}על הקיר: ${who.join(' · ')}</p>`;
}

// 3.22.0 Task 9: one line above the board when another live lead round (same event, overlapping) has my athletes — swipe to it
export function leadParHint(round, par, ctx) {
  if (!par || !ctx.mine?.length) return '';
  let best = null;
  for (const m of ctx.mine) for (const x of leadRoutes(par)) {
    const st = legStatus(par, m.k, x, ctx.now, ctx.ctls?.[x]);
    if (st.kind === 'done' || st.kind === 'none' || !Number.isFinite(st.estMs)) continue;
    if (!best || st.estMs < best.at) best = { at: st.estMs, short: m.short || par.slots[m.k]?.name || '', route: x };
  }
  return best ? `במקביל: ${roundTitle(par.title)} · החלק לצד — ${best.short} · ${best.route} ~${hm(best.at)}` : '';
}

// 3.23.0 (Roei): a parallel lead round's athletes under "שלי" — same cards (times, both routes, note / appeal to THAT round), faded
export function leadParMineHtml(par, ctx) {
  if (!par || !ctx.mine?.length) return '';
  const t = `במקביל: ${roundTitle(par.title)}`;
  return `<section class="lpar-mine" aria-label="${esc(t)}"><h4 class="lpar-h">${esc(t)}</h4>${leadMineHtml(par, ctx)}</section>`;
}

// full start list: one row per climber (A order), per route # · לא לפני · משוער · מצב; band on whoever is on a wall
export function leadAllHtml(round, ctx) {
  const g = gwOf(round), rs = leadRoutes(round), mk = ctx.mineKs || new Set(), base = ctx.base || new Set();
  const added = new Set(ctx.mine.filter(m => m.added).map(m => m.k)), short = k => ctx.mine.find(m => m.k === k)?.short;
  const cell = (k, route) => {
    const st = legStatus(round, k, route, ctx.now, ctx.ctls[route]), leg = round.slots[k][route];
    if (st.kind === 'none') return { st, html: `<td class="sep"></td><td></td><td></td><td class="c-st">${g('לא עלה', 'לא עלתה')}</td>` };
    const est = st.kind === 'done' || st.kind === 'wall' ? hm(st.estMs) : st.late ? `<bdi class="eta" dir="ltr">~${hm(st.estMs)}</bdi>` : '';
    const stx = st.kind === 'done' ? `<span class="st-done">${g('סיים', 'סיימה')}</span>` : st.kind === 'wall' ? (ctx.ctls[route]?.manual ? '<span class="st-wall">על הקיר</span>' : `<span class="st-sched">${SCHED_WALL}</span>`)
      : st.kind === 'prep' ? '<span class="st-prep">הכנה</span>' : `עוד ${st.ahead - 1}`;
    return { st, html: `<td class="sep">${leg.pos}</td><td>${st.late && st.kind !== 'done' && st.kind !== 'wall' ? `<s>${hm(st.netMs)}</s>` : hm(st.netMs)}</td><td>${est}</td><td class="c-st">${stx}</td>` };
  };
  const head = `<tr><th></th>${rs.map(x => { const pt = paint(ctx.set, x, ctx.holds); return `<th class="grp sep${pt.two}" colspan="4" style="${pt.css}">מסלול ${x}</th>`; }).join('')}${ctx.viewer ? '' : '<th></th>'}</tr>
    <tr><th>שם</th>${'<th class="sep">#</th><th>לא לפני</th><th>משוער</th><th>מצב</th>'.repeat(rs.length)}${ctx.viewer ? '' : '<th></th>'}</tr>`;
  const rows = round.slots.map((s, k) => {
    if (!s) return '';
    const cs = rs.map(x => cell(k, x)), climb = cs.some(c => c.st.kind === 'wall');
    const tg = ctx.viewer || base.has(k) ? '' : `<button type="button" class="mine-tg" data-mine-tg="${k}" aria-pressed="${mk.has(k)}" aria-label="${mk.has(k) ? 'הסרה מהספורטאים שלי' : 'הוספה לספורטאים שלי'} · ${esc(s.name)}"></button>`;
    const cls = [mk.has(k) && 'mine', added.has(k) && 'added', climb && 'climb now'].filter(Boolean).join(' ');
    return `<tr class="${cls}" data-k="${k}"><td class="c-name"><span class="nm-in">${tg}<span>${esc(s.name)}${mk.has(k) && short(k) ? ` <b>(${esc(short(k))})</b>` : ''}<small>${esc(s.club || '')}</small></span></span></td>${cs.map(c => c.html).join('')}${ctx.viewer ? ''
      : `<td class="row-actions"><button type="button" class="sync-btn btn-appeal" data-appeal="${k}">ערעור</button></td>`}</tr>`;
  }).join('');
  const hint = `<p class="muted small hint">ערעור אפשר על כל מתחרה. ○ ליד שם = הוספה לספורטאים שלי בראונד הזה. מצב «עוד N» = ${g('ממתינים', 'ממתינות')} לפני, בלי מי שעל הקיר.</p>`;
  return `${ctx.viewer ? '' : hint}<div class="lall-wrap"><table class="full lall"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

// 3.22.0 Task 8: lock-screen / banner alerts by climbers ahead — one per mine athlete per route (done / no leg → none).
// Key: manual n2/n3 = the trigger tap (t<index>); else a 2-min bucket of the clock-free alert time (a plan move ≥ 2 min re-arms it).
export const LEAD_ALERT_PREFS = ['n2', 'n3', 'm10'];
const LEAD_ALERT_LBL = { n2: 'עוד 2 לפני', n3: 'עוד 3 לפני', m10: '10 דקות' };
export function leadAlertEntries(r, mine, nowMs, pref, roundTitle = '') {
  if (!isLeadLive(r)) return [];
  const p = LEAD_ALERT_PREFS.includes(pref) ? pref : 'n2', out = [];
  for (const m of mine) for (const route of leadRoutes(r)) {
    const ctl = r.leadCtl?.[route], a = leadAlertTimes(r, m.k, route, nowMs, ctl, p);
    if (!a) continue;
    const text = `${LEAD_ALERT_LBL[p]}: ${m.short} · מסלול ${route} · ~${hm(a.est)}`; // clock-free plan (no drift between taps)
    const key = `${r.id}:${m.k}:${route}:${p}:${a.trig != null ? `t${a.trig}` : Math.round(a.at / 120000)}`; // manual n2/n3 = trigger tap
    out.push({ key, tag: `${r.id}:${m.k}:${route}`, at: a.at, until: a.until,
      text, cls: 'soon', title: `${m.short} · מסלול ${route} · ${LEAD_ALERT_LBL[p]}`, body: roundTitle ? `${text} · ${roundTitle}` : text });
  }
  return out;
}
