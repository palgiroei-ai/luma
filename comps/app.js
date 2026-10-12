import { decryptJSON } from './decrypt.js';
import { stateAt, athleteStatus, slotStartMs, roundStart, syncWindowNow, syncSlotNow, syncManualStart, windowCount, alertPlan } from './engine.js';
import { store } from './store.js';

export const APP_VERSION = '1.4.0';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- clock (?at=2026-10-13T10:30:00&speed=10 → simulated clock for previews) ----
const params = new URLSearchParams(location.search);
const SIM_AT = params.get('at') ? new Date(params.get('at')).getTime() : null;
const SIM_SPEED = Number(params.get('speed')) || 1;
const T_LOAD = Date.now();
const now = () => (SIM_AT == null ? Date.now() : SIM_AT + (Date.now() - T_LOAD) * SIM_SPEED);
const simFired = new Set();
const fired = { was: k => (SIM_AT == null ? store.wasFired(k) : simFired.has(k)), mark: k => (SIM_AT == null ? store.markFired(k) : simFired.add(k)) };

const pad = n => String(n).padStart(2, '0');
const fmtClock = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtHM = ms => fmtClock(ms).slice(0, 5);
const fmtDur = ms => {
  const t = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};
const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const dayLabel = date => { const d = new Date(date + 'T12:00:00'); return `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

let DATA = null;
let current = null; // round id
let view = 'mine';
let lastTabTap = 0;
let screen = 'round'; // 'home' | 'round'

// ---- gate ----
// → payload, null (wrong code) or 'nodata' (no network and nothing cached / server error).
async function readBox() {
  const tryRes = async res => { try { return res && res.ok ? await res.json() : null; } catch { return null; } };
  return await tryRes(await fetch('data.enc.json', { cache: 'no-cache' }).catch(() => null))
    || await tryRes(await (window.caches ? caches.match('data.enc.json') : null)?.catch?.(() => null));
}
async function unlock(code) {
  const box = await readBox();
  if (!box) return 'nodata';
  return decryptJSON(box, code);
}

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
    case 'waiting': return 'ממתין';
    case 'boulder': return `על בולדר ${st.boulder}`;
    case 'rest': return `מנוחה בין ${st.from} ל-${st.to}`;
    case 'trailing': return `מנוחת סיום (אחרי ${r.boulders})`;
    default: return 'סיים';
  }
}

function pickDefaultRound() {
  const t = now();
  const live = DATA.rounds.find(r => r.slots.length && stateAt(r, t, off(r.id)).phase === 'live');
  if (live) return live.id;
  const upcoming = DATA.rounds.filter(r => roundStart(r) > t).sort((a, b) => roundStart(a) - roundStart(b));
  const withSlots = upcoming.find(r => r.slots.length);
  return (withSlots || upcoming[0] || DATA.rounds[DATA.rounds.length - 1]).id;
}

// ---- render ----
function patch(el, html) { if (el._html !== html) { el.innerHTML = html; el._html = html; } }

function renderTabs() {
  const t = now();
  patch($('#round-tabs'), DATA.rounds.map(r => {
    const live = r.slots.length && stateAt(r, t, off(r.id)).phase === 'live';
    return `<button type="button" data-round="${r.id}" aria-pressed="${screen === 'round' && r.id === current}">
      <span class="tab-day">${dayLabel(r.date)}</span> ${esc(r.title)}${live ? ' <span class="live-dot">חי</span>' : ''}${r.slots.length ? '' : ' <span class="tab-wait">ממתין לסדר עלייה</span>'}</button>`;
  }).join(''));
}

function slotCard(r, s, cls, label) {
  const mk = mineK(r.id);
  if (!s) return `<div class="${cls} empty"><div class="lane-label">${label}</div><div class="who">—</div></div>`;
  const mine = mk.has(s.k);
  return `<div class="${cls}${mine ? ' mine' : ''}"><div class="lane-label">${label}</div>
    <div class="ord">#${s.order}</div><div class="who">${esc(s.name)}</div>
    <div class="bib">גב ${s.bib}${mine ? ` · <b>${esc(shortOf(r.id, s.k))}</b>` : ''}</div></div>`;
}

function renderBoard(r, s) {
  if (!r.slots.length) { patch($('#board'), `<div class="board-msg">סדר העלייה לראונד הזה עוד לא התקבל.</div>`); return; }
  const cells = [];
  for (let j = 0; j < r.boulders; j++) {
    cells.push(slotCard(r, s.boulders[j], 'lane boulder', `בולדר ${j + 1}`));
    if (j < r.boulders - 1) cells.push(slotCard(r, s.rests[j], 'lane rest', `מנוחה <span class="nw">${j + 1}–${j + 2}</span>`));
  }
  if (r.trailingRest) cells.push(slotCard(r, s.trailing, 'lane rest', 'מנוחת סיום'));
  const cols = Array.from({ length: cells.length }, (_, i) => (i % 2 === 0 && !(r.trailingRest && i === cells.length - 1) ? 'minmax(0,1.45fr)' : 'minmax(0,1fr)')).join(' ');
  patch($('#board'), `<div class="lanes" style="grid-template-columns:${cols}">${cells.join('')}</div>`);
}

function renderTimer(r, s) {
  const t = now();
  const label = $('#timer-label'), timer = $('#timer'), sub = $('#timer-sub');
  if (!r.slots.length) { label.textContent = ''; timer.textContent = '--:--'; sub.textContent = `התחלה מתוכננת ${fmtHM(roundStart(r))}`; return; }
  const total = windowCount(r);
  if (s.phase === 'before') {
    const startMs = roundStart(r) + off(r.id);
    label.textContent = 'הראונד מתחיל בעוד';
    timer.textContent = fmtDur(startMs - t);
    sub.textContent = `התחלה ${fmtClock(startMs)}` + (r.preview ? ` · צפייה במסלולים ${r.preview.from}–${r.preview.to}` : '');
    timer.className = 'timer';
  } else if (s.phase === 'after') {
    label.textContent = 'הראונד הסתיים'; timer.textContent = '0:00'; sub.textContent = ''; timer.className = 'timer done';
  } else {
    label.textContent = `חלון ${s.n + 1} מתוך ${total} · נותר`;
    timer.textContent = fmtDur(s.slotLeftMs);
    timer.className = 'timer' + (s.slotLeftMs <= 60000 ? ' warn' : '');
    sub.textContent = `החלון הבא ${fmtClock(s.slotEndMs)}`;
  }
  const o = off(r.id);
  $('#offset-label').textContent = o === 0 ? 'שעון לפי סדר העלייה' : `כיול: ${o > 0 ? 'מאחר' : 'מקדים'} ${fmtDur(Math.abs(o))}`;
}

function renderNext(r, s) {
  const mk = mineK(r.id);
  patch($('#next'), s.next.slice(0, 7).map(x => `<li class="${mk.has(x.k) ? 'mine' : ''}">
      <span class="ord">#${x.order}</span><span class="who">${esc(x.name)}</span>
      <span class="at">${fmtClock(x.startMs)}</span><span class="cd" data-until="${x.startMs}"></span></li>`).join('')
    || '<li class="muted">אין</li>');
}

function renderMine(r) {
  const t = now();
  const list = mineOf(r.id);
  if (!list.length) { patch($('#view-mine'), `<p class="muted">${r.slots.length ? 'אין ספורטאים שלי בראונד הזה.' : 'סדר העלייה עוד לא התקבל.'}</p>`); return; }
  patch($('#view-mine'), list.map(m => {
    const s = r.slots[m.k];
    const st = athleteStatus(r, m.k, t, off(r.id));
    const notes = store.notes(n => n.round === r.id && n.k === m.k);
    const appeals = store.appeals(a => a.round === r.id && a.k === m.k);
    const big = st.kind === 'waiting' ? `עולה בעוד <span data-until="${st.startMs}"></span>` : statusText(r, st);
    return `<article class="ath card ${st.kind}">
      <header><h3>${esc(m.short)}</h3><span class="muted small">${esc(s.name)} · ${esc(m.cat)}</span></header>
      <div class="ath-status">${big}</div>
      <dl class="ath-meta"><div><dt>סדר</dt><dd>#${s.order}</dd></div><div><dt>גב</dt><dd>${s.bib}</dd></div>
        <div><dt>עלייה</dt><dd>${fmtClock(st.startMs)}</dd></div><div><dt>מעבר לנורמן</dt><dd>${fmtHM(s.transfer ? new Date(`${r.date}T${s.transfer.padStart(8, '0')}`).getTime() + off(r.id) : st.startMs - 80 * 60000)}</dd></div></dl>
      ${notes.length ? `<p class="last-note">📝 ${esc(notes[notes.length - 1].text)}${notes.length > 1 ? ` <span class="muted">(+${notes.length - 1})</span>` : ''}</p>` : ''}
      ${appeals.length ? `<p class="last-note appeal-tag">⚑ ${appeals.length} ערעור${appeals.length > 1 ? 'ים' : ''}</p>` : ''}
      <div class="ath-actions"><button type="button" class="btn btn-sm btn-ghost" data-note="${m.k}">הערה</button>
        <button type="button" class="btn btn-sm btn-appeal" data-appeal="${m.k}">ערעור</button></div>
    </article>`;
  }).join(''));
}

function renderAll(r) {
  const t = now(); const mk = mineK(r.id);
  if (!r.slots.length) { patch($('#view-all'), '<p class="muted">סדר העלייה עוד לא התקבל.</p>'); return; }
  patch($('#view-all'), `<p class="muted small hint">סנכרון לפי מי שמטפס: לחץ "מתחיל עכשיו" ליד המתחרה שעולה עכשיו לבולדר 1. ערעור אפשר על כל מתחרה.</p><div class="full-wrap"><table class="full"><thead><tr><th>סדר</th><th class="c-bib">גב</th><th>שם</th><th>עלייה</th><th>מצב</th><th></th></tr></thead><tbody>${
    r.slots.map((s, k) => {
      if (!s) return `<tr class="empty-row"><td colspan="3">חלון ריק</td><td>${fmtClock(slotStartMs(r, k, off(r.id)))}</td><td></td><td></td></tr>`;
      const st = athleteStatus(r, k, t, off(r.id));
      return `<tr class="${mk.has(k) ? 'mine' : ''} st-${st.kind}"><td>${s.order}</td><td class="c-bib">${s.bib}</td><td>${esc(s.name)}${mk.has(k) ? ` <b>(${esc(shortOf(r.id, k))})</b>` : ''}</td>
        <td>${fmtClock(st.startMs)}</td><td>${statusText(r, st)}</td>
        <td class="row-actions"><button type="button" class="sync-btn" data-sync="${k}">מתחיל עכשיו</button>
          <button type="button" class="sync-btn appeal-btn" data-appeal="${k}">ערעור</button></td></tr>`;
    }).join('')}</tbody></table></div>`);
}

function appealText(a) {
  const r = round(a.round);
  return [`ערעור — ${DATA.event.title} · ${r.title} (${dayLabel(r.date)})`, `ספורטאי: ${a.name} · מס' גב ${a.bib} · סדר עלייה ${a.order}`,
    `בולדר: ${a.boulder}`, `שעה: ${a.time}`, `תיאור: ${a.text}`].join('\n');
}

function renderLog() {
  const notes = store.notes().map(n => ({ ...n, type: 'note' }));
  const appeals = store.appeals().map(a => ({ ...a, type: 'appeal' }));
  const items = [...notes, ...appeals].sort((a, b) => b.at - a.at);
  patch($('#view-log'), `<div class="log-actions"><button type="button" class="btn btn-sm btn-ghost" id="export-btn">ייצוא קובץ</button>
    <button type="button" class="btn btn-sm btn-ghost" id="copy-all-btn">העתק הכל</button></div>` + (items.length ? items.map(i => {
    const r = round(i.round);
    if (i.type === 'appeal') return `<article class="log card appeal"><header><b>⚑ ערעור · ${esc(i.short)}</b><span class="muted small">${esc(r?.title)} · ${esc(i.time)}</span></header>
      <pre>${esc(appealText(i))}</pre><div class="ath-actions"><button type="button" class="btn btn-sm btn-ghost" data-copy="${i.id}">העתק</button>
      ${navigator.share ? `<button type="button" class="btn btn-sm btn-ghost" data-share="${i.id}">שתף</button>` : ''}
      <button type="button" class="link" data-del-appeal="${i.id}">מחיקה</button></div></article>`;
    return `<article class="log card"><header><b>📝 ${esc(i.short)}</b><span class="muted small">${esc(r?.title)} · ${fmtClock(i.at)} · ${esc(i.ctx)}</span></header>
      <p>${esc(i.text)}</p><button type="button" class="link" data-del-note="${i.id}">מחיקה</button></article>`;
  }).join('') : '<p class="muted">עוד אין הערות או ערעורים.</p>'));
}

// ---- home: all rounds by event / day, tap to open ----
function roundEndMs(r) { return roundStart(r) + off(r.id) + windowCount(r) * r.slotSec * 1000; }

function renderHome() {
  const t = now();
  const days = [...new Set(DATA.rounds.map(r => r.date))];
  const card = r => {
    const ph = r.slots.length ? stateAt(r, t, off(r.id)).phase : 'wait';
    const badge = { live: '<span class="hb live">חי עכשיו</span>', before: '<span class="hb soon">בקרוב</span>', after: '<span class="hb done">הסתיים</span>', wait: '<span class="hb wait">ממתין לסדר עלייה</span>' }[ph];
    const mine = mineOf(r.id).map(m => `<li><b>${esc(m.short)}</b> <span>#${r.slots[m.k].order} · ${fmtHM(slotStartMs(r, m.k, off(r.id)))}</span></li>`).join('');
    const live = ph === 'live' ? (() => { const s = stateAt(r, t, off(r.id)); const b1 = s.boulders[0]; return `<p class="h-live">חלון ${s.n + 1} מתוך ${windowCount(r)} · בולדר 1: ${b1 ? `#${b1.order} ${esc(b1.name)}` : '—'}</p>`; })() : '';
    return `<button type="button" class="h-card card ph-${ph}" data-open="${r.id}">
      <div class="h-top"><h3>${esc(r.title)}</h3>${badge}</div>
      <p class="muted small">${fmtHM(roundStart(r) + off(r.id))}${r.slots.length ? `–${fmtHM(roundEndMs(r))}` : ''} · ${r.boulders} בולדרים · חלון ${fmtDur(r.slotSec * 1000)}${r.slots.length ? ` · ${r.slots.filter(Boolean).length} מתחרים` : ''}</p>
      ${live}${mine ? `<ul class="h-mine">${mine}</ul>` : `<p class="muted small">${r.slots.length ? 'אין ספורטאים שלי' : ''}</p>`}
    </button>`;
  };
  patch($('#home'), `<h2 class="h-event">${esc(DATA.event.title)} <span class="muted">· ${esc(DATA.event.place || '')}</span></h2>` +
    days.map(d => `<section class="h-day"><h3 class="h-day-title">${dayLabel(d)}</h3><div class="h-grid">${DATA.rounds.filter(r => r.date === d).map(card).join('')}</div></section>`).join(''));
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
  if (screen === 'home') {
    $('#clock').textContent = fmtClock(now());
    $('#event-title').textContent = DATA.event.title;
    $('#round-sub').textContent = `מסך ראשי${SIM_AT != null ? ' · מצב הדמיה' : ''}`;
    renderTabs(); renderHome(); checkAlerts();
    return;
  }
  if (Date.now() - lastTabTap > 5 * 60000 && stateAt(round(current), now(), off(current)).phase === 'after') {
    const next = pickDefaultRound();
    if (next !== current) { current = next; for (const x of ['mine', 'all']) $('#view-' + x)._html = null; }
  }
  const r = round(current);
  const s = stateAt(r, now(), off(r.id));
  $('#clock').textContent = fmtClock(now());
  $('#event-title').textContent = DATA.event.title;
  $('#round-sub').textContent = `${dayLabel(r.date)} · ${r.title} · ${r.boulders} בולדרים · חלון ${fmtDur(r.slotSec * 1000)}${SIM_AT != null ? ' · מצב הדמיה' : ''}`;
  renderTabs(); renderBoard(r, s); renderTimer(r, s); renderNext(r, s);
  if (view === 'mine') renderMine(r);
  if (view === 'all') renderAll(r);
  if (view === 'log') renderLog();
  const t = now();
  document.querySelectorAll('[data-until]').forEach(el => { el.textContent = fmtDur(Number(el.dataset.until) - t); });
  checkAlerts();
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
  if (!audio || (!snd.on && !force)) return;
  if (audio.state !== 'running') audio.resume().catch(() => {});
  const t0 = audio.currentTime; const tone = TONES[snd.tone] || TONES.chime; const peak = 0.6 * snd.vol;
  tone.notes.forEach(([f, d, len]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; o.type = tone.type;
    g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(peak, t0 + d + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + d + len);
    o.connect(g).connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + len + .05);
  });
}
function ensureAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari 16.4+ only */ }
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
}

function showAlert(text, cls) {
  const el = document.createElement('div');
  el.className = 'alert ' + cls;
  el.innerHTML = `<span>${esc(text)}</span><button type="button" aria-label="סגירה">✕</button>`;
  el.querySelector('button').onclick = () => el.remove();
  $('#alerts').prepend(el);
  setTimeout(() => el.remove(), 4 * 60000);
  chime();
}

// Every alert for my athletes in all rounds (same list drives the in-app banner and the lock-screen push).
const ALERT_LBL = { w2: '2 חלונות', w1: 'חלון אחד', m2: '2 דקות', m1: 'דקה', s10: '10 שניות' };
function alertEntries() {
  const out = [];
  for (const r of DATA.rounds) {
    for (const m of mineOf(r.id)) {
      const startMs = slotStartMs(r, m.k, off(r.id));
      const s = r.slots[m.k];
      const transferMs = s.transfer ? new Date(`${r.date}T${s.transfer.padStart(8, '0')}`).getTime() : null;
      // Each alert stays due until the next chosen one (late alerts still useful: app was backgrounded /
      // clock recalibrated); a recalibration by ≥ half a window re-arms it at the new time.
      for (const a of alertPlan(r, m.k, off(r.id), store.settings.alerts, transferMs)) {
        const key = `${r.id}:${m.k}:${a.type}:${Math.round(off(r.id) / (r.slotSec * 1000))}`;
        const text = a.type === 'transfer'
          ? `מעבר לנורמן: ${m.short} (#${s.order}) · עולה ב-${fmtClock(startMs)}`
          : a.type === 's0' ? `עולה עכשיו: ${m.short} (#${s.order}, גב ${s.bib}) לבולדר 1 · ${fmtClock(startMs)}`
          : `${ALERT_LBL[a.type]}: ${m.short} (#${s.order}, גב ${s.bib}) עולה לבולדר 1 ב-${fmtClock(startMs)}`;
        out.push({ key, at: a.at, until: a.until, text, cls: ['m1', 'm2', 's10', 's0'].includes(a.type) ? 'now' : 'soon',
          title: a.type === 'transfer' ? `${m.short} · מעבר לנורמן` : a.type === 's0' ? `${m.short} · עולה עכשיו` : `${m.short} · עוד ${ALERT_LBL[a.type]}`,
          body: `${text} · ${r.title}` });
      }
    }
  }
  return out;
}

function checkAlerts() {
  const t = now();
  for (const a of alertEntries()) {
    if (t >= a.at && t < a.until && !fired.was(a.key)) { fired.mark(a.key); showAlert(a.text, a.cls); }
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
  if (!store.push.on || pushEnv() !== 'ready' || Notification.permission !== 'granted') return;
  const t = Date.now();
  if (!force && t < pushNextTry) return;
  const alerts = alertEntries().filter(a => a.until > t).map(({ key, at, until, title, body }) => ({ key, at, until, title, body }));
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
    showToast(e.message === 'perm' ? 'לא אושרו התראות. אפשר לאשר בהגדרות האייפד → התראות → מעקב ראונד' : 'אין חיבור לשרת ההתראות. נסה שוב.');
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
    'ios-install': 'עובד רק מהאייקון במסך הבית: בספארי לחץ שתף ← "הוסף למסך הבית", ופתח משם.',
    unsupported: 'המכשיר לא תומך בהתראות (צריך iPadOS 16.4 ומעלה).',
    denied: 'ההתראות חסומות: הגדרות האייפד ← התראות ← מעקב ראונד ← אפשר.',
  }[env];
  if (msg) { box.textContent = msg; return; }
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

// ---- dialogs ----
function currentCtx(r, k) {
  return statusText(r, athleteStatus(r, k, now(), off(r.id)));
}

function openNote(k) {
  const r = round(current); const s = r.slots[k];
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

function openAppeal(k) {
  const r = round(current); const s = r.slots[k];
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
  view = v;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  for (const x of ['mine', 'all', 'log']) { const el = $('#view-' + x); el.hidden = x !== v; el._html = null; }
  render();
}

function adjust(kind) {
  const r = round(current); const S = r.slotSec * 1000; let o = off(r.id);
  if (store.settings.lock) { showToast('הכיול נעול · אפשר לפתוח בהגדרות או ב"פתח נעילה"'); return; }
  const step = store.settings.step * 1000;
  if (kind === '+step') o += step; else if (kind === '-step') o -= step;
  else if (kind === '+slot') o += S; else if (kind === '-slot') o -= S;
  else if (kind === 'now') {
    const t = now(); const o2 = syncWindowNow(r, t, o); const d = o2 - o;
    const b1 = stateAt(r, t, o2).boulders[0];
    return confirmSync('החלון מתחיל עכשיו?', `השעון יזוז ${d >= 0 ? 'אחורה (התחרות מאחרת)' : 'קדימה (התחרות מקדימה)'} בכ-${fmtDur(Math.abs(d))}. אחרי הסנכרון על בולדר 1: ${b1 ? `#${b1.order} ${b1.name}` : 'אף אחד (חלון ריק)'}. אם זה לא מי שעולה עכשיו — לחץ ביטול והשתמש ב"מתחיל עכשיו" ליד המתחרה בסדר העלייה המלא.`, () => syncWindowNow(r, now(), off(r.id)));
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
  confirmSync(`#${s.order} ${s.name} מתחיל עכשיו?`, `כל הסבב יכויל כך ש-#${s.order} עולה עכשיו לבולדר 1 (${o === off(r.id) ? 'ללא שינוי' : `${o > off(r.id) ? 'מאחר' : 'מקדים'} ב-${fmtDur(Math.abs(o - off(r.id)))} לעומת הכיול הנוכחי`}).`, () => syncSlotNow(r, k, now()));
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
    const d = new Date(roundStart(r)); d.setHours(+h, +m, +sec, 0);
    store.setOffset(r.id, syncManualStart(r, d.getTime()));
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
    const d = new Date(at);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${fmtClock(at)}`;
    location.href = `./?at=${iso}&speed=${$('#sim-speed').value}&round=${r.id}`;
  };
  dlg.showModal();
}

async function copy(text) { try { await navigator.clipboard.writeText(text); showToast('הועתק'); } catch { showToast('ההעתקה נכשלה'); } }
function showToast(text) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
  document.body.append(el); setTimeout(() => el.remove(), 1800);
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
  $('#adj-minus').textContent = `מקדים ${st.step}ש׳`;
  $('#adj-plus').textContent = `מאחר ${st.step}ש׳`;
  document.querySelectorAll('.cbtn').forEach(b => { b.disabled = st.lock; });
  $('#lock-btn').textContent = st.lock ? '🔒 כיול נעול · פתח' : 'נעל כיול';
  document.body.classList.toggle('calib-locked', st.lock);
}

// ---- settings screen (iPhone style, like Wingate): a main list of rows → one page per topic ----
const PAGE_TITLES = { main: 'הגדרות', alerts: 'מתי להתריע', push: 'מסך נעול', sound: 'צליל', calib: 'כיול', mine: 'הספורטאים שלי', look: 'מראה', data: 'הערות וערעורים', updates: 'עדכונים' };
function setPage(pg) {
  document.querySelectorAll('#settings-dlg .ios-page').forEach(el => { el.hidden = el.dataset.pg !== pg; });
  $('#set-title').textContent = PAGE_TITLES[pg] || 'הגדרות';
  $('#set-back').hidden = pg === 'main';
  if (pg === 'main') renderSettingsMain();
  if (pg === 'push') renderPushState();
  $('#settings-form').scrollTop = 0; $('#settings-dlg').scrollTop = 0;
}
function renderSettingsMain() {
  const st = store.settings;
  const al = [['w2', '2 חלונות'], ['w1', 'חלון'], ['m2', '2 דק׳'], ['m1', 'דקה'], ['s10', '10 ש׳'], ['s0', 'בעלייה'], ['transfer', 'נורמן']].filter(([k]) => st.alerts[k]).map(([, l]) => l);
  $('#v-alerts').textContent = al.length ? al.join(' · ') : 'כבוי';
  $('#v-push').textContent = store.push.on && pushEnv() === 'ready' ? 'פעיל' : 'כבוי';
  $('#v-sound').textContent = st.sound.on ? { chime: 'פעמון', beep: 'ביפים', alarm: 'אזעקה' }[st.sound.tone] : 'כבוי';
  $('#v-calib').textContent = `${st.lock ? 'נעול' : 'פתוח'} · ${st.step} ש׳`;
  $('#v-mine').textContent = `${mineOf(current).length} בראונד`;
  $('#v-look').textContent = st.theme === 'light' ? 'בהיר' : `${st.theme === 'auto' ? 'לפי המכשיר' : 'כהה'} · ${DARK_NAMES[st.dark] || 'שזיף'}`;
  const n = store.notes().length + store.appeals().length;
  $('#v-data').textContent = n ? String(n) : '';
  $('#v-updates').textContent = APP_VERSION;
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
  $('#mine-round').innerHTML = DATA.rounds.map(r => `<option value="${r.id}" ${r.id === current ? 'selected' : ''}>${dayLabel(r.date)} · ${esc(r.title)}</option>`).join('');
  renderMineList();
  $('#version-info').textContent = `גרסת אפליקציה ${APP_VERSION} · סדרי עלייה עודכנו ${new Date(DATA.builtAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`;
  $('#update-msg').textContent = '';
  setPage('main');
  $('#settings-dlg').showModal();
}

async function checkUpdate() {
  $('#update-msg').textContent = 'בודק…';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const res = await fetch('data.enc.json', { cache: 'no-store' });
    const fresh = res.ok ? await decryptJSON(await res.json(), store.code) : null;
    const codeRes = await fetch('app.js', { cache: 'no-store' });
    const newVer = codeRes.ok ? ((await codeRes.text()).match(/APP_VERSION = '([^']+)'/) || [])[1] : null;
    if (!fresh) { $('#update-msg').textContent = 'אין חיבור כרגע. נסה שוב.'; return; }
    if (fresh.builtAt !== DATA.builtAt || (newVer && newVer !== APP_VERSION)) {
      $('#update-msg').textContent = 'נמצא עדכון · טוען מחדש…';
      setTimeout(() => location.reload(), 800);
    } else $('#update-msg').textContent = 'הכל מעודכן ✓';
  } catch { $('#update-msg').textContent = 'אין חיבור כרגע. נסה שוב.'; }
}

function exportFile() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([store.exportAll()], { type: 'application/json' }));
  a.download = `comp-notes-${new Date(now()).toISOString().slice(0, 10)}.json`; a.click();
}

function start() {
  $('#app').hidden = false;
  document.querySelectorAll('.app-ver').forEach(el => { el.textContent = APP_VERSION; });
  current = params.get('round') && round(params.get('round')) ? params.get('round') : pickDefaultRound();
  if (SIM_AT != null) { $('#sim-bar').hidden = false; $('#sim-btn').hidden = true; }
  const liveNow = DATA.rounds.some(r => r.slots.length && stateAt(r, now(), off(r.id)).phase === 'live');
  screen = params.get('round') || liveNow ? 'round' : 'home';
  $('#home').hidden = screen !== 'home'; $('#round-screen').hidden = screen !== 'round';
  $('#home-btn').setAttribute('aria-pressed', String(screen === 'home'));
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.page) { setPage(d.page); return; }
    if (d.open) { lastTabTap = Date.now(); current = d.open; for (const x of ['mine', 'all']) $('#view-' + x)._html = null; showScreen('round'); }
    else if (b.id === 'home-btn') showScreen('home');
    else if (d.round) { lastTabTap = Date.now(); current = d.round; if (screen !== 'round') { screen = 'round'; $('#home').hidden = true; $('#round-screen').hidden = false; $('#home-btn').setAttribute('aria-pressed', 'false'); } for (const x of ['mine', 'all']) $('#view-' + x)._html = null; render(); }
    else if (d.adj) adjust(d.adj);
    else if (d.view) setView(d.view);
    else if (d.sync) syncFromSlot(Number(d.sync));
    else if (d.note) openNote(Number(d.note));
    else if (d.appeal) openAppeal(Number(d.appeal));
    else if (d.copy) copy(appealText(store.appeals(a => a.id === d.copy)[0]));
    else if (d.share) navigator.share({ text: appealText(store.appeals(a => a.id === d.share)[0]) }).catch(() => {});
    else if (d.delNote) { store.deleteNote(d.delNote); render(); }
    else if (d.delAppeal) { store.deleteAppeal(d.delAppeal); render(); }
    else if (b.id === 'export-btn' || b.id === 'export-btn2') exportFile();
    else if (b.id === 'settings-btn') openSettings();
    else if (b.id === 'test-sound') { ensureAudio(); chime(true); }
    else if (b.id === 'lock-btn') { store.setSetting('lock', !store.settings.lock); applySettings(); }
    else if (b.id === 'check-update') checkUpdate();
    else if (b.id === 'push-toggle') { if (store.push.on && pushEnv() === 'ready') pushDisable(); else pushEnable(); }
    else if (b.id === 'push-test') pushCall('/test', {}).then(r => showToast(r.ok ? 'נשלחה התראת ניסיון · נעל את האייפד ובדוק' : 'השליחה נכשלה')).catch(() => showToast('אין חיבור לשרת ההתראות'));
    else if (b.id === 'reset-all') askConfirm('איפוס כיול', 'הכיול יתאפס בכל הראונדים, והשעון יחזור לזמנים שבסדר העלייה.', 'איפוס', () => { store.resetOffsets(); render(); showToast('הכיול אופס'); });
    else if (b.id === 'clear-notes') askConfirm('מחיקת הערות וערעורים', 'כל ההערות והערעורים יימחקו מהאייפד. כדאי לייצא קודם.', 'מחיקה', () => { store.clearNotesAppeals(); render(); showToast('נמחק'); });
    else if (b.id === 'logout-btn') askConfirm('יציאה', 'בכניסה הבאה תצטרך להזין את הקוד שוב. ההערות והכיולים נשארים באייפד.', 'יציאה', () => { store.logout(); location.href = './'; }); else if (b.id === 'copy-all-btn') {
      copy([...store.appeals().map(appealText), ...store.notes().map(n => `${n.short} · ${round(n.round)?.title} · ${fmtClock(n.at)} · ${n.ctx}\n${n.text}`)].join('\n\n'));
    } else if (b.id === 'custom-btn') { $('#custom-form').hidden = !$('#custom-form').hidden; }
    else if (b.id === 'reset-btn') { store.setOffset(current, 0); render(); }
    else if (b.id === 'manual-btn') openManual();
    else if (b.id === 'sim-btn') openSim();
    else if (b.id === 'start-btn') {
      ensureAudio();
      chime(); keepAwake();
      $('#start-bar').hidden = true;
    }
  });
  $('#settings-form').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.mineK != null) {
      store.toggleMine($('#mine-round').value, Number(el.dataset.mineK), !el.checked, !!el.dataset.base);
      renderMineList(); for (const x of ['mine', 'all']) $('#view-' + x)._html = null; render(); return;
    }
    if (el.id === 'mine-round') { renderMineList(); return; }
    if (!el.dataset.set) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.dataset.num != null ? Number(el.value) : el.value;
    if (el.type === 'radio' && !el.checked) return;
    store.setSetting(el.dataset.set, v);
    applySettings(); renderSettingsMain(); render();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applySettings);
  applySettings();
  $('#custom-form').addEventListener('submit', e => {
    e.preventDefault();
    const min = parseFloat($('#custom-min').value);
    if (Number.isFinite(min)) { store.setOffset(current, off(current) + min * 60000); $('#custom-form').hidden = true; $('#custom-min').value = ''; render(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (audio) { if (audio.state !== 'running') audio.resume().catch(() => {}); keepAwake(); }
    render();
  });
  render();
  setInterval(render, 250);
  setInterval(() => syncPush(), 5000); syncPush(true);
  addEventListener('online', () => syncPush(true));
  if ('serviceWorker' in navigator && SIM_AT == null) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch(() => { $('#gate').hidden = false; });
