// 3.33.0 athlete card: the bottom-sheet card's HTML (pure; tests/athlete-card.test.mjs). No DOM, no state — app.js (Task 7)
// owns the sheet, the taps and the World Climbing fetch. Sections (approved mock): header · badges · discipline tabs
// בולדר / הובלה (no speed) · "בתחרות הזו" · season summary (+ overall / category toggle) · trend · World Climbing
// (podiums + World Cup rank per season) · results newest first · link · coach notes. Every interpolated value → esc.
// Data attributes for app.js: data-ath-disc="B|L", data-ath-cat="0|1", data-ath-round="<round id>", data-ath-ev="<WC event
// id>", data-ath-notes. Wording rules (tests/wording.test.mjs): Palgi athlete badge = "ספורטאי הפלגיה" for viewers, "שלי" for
// the coach — the same words as app.js MINE_NAME.
import { esc, ISR } from './ifsc.js';
import { catHe, roundTitle } from './labels.js';
import { DISC } from './seasons.js';
import { seasonSummary } from './athlete.js';

const sorted = (list, key) => [...list].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0)); // newest first
const num = v => typeof v === 'number' && Number.isFinite(v);
const mmyy = d => (/^(\d{2})(\d{2})-(\d{2})/.exec(String(d || '')) ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : '');
// cache time (ms) → "09/11" (device time), else ''
const ddmm = ms => { const d = num(ms) ? new Date(ms) : null; return d && !isNaN(d) ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : ''; };
const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('');
// a category code with its own place (U19 in a seniors round, U15 in U17) — open seniors 'S' has none
const ownCat = c => (!c.intl && c.catKey && c.catKey !== 'S' && num(c.catPlace) ? c.catKey : null);
// national row text: "מקום 7 כללי · 2 ב-U19", or the overall place alone
const placeText = c => { const k = ownCat(c), o = c.overall ?? c.place;
  return num(o) ? (k ? `מקום ${o} כללי · ${c.catPlace} ב-${k}` : `מקום ${o}`) : ''; };
// World Climbing result category 'w19' / 'm' → Hebrew label
const wcCat = cat => { const m = /^([mw])(\d*)$/.exec(String(cat || '')); return m ? catHe(m[2] ? 'U' + m[2] : 'S', m[1] === 'w' ? 'W' : 'M') : ''; };
const POD_ROWS = [['wc', 'גביע עולם'], ['wch', 'אליפות עולם'], ['cont', 'אליפות יבשתית']];

function trendSvg(points) {
  if (points.length < 2) return '';
  const ps = points.map(p => p.place), lo = Math.min(...ps), hi = Math.max(...ps), W = 340, n = points.length;
  const xy = points.map((p, i) => [Math.round(24 + (i * (W - 48)) / (n - 1)), hi === lo ? 30 : Math.round(12 + ((p.place - lo) / (hi - lo)) * 36)]);
  const label = points.map(p => `${p.title}: מקום ${p.place}`).join(', ');
  return `<svg class="ac-trend" viewBox="0 0 ${W} 74" role="img" aria-label="${esc(label)}">`
    + `<line class="ac-grid" x1="16" y1="12" x2="${W - 16}" y2="12"/><line class="ac-grid" x1="16" y1="48" x2="${W - 16}" y2="48"/>`
    + `<polyline class="ac-line" points="${xy.map(p => p.join(',')).join(' ')}"/>`
    + xy.map(([x, y], i) => `<circle class="ac-pt${i === n - 1 ? ' last' : ''}" cx="${x}" cy="${y}" r="4"><title>${esc(points[i].title)} · מקום ${esc(points[i].place)}</title></circle>`
      + `<text x="${x}" y="68" text-anchor="middle">${esc(mmyy(points[i].date))} · ${esc(points[i].place)}</text>`).join('')
    + '</svg>';
}

export function athleteCardHtml({ name, club, country, catLabel, gender, mine, now, hist, wc, wcState = 'none', wcAt = null, disc = 'B', viewer, notes, roundId, catMode = 0 } = {}) {
  disc = disc === 'L' ? 'L' : 'B';
  const fem = gender === 'W';
  const seasons = (hist?.seasons || []).map(s => ({ ...s, comps: (s.comps || []).filter(c => c.disc === disc) })).filter(s => s.comps.length);
  // a device copy of the World Climbing data is always shown (graceful offline): while it is refetched ('loading') with the
  // small loading line, after a failed refetch ('error') with a dated note; the plain loading / error text only without a copy
  const hasWc = !!wc && wcState !== 'none';
  const out = [];

  // header
  const photo = hasWc && /^https:\/\//.test(String(wc.photo || '')) ? wc.photo : null;
  const where = club ? esc(club) : country ? `${country === ISR ? '🇮🇱 ' : ''}${esc(country)}` : '';
  const sub = [where, catLabel ? esc(catLabel) : '', hasWc && num(wc.age) ? `גיל ${esc(wc.age)}` : ''].filter(Boolean).join(' · ');
  out.push(`<div class="ac-who">${photo ? `<img class="ac-av" src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="ac-av" aria-hidden="true">${esc(initials(name))}</div>`}`
    + `<div><h2 class="ac-name">${esc(name)}</h2>${sub ? `<p>${sub}</p>` : ''}</div></div>`);
  const badges = [mine ? `<span class="ac-bdg mine">${viewer ? 'ספורטאי הפלגיה' : 'שלי'}</span>` : '', hasWc ? '<span class="ac-bdg wc">World Climbing</span>' : ''].filter(Boolean);
  if (badges.length) out.push(`<div class="ac-badges">${badges.join('')}</div>`);

  // discipline tabs
  out.push(`<div class="ac-disc" role="group" aria-label="ענף">${['B', 'L'].map(d => `<button type="button" data-ath-disc="${d}" aria-pressed="${d === disc}">${DISC[d]}</button>`).join('')}</div>`);

  // this competition
  if (now) {
    const o = now.overall ?? now.place;
    const parts = [num(o) ? `<b>מקום ${esc(o)}</b>` : `<b>${fem ? 'עוד לא טיפסה' : 'עוד לא טיפס'}</b>`];
    if (num(now.catPlace) && now.catText) parts.push(`מקום ${esc(now.catPlace)} ב-${esc(now.catText)}`);
    if (now.adv === true) parts.push('עולה לראונד הבא'); else if (now.adv === false) parts.push('לא עולה');
    out.push(`<div class="ac-now">${now.live ? '<i class="ltag" aria-hidden="true"><i></i>LIVE</i> <span class="ac-live">תוצאות חיות</span> · ' : ''}בתחרות הזו: ${parts.join(' · ')}</div>`);
  }

  // season summary: the running season if it has this discipline, else the newest one
  const season = seasons.find(s => s.id === hist?.current?.seasonId) || seasons[0];
  if (season) {
    const cat = season.comps.map(ownCat).find(Boolean) || null, byCat = !!cat && Number(catMode) === 1;
    const sum = seasonSummary(byCat ? season.comps.filter(c => num(c.catPlace)) : season.comps, { cat: byCat });
    const tog = cat ? `<div class="choices ac-cat" role="group" aria-label="דירוג">${[['0', 'כללי'], ['1', cat]].map(([v, t]) => `<button type="button" class="choice" data-ath-cat="${v}" aria-pressed="${(v === '1') === byCat}">${esc(t)}</button>`).join('')}</div>` : '';
    const tile = (v, t) => `<div class="ac-tile"><b>${v == null ? '–' : esc(v)}</b><span>${t}</span></div>`;
    out.push(`<h4 class="ac-h">${esc(season.label)} <small>${DISC[disc]}</small></h4>${tog}`
      + `<div class="ac-tiles">${tile(sum.count, 'תחרויות')}${tile(sum.best, 'הכי טוב')}${tile(sum.avg, 'ממוצע')}${tile(sum.finals, 'גמרים')}</div>`);
    const svg = trendSvg(sum.trend);
    if (svg) out.push(`<h4 class="ac-h">מגמה <small>מקום, למעלה = טוב יותר</small></h4>${svg}`);
  }

  // World Climbing block
  if (wcState === 'loading') out.push('<p class="ac-msg">טוען נתונים מ-World Climbing…</p>');
  else if (wcState === 'error') out.push(hasWc ? `<p class="ac-msg">${(d => (d ? `נתוני World Climbing מ-${d}` : 'נתוני World Climbing שמורים'))(ddmm(wcAt))} · אין חיבור כרגע</p>`
    : '<p class="ac-msg">לא הצלחנו לטעון מ-World Climbing כרגע</p>');
  if (hasWc) {
    const rows = POD_ROWS.map(([k, t]) => [t, wc.podiums?.[k]?.[disc]]).filter(([, p]) => p);
    if (rows.length) out.push(`<h4 class="ac-h">פודיומים <small>${DISC[disc]}</small></h4><table class="ac-pod"><thead><tr><th></th><th>🥇</th><th>🥈</th><th>🥉</th><th>תחרויות</th></tr></thead><tbody>`
      + rows.map(([t, p]) => `<tr><td>${t}</td><td>${esc(p[1])}</td><td>${esc(p[2])}</td><td>${esc(p[3])}</td><td>${esc(p.total)}</td></tr>`).join('') + '</tbody></table>');
    const cups = sorted((wc.cups || []).filter(c => num(c[disc])), c => String(c.season));
    if (cups.length) out.push(`<h4 class="ac-h">דירוג גביע עולם</h4><ul class="ac-cups">${cups.map(c => `<li title="${esc(c.name)}">${esc(c.season)} · מקום ${esc(c[disc])}</li>`).join('')}</ul>`);
  }

  // results, newest first: the portal's comps (international ones only when World Climbing's own list is not shown)
  const nat = seasons.flatMap(s => s.comps).filter(c => !(hasWc && c.intl)).map(c => ({ date: c.date || '', html:
    `<li><button type="button" class="ac-row" data-ath-round="${esc(c.roundId)}"><span class="ac-ty ${c.intl ? 'wc' : 'il'}">${c.intl ? 'בינ״ל' : 'ליגה'}</span>`
    + `<span class="ac-ev">${esc(c.title)}<small>${esc(roundTitle(c.roundLabel))}</small></span><span class="ac-yr">${esc(mmyy(c.date))}</span>`
    + `<span class="ac-pl${num(c.overall ?? c.place) && (c.overall ?? c.place) <= 3 ? ' pod' : ''}">${esc(placeText(c))}</span></button></li>` }));
  const intl = hasWc ? (wc.results || []).filter(r => r.disc === disc).map(r => { const inner = `<span class="ac-ty wc">WC</span>`
    + `<span class="ac-ev">${esc(r.event)}<small>${esc([wcCat(r.cat), r.location].filter(Boolean).join(' · '))}</small></span><span class="ac-yr">${esc(r.season)}</span>`
    + `<span class="ac-pl${num(r.rank) && r.rank <= 3 ? ' pod' : ''}">${num(r.rank) ? `מקום ${esc(r.rank)}` : ''}</span>`;
  return { date: String(r.date || r.season || ''), html: num(r.eventId) ? `<li><button type="button" class="ac-row" data-ath-ev="${esc(r.eventId)}">${inner}</button></li>` : `<li><div class="ac-row">${inner}</div></li>` }; }) : [];
  const all = sorted([...nat, ...intl], x => x.date);
  out.push(`<h4 class="ac-h">תוצאות <small>${DISC[disc]}</small></h4>`
    + (all.length ? `<ul class="ac-rl">${all.map(x => x.html).join('')}</ul>` : `<p class="ac-msg">אין עדיין תוצאות ב${DISC[disc]}</p>`));
  if (hasWc && num(wc.id)) out.push(`<a class="ac-link" href="https://ifsc.results.info/athlete/${esc(wc.id)}" target="_blank" rel="noopener">לעמוד המלא ב-World Climbing ↗</a>`);

  // coach notes
  if (!viewer && num(notes) && notes > 0) out.push(`<button type="button" class="ac-notes" data-ath-notes>📝 ${notes === 1 ? 'הערה אחת שלך' : `${esc(notes)} הערות שלך`}</button>`);

  return `<div class="ac"${roundId ? ` data-ath-from="${esc(roundId)}"` : ''}>${out.join('')}</div>`;
}
