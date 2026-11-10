// 3.33.0 athlete card: the bottom-sheet card's HTML (pure; tests/athlete-card.test.mjs). No DOM, no state — app.js (Task 7)
// owns the sheet, the taps and the World Climbing fetch. Sections (approved mock): header · badges · discipline tabs
// בולדר / הובלה (no speed) · "בתחרות הזו" · season summary (+ overall / category toggle) · trend · World Climbing
// (podiums + World Cup rank per season) · results newest first · link · coach notes. Every interpolated value → esc.
// 3.34.0: toggle בוגרים / נוער (data-ath-age="S|Y") + table "הישגים" per series (wcSeries) instead of the API podiums.
// Data attributes for app.js: data-ath-disc="B|L", data-ath-age="S|Y", data-ath-cat="0|1", data-ath-round="<round id>", data-ath-ev="<WC event
// id>", data-ath-notes. Wording rules (tests/wording.test.mjs): Palgi athlete badge = "ספורטאי הפלגיה" for viewers, "שלי" for
// the coach — the same words as app.js MINE_NAME.
import { esc, ISR } from './ifsc.js';
import { catHe, roundTitle } from './labels.js';
import { DISC } from './seasons.js';
import { seasonSummary, compAge } from './athlete.js';

const sorted = (list, key) => [...list].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0)); // newest first
const num = v => typeof v === 'number' && Number.isFinite(v);
const mmyy = d => (/^(\d{2})(\d{2})-(\d{2})/.exec(String(d || '')) ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : '');
// cache time (ms) → "09/11" (device time), else ''
const ddmm = ms => { const d = num(ms) ? new Date(ms) : null; return d && !isNaN(d) ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}` : ''; };
const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('');
// a category code with its own place (U19 in a seniors round, U15 in U17) — open seniors 'S' has none
const ownCat = c => (!c.intl && c.catKey && c.catKey !== 'S' && num(c.catPlace) ? c.catKey : null);
// national row text: "מקום 7 כללי · 2 ב-U19", or the overall place alone
// a youth-side copy of a senior comp (yCat, below) → "מקום 1 ב-U19"
const placeText = c => { const k = ownCat(c), o = c.overall ?? c.place;
  return num(o) ? (c.yCat ? `מקום ${o} ב-${c.yCat}` : k ? `מקום ${o} כללי · ${c.catPlace} ב-${k}` : `מקום ${o}`) : ''; };
// World Climbing result category 'w19' / 'm' → Hebrew label
const wcCat = cat => { const m = /^([mw])(\d*)$/.exec(String(cat || '')); return m ? catHe(m[2] ? 'U' + m[2] : 'S', m[1] === 'w' ? 'W' : 'M') : ''; };

// 3.34.0 (Roei): a World Climbing result's series from its event name (+ category). The API's own podium counts mix every
// event (a European Cup win showed as "גביע עולם") → never rendered; the card counts ranks itself. "youth" in the name or
// an age in the category (m19, w17) = youth; then World Cup / World Climbing Series → wc, World Championship(s) → wch,
// European Cup / Europe … Continental Cup → ec, European / Europe … Continental Championship(s) → ech; anything else
// (Games, other continents) → other.
const SERIES = { wc: 'גביע עולם', wch: 'אליפות עולם', ec: 'גביע אירופה', ech: 'אליפות אירופה', og: 'אולימפיאדה', yog: 'אולימפיאדת נוער', oq: 'מוקדמות אולימפיות', euq: 'מוקדמות אולימפיות · אירופה', eg: 'משחקים אירופיים', twg: 'משחקים עולמיים', other: 'אחר' };
const seriesLabel = (key, age) => SERIES[key] + (age === 'Y' && ['wch', 'ec', 'ech'].includes(key) ? ' נוער' : '');
// the results row badge per series, coloured like the portal's event tones (seasons.js evTone: World Cup blue, European Cup
// orange, European Youth Cup green, championships gold); youth championships get a Y (EYCH / WYCH)
const BADGE = { wc: ['WC', 'wc'], wch: ['WCH', 'ch'], ec: ['EC', 'ec'], ech: ['ECH', 'ch'], og: ['OG', 'ch'], yog: ['YOG', 'eyc'], oq: ['OQ', 'ch'], euq: ['EOQ', 'ec'], eg: ['EG', 'ec'], twg: ['TWG', 'wc'], other: ['אחר', 'other'] };
const BADGE_Y = { wch: ['WYCH', 'ch'], ec: ['EYC', 'eyc'], ech: ['EYCH', 'ch'] };
const seriesBadge = s => { const [t, tone] = (s.age === 'Y' && BADGE_Y[s.key]) || BADGE[s.key] || BADGE.other; return `<span class="ac-ty ev-${tone}">${t}</span>`; };
const NOT_SERIES = /\bPara\b|Universit|Military|CISM|FISU|Schools|Games|Qualifier|Test Event|Speed Knockout|Madrid (?:4 )?Speed|Promotional|Open\b|Intl\.|Asia|Asian|Pan ?Am|South America|Oceania|Africa/i;
export function wcSeries(event, cat) {
  const s = String(event || '').replace(/\s+/g, ' ').trim(), eu = /\bEurop/i.test(s);
  const key = /Youth Olympic Games/i.test(s) ? 'yog' : /Olympic Games/i.test(s) ? 'og' : /Olympic Qualifier/i.test(s) ? 'oq' : /European Qualifier/i.test(s) ? 'euq'
    : /European Games/i.test(s) ? 'eg' : /The World Games/i.test(s) ? 'twg' : NOT_SERIES.test(s) ? 'other'
    : eu ? (/Cup|Series/i.test(s) ? 'ec' : /Championship/i.test(s) ? 'ech' : 'other')
    : /World ?Cup|World Climbing Series/i.test(s) ? 'wc' : /World (?:Climbing )?(?:Youth )?Championship|Youth World Championship|Climbing Youth World Championship/i.test(s) ? 'wch' : 'other';
  const age = /youth/i.test(s) || /\d/.test(String(cat || '')) ? 'Y' : 'S';
  return { key, age, label: seriesLabel(key, age) };
}
// a portal comp's age group (historyOf sets it; a comp from an older caller → its round id) and its table row key
const ageOf = c => c.age || compAge(null, c.roundId);
// Roei 2026-11-10: a senior national comp climbed in a youth category (that round's own catKey + catPlace — U21 / U19 in a
// seniors round) is on BOTH sides: seniors by the overall place, youth as a copy placed by the category place (yCat)
const youthCopy = c => ({ ...c, overall: c.catPlace, place: c.catPlace, catPlace: null, catKey: null, yCat: c.catKey });
const noCat = c => ({ ...c, catPlace: null, catKey: null }); // 3.34.1: the seniors side shows overall places only
const finished = c => !c.open;
const compsFor = (list, a) => list.flatMap(c => (ageOf(c) === a ? [a === 'S' ? noCat(c) : c] : a === 'Y' && ownCat(c) ? [youthCopy(c)] : []));
const rowKeyOf = c => { const k = c.intl ? (['wc', 'wch', 'ec', 'ech'].includes(c.type) ? c.type : 'other') : c.type === 'ich' ? 'ich' : 'nat';
  return c.yCat && !c.intl ? `${k}cat:${c.yCat}` : k; };
const ROW_ORDER = ['wc', 'wch', 'twg', 'og', 'yog', 'oq', 'ec', 'ech', 'euq', 'eg', 'nat', 'natcat', 'ich', 'ichcat', 'other'];
// 'natcat:U19' → "ליגת העל · U19" (a seniors league by category, youth side); 'nat' youth → "ליגת נוער" (youth-league rounds)
const rowLabel = (key, age) => { const [k, cat] = key.split(':');
  return k === 'natcat' ? `ליגת העל · ${cat}` : k === 'ichcat' ? `אליפות ישראל · ${cat}`
    : k === 'nat' ? (age === 'Y' ? 'ליגת נוער' : 'ליגת העל') : k === 'ich' ? (age === 'Y' ? 'אליפות ישראל לנוער' : 'אליפות ישראל') : seriesLabel(k, age); };
// achievements: [{ key, place }] → table rows in ROW_ORDER (then category): competitions (with a place) · best · 🥇 · 🥈 · 🥉
function achTable(entries, age) {
  const ord = k => ROW_ORDER.indexOf(k.split(':')[0]);
  const keys = [...new Set(entries.map(e => e.key))].sort((a, b) => ord(a) - ord(b) || (a < b ? -1 : a > b ? 1 : 0));
  const rows = keys.map(k => { const ps = entries.filter(e => e.key === k && num(e.place)).map(e => e.place);
    return ps.length ? [rowLabel(k, age), ps.length, Math.min(...ps), ...[1, 2, 3].map(p => ps.filter(x => x === p).length)] : null; }).filter(Boolean);
  return rows.length ? '<table class="ac-pod"><thead><tr><th></th><th>תחרויות</th><th>הכי טוב</th><th>🥇</th><th>🥈</th><th>🥉</th></tr></thead><tbody>'
    + rows.map(([t, ...v]) => `<tr><td>${esc(t)}</td>${v.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('') + '</tbody></table>' : '';
}

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

export function athleteCardHtml({ name, club, country, catLabel, gender, mine, hist, wc, wcState = 'none', wcAt = null, disc = 'B', viewer, notes, roundId, catMode = 0, age } = {}) {
  disc = disc === 'L' ? 'L' : 'B';
  // a device copy of the World Climbing data is always shown (graceful offline): while it is refetched ('loading') with the
  // small loading line, after a failed refetch ('error') with a dated note; the plain loading / error text only without a copy
  const hasWc = !!wc && wcState !== 'none';
  // 3.34.0 seniors / youth: the asked group (default seniors), or the other one when the asked group has nothing in this
  // discipline (portal comps or World Climbing results); the toggle only when both groups have something
  const discComps = (hist?.seasons || []).flatMap(s => s.comps || []).filter(c => c.disc === disc);
  const wcDisc = hasWc ? (wc.results || []).filter(r => r.disc === disc).map(r => ({ r, s: wcSeries(r.event, r.cat) })) : [];
  const has = a => compsFor(discComps, a).length > 0 || wcDisc.some(x => x.s.age === a);
  age = age === 'Y' ? 'Y' : 'S';
  if (!has(age) && has(age === 'Y' ? 'S' : 'Y')) age = age === 'Y' ? 'S' : 'Y';
  const both = has('S') && has('Y');
  const seasons = (hist?.seasons || []).map(s => ({ ...s, comps: compsFor((s.comps || []).filter(c => c.disc === disc), age) })).filter(s => s.comps.length);
  const wcRes = wcDisc.filter(x => x.s.age === age);
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
  if (both) out.push(`<div class="choices ac-age" role="group" aria-label="בוגרים או נוער">${[['S', 'בוגרים'], ['Y', 'נוער']].map(([v, t]) => `<button type="button" class="choice" data-ath-age="${v}" aria-pressed="${v === age}">${t}</button>`).join('')}</div>`);
  const ageTag = both ? ` · ${age === 'Y' ? 'נוער' : 'בוגרים'}` : '';

  // season summary: the running season if it has this discipline, else the newest one
  const season = seasons.find(s => s.id === hist?.current?.seasonId) || seasons[0];
  if (season) {
    const cat = season.comps.map(ownCat).find(Boolean) || null, byCat = !!cat && age === 'Y' && Number(catMode) === 1;
    const sum = seasonSummary((byCat ? season.comps.filter(c => num(c.catPlace)) : season.comps).filter(finished), { cat: byCat });
    const tog = cat && age === 'Y' ? `<div class="choices ac-cat" role="group" aria-label="דירוג">${[['0', 'כללי'], ['1', cat]].map(([v, t]) => `<button type="button" class="choice" data-ath-cat="${v}" aria-pressed="${(v === '1') === byCat}">${esc(t)}</button>`).join('')}</div>` : '';
    const tile = (v, t) => `<div class="ac-tile"><b>${v == null ? '–' : esc(v)}</b><span>${t}</span></div>`;
    out.push(`<h4 class="ac-h">${esc(season.label)} <small>${DISC[disc]}${ageTag}</small></h4>${tog}`
      + `<div class="ac-tiles">${tile(sum.count, 'תחרויות')}${tile(sum.best, 'הכי טוב')}${tile(sum.avg, 'ממוצע')}${tile(sum.finals, 'גמרים')}</div>`);
    const svg = trendSvg(sum.trend);
    if (svg) out.push(`<h4 class="ac-h">מגמה <small>מקום, למעלה = טוב יותר</small></h4>${svg}`);
  }

  // World Climbing block
  if (wcState === 'loading') out.push('<p class="ac-msg">טוען נתונים מ-World Climbing…</p>');
  else if (wcState === 'error') out.push(hasWc ? `<p class="ac-msg">${(d => (d ? `נתוני World Climbing מ-${d}` : 'נתוני World Climbing שמורים'))(ddmm(wcAt))} · אין חיבור כרגע</p>`
    : '<p class="ac-msg">לא הצלחנו לטעון מ-World Climbing כרגע</p>');
  // achievements (replaces 3.33.0's podium table): World Climbing results by series + the portal's comps (national league /
  // championship rows; international ones only when World Climbing's own list is not shown) — this discipline + age group
  const ach = achTable([...wcRes.map(x => ({ key: x.s.key, place: x.r.rank })),
    ...seasons.flatMap(s => s.comps).filter(c => finished(c) && !(hasWc && c.intl)).map(c => ({ key: rowKeyOf(c), place: c.overall ?? c.place }))], age);
  if (ach) out.push(`<h4 class="ac-h">הישגים <small>${DISC[disc]}${ageTag}</small></h4>${ach}`);
  if (hasWc) { // overall ranking per series (3.34.1): World Cup / European Cup / … rows, seasons oldest first; this age side only
    const bySeries = new Map();
    for (const c of (wc.cups || []).filter(c => num(c[disc]))) {
      const s = wcSeries(c.name, ''); if (s.age !== age) continue;
      if (!bySeries.has(s.key)) bySeries.set(s.key, { label: s.label, list: [] });
      bySeries.get(s.key).list.push(c);
    }
    const rows = ROW_ORDER.filter(k => bySeries.has(k)).map(k => { const g = bySeries.get(k);
      return `<li class="ac-cup"><b>${esc(g.label)}</b>${sorted(g.list, c => String(c.season)).reverse().map(c => `<span title="${esc(c.name)}">${esc(c.season)} · מקום ${esc(c[disc])}</span>`).join('')}</li>`; });
    if (rows.length) out.push(`<h4 class="ac-h">דירוג כללי בסדרה</h4><ul class="ac-cups">${rows.join('')}</ul>`);
  }

  // results, newest first: the portal's comps (international ones only when World Climbing's own list is not shown)
  const nat = seasons.flatMap(s => s.comps).filter(c => !(hasWc && c.intl)).map(c => ({ date: c.date || '', html:
    `<li><button type="button" class="ac-row" data-ath-round="${esc(c.roundId)}"><span class="ac-ty ${c.intl ? 'wc' : 'il'}">${c.intl ? 'בינ״ל' : 'ליגה'}</span>`
    + `<span class="ac-ev">${esc(c.title)}<small>${esc(roundTitle(c.roundLabel))}</small>${c.open ? `<small class="ac-open">${c.open === 'live' ? 'לא סופי · בזמן אמת' : `לא סופי · אחרי ראונד ${esc(c.open)}`}</small>` : ''}</span><span class="ac-yr">${esc(mmyy(c.date))}</span>`
    + `<span class="ac-pl${num(c.overall ?? c.place) && (c.overall ?? c.place) <= 3 ? ' pod' : ''}">${esc(placeText(c))}</span></button></li>` }));
  const intl = wcRes.map(({ r, s }) => { const inner = seriesBadge(s)
    + `<span class="ac-ev">${esc(r.event)}<small>${esc([wcCat(r.cat), r.location].filter(Boolean).join(' · '))}</small></span><span class="ac-yr">${esc(r.season)}</span>`
    + `<span class="ac-pl${num(r.rank) && r.rank <= 3 ? ' pod' : ''}">${num(r.rank) ? `מקום ${esc(r.rank)}` : ''}</span>`;
  return { date: String(r.date || r.season || ''), html: num(r.eventId) ? `<li><button type="button" class="ac-row" data-ath-ev="${esc(r.eventId)}">${inner}</button></li>` : `<li><div class="ac-row">${inner}</div></li>` }; });
  const all = sorted([...nat, ...intl], x => x.date);
  out.push(`<h4 class="ac-h">תוצאות <small>${DISC[disc]}${ageTag}</small></h4>`
    + (all.length ? `<ul class="ac-rl">${all.map(x => x.html).join('')}</ul>` : `<p class="ac-msg">אין עדיין תוצאות ב${DISC[disc]}</p>`));
  if (hasWc && num(wc.id)) out.push(`<a class="ac-link" href="https://ifsc.results.info/athlete/${esc(wc.id)}" target="_blank" rel="noopener">לעמוד המלא ב-World Climbing ↗</a>`);

  // coach notes
  if (!viewer && num(notes) && notes > 0) out.push(`<button type="button" class="ac-notes" data-ath-notes>📝 ${notes === 1 ? 'הערה אחת שלך' : `${esc(notes)} הערות שלך`}</button>`);

  return `<div class="ac"${roundId ? ` data-ath-from="${esc(roundId)}"` : ''}>${out.join('')}</div>`;
}
