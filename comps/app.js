import { decryptJSON } from './decrypt.js';
import { stateAt, athleteStatus, slotStartMs, roundStart, syncWindowNow, syncSlotNow, syncManualStart } from './engine.js';
import { store } from './store.js';

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

// ---- gate ----
async function unlock(code) {
  const res = await fetch('data.enc.json', { cache: 'no-cache' }).catch(() => null)
    || await caches.match('data.enc.json');
  if (!res) return null;
  return decryptJSON(await res.json(), code);
}

async function boot() {
  if (store.code) {
    DATA = await unlock(store.code);
    if (DATA) return start();
  }
  $('#gate').hidden = false;
  $('#gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('#gate-btn').disabled = true;
    const code = $('#code').value.trim();
    DATA = await unlock(code);
    $('#gate-btn').disabled = false;
    if (!DATA) { $('#gate-error').hidden = false; return; }
    store.code = code;
    $('#gate').hidden = true;
    start();
  });
}

// ---- helpers over data ----
const round = id => DATA.rounds.find(r => r.id === id);
const mineOf = id => DATA.mine[id] || [];
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
    return `<button type="button" data-round="${r.id}" aria-pressed="${r.id === current}">
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
  const total = r.slots.length + 2 * r.boulders - 1 + (r.trailingRest ? 1 : 0);
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
        <div><dt>עלייה</dt><dd>${fmtClock(st.startMs)}</dd></div><div><dt>מעבר לנורמן</dt><dd>${s.transfer ? s.transfer.slice(0, -3) : fmtHM(st.startMs - 80 * 60000)}</dd></div></dl>
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
  patch($('#view-all'), `<table class="full"><thead><tr><th>סדר</th><th>גב</th><th>שם</th><th>עלייה</th><th>מצב</th><th></th></tr></thead><tbody>${
    r.slots.map((s, k) => {
      if (!s) return `<tr class="empty-row"><td colspan="3">חלון ריק</td><td>${fmtClock(slotStartMs(r, k, off(r.id)))}</td><td></td><td></td></tr>`;
      const st = athleteStatus(r, k, t, off(r.id));
      return `<tr class="${mk.has(k) ? 'mine' : ''} st-${st.kind}"><td>${s.order}</td><td>${s.bib}</td><td>${esc(s.name)}${mk.has(k) ? ` <b>(${esc(shortOf(r.id, k))})</b>` : ''}</td>
        <td>${fmtClock(st.startMs)}</td><td>${statusText(r, st)}</td>
        <td><button type="button" class="sync-btn" data-sync="${k}">מתחיל עכשיו</button></td></tr>`;
    }).join('')}</tbody></table>`);
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
    if (i.type === 'appeal') return `<article class="log card appeal"><header><b>⚑ ערעור · ${esc(i.short)}</b><span class="muted small">${esc(r?.title)} · ${i.time}</span></header>
      <pre>${esc(appealText(i))}</pre><div class="ath-actions"><button type="button" class="btn btn-sm btn-ghost" data-copy="${i.id}">העתק</button>
      ${navigator.share ? `<button type="button" class="btn btn-sm btn-ghost" data-share="${i.id}">שתף</button>` : ''}
      <button type="button" class="link" data-del-appeal="${i.id}">מחיקה</button></div></article>`;
    return `<article class="log card"><header><b>📝 ${esc(i.short)}</b><span class="muted small">${esc(r?.title)} · ${fmtClock(i.at)} · ${esc(i.ctx)}</span></header>
      <p>${esc(i.text)}</p><button type="button" class="link" data-del-note="${i.id}">מחיקה</button></article>`;
  }).join('') : '<p class="muted">עוד אין הערות או ערעורים.</p>'));
}

function render() {
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
function chime() {
  if (!audio) return;
  const t0 = audio.currentTime;
  [[880, 0], [1175, .18], [880, .36]].forEach(([f, d]) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = f; o.type = 'sine';
    g.gain.setValueAtTime(0, t0 + d); g.gain.linearRampToValueAtTime(.35, t0 + d + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + d + .35);
    o.connect(g).connect(audio.destination); o.start(t0 + d); o.stop(t0 + d + .4);
  });
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

function checkAlerts() {
  const t = now();
  for (const r of DATA.rounds) {
    for (const m of mineOf(r.id)) {
      const startMs = slotStartMs(r, m.k, off(r.id));
      const s = r.slots[m.k];
      for (const [type, lead, cls] of [['slot', r.slotSec * 1000, 'soon'], ['min', 60000, 'now']]) {
        const key = `${r.id}:${m.k}:${type}`;
        const at = startMs - lead;
        if (t >= at && t < at + 90000 && !fired.was(key)) {
          fired.mark(key);
          showAlert(type === 'slot'
            ? `חלון אחד: ${m.short} (#${s.order}, גב ${s.bib}) עולה לבולדר 1 ב-${fmtClock(startMs)}`
            : `דקה: ${m.short} (#${s.order}) עולה ב-${fmtClock(startMs)}`, cls);
        }
      }
    }
  }
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
  const dlg = $('#note-dlg');
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
  $('#appeal-who').textContent = `${shortOf(r.id, k)} · ${s.name} · גב ${s.bib} · ${r.title}`;
  $('#appeal-boulder').innerHTML = Array.from({ length: r.boulders }, (_, i) => `<option ${i + 1 === def ? 'selected' : ''}>${i + 1}</option>`).join('');
  $('#appeal-time').value = fmtClock(now());
  $('#appeal-text').value = '';
  const dlg = $('#appeal-dlg');
  dlg.onclose = () => {
    if (dlg.returnValue !== 'save' || !$('#appeal-text').value.trim()) return;
    store.addAppeal({ round: r.id, k, short: shortOf(r.id, k), name: s.name, bib: s.bib, order: s.order, at: now(),
      boulder: $('#appeal-boulder').value, time: $('#appeal-time').value, text: $('#appeal-text').value.trim() });
    setView('log');
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
  if (kind === '+15') o += 15000; else if (kind === '-15') o -= 15000;
  else if (kind === '+slot') o += S; else if (kind === '-slot') o -= S;
  else if (kind === 'now') {
    const t = now(); const o2 = syncWindowNow(r, t, o); const d = o2 - o;
    return confirmSync('החלון מתחיל עכשיו?', `השעון יזוז ${d >= 0 ? 'אחורה (התחרות מאחרת)' : 'קדימה (התחרות מקדימה)'} בכ-${fmtDur(Math.abs(d))}, כך שחלון חדש מתחיל ברגע הלחיצה על סנכרון.`, () => syncWindowNow(r, now(), off(r.id)));
  }
  store.setOffset(r.id, o);
  render();
}

// Every sync that jumps the clock asks first (Roei: a stray tap must not move the round).
function confirmSync(title, text, newOffset) {
  const r = round(current);
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  const dlg = $('#confirm-dlg');
  // newOffset() is computed at the moment of confirming, not when the dialog opened.
  dlg.onclose = () => { if (dlg.returnValue === 'ok') { store.setOffset(r.id, newOffset()); render(); } };
  dlg.returnValue = '';
  dlg.showModal();
}

function syncFromSlot(k) {
  const r = round(current); const s = r.slots[k]; const o = syncSlotNow(r, k, now());
  confirmSync(`#${s.order} ${s.name} מתחיל עכשיו?`, `כל הסבב יכויל כך ש-#${s.order} עולה עכשיו לבולדר 1 (${o === off(r.id) ? 'ללא שינוי' : `${o > off(r.id) ? 'מאחר' : 'מקדים'} ב-${fmtDur(Math.abs(o - off(r.id)))} לעומת הכיול הנוכחי`}).`, () => syncSlotNow(r, k, now()));
}

function openManual() {
  const r = round(current);
  const cur = roundStart(r) + off(r.id);
  $('#manual-ctx').textContent = `${r.title} · לפי סדר העלייה ${fmtClock(roundStart(r))} · כרגע ${fmtClock(cur)}`;
  $('#manual-time').value = fmtClock(cur);
  const dlg = $('#manual-dlg');
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
  const dlg = $('#sim-dlg');
  dlg.onclose = () => {
    if (dlg.returnValue !== 'go') return;
    const r = round($('#sim-round').value); const S = r.slotSec * 1000; const T0 = roundStart(r);
    const span = (r.slots.length + 2 * r.boulders - 1 + (r.trailingRest ? 1 : 0)) * S;
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

function start() {
  $('#app').hidden = false;
  current = params.get('round') && round(params.get('round')) ? params.get('round') : pickDefaultRound();
  if (SIM_AT != null) { $('#sim-bar').hidden = false; $('#sim-btn').hidden = true; }
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.round) { current = d.round; for (const x of ['mine', 'all']) $('#view-' + x)._html = null; render(); }
    else if (d.adj) adjust(d.adj);
    else if (d.view) setView(d.view);
    else if (d.sync) syncFromSlot(Number(d.sync));
    else if (d.note) openNote(Number(d.note));
    else if (d.appeal) openAppeal(Number(d.appeal));
    else if (d.copy) copy(appealText(store.appeals(a => a.id === d.copy)[0]));
    else if (d.share) navigator.share({ text: appealText(store.appeals(a => a.id === d.share)[0]) }).catch(() => {});
    else if (d.delNote) { store.deleteNote(d.delNote); render(); }
    else if (d.delAppeal) { store.deleteAppeal(d.delAppeal); render(); }
    else if (b.id === 'export-btn') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([store.exportAll()], { type: 'application/json' }));
      a.download = `comp-notes-${new Date(now()).toISOString().slice(0, 10)}.json`; a.click();
    } else if (b.id === 'copy-all-btn') {
      copy([...store.appeals().map(appealText), ...store.notes().map(n => `${n.short} · ${round(n.round)?.title} · ${fmtClock(n.at)} · ${n.ctx}\n${n.text}`)].join('\n\n'));
    } else if (b.id === 'custom-btn') { $('#custom-form').hidden = !$('#custom-form').hidden; }
    else if (b.id === 'reset-btn') { store.setOffset(current, 0); render(); }
    else if (b.id === 'manual-btn') openManual();
    else if (b.id === 'sim-btn') openSim();
    else if (b.id === 'start-btn') {
      try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
      chime(); keepAwake();
      $('#start-bar').hidden = true;
    }
  });
  $('#custom-form').addEventListener('submit', e => {
    e.preventDefault();
    const min = parseFloat($('#custom-min').value);
    if (Number.isFinite(min)) { store.setOffset(current, off(current) + min * 60000); $('#custom-form').hidden = true; $('#custom-min').value = ''; render(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { if (audio) keepAwake(); render(); } });
  render();
  setInterval(render, 250);
  if ('serviceWorker' in navigator && SIM_AT == null) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
