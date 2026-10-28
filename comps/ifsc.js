// 3.11.0: international rounds (IFSC / World Climbing). The comp-push Worker proxies ifsc.results.info (/ifsc?r=<round>)
// and answers { round, status: pending|active|finished, updated, nB, rows: [{ bib, name, country, ifscRank, bs }] }.
// Here: that answer → the same results shape as live.js / src/results.mjs (club = country), so rankRows / cards / table
// work unchanged. Israelis (country ISR) play the part of "my athletes".
export const ISR = 'ISR';
export const isIsr = r => r?.country === ISR;
// 3.18.0 (Roei): my athletes among them, by the World Climbing name the Palgi app confirmed (DATA.intlMine [{ wcName, short }]);
// case, accents and spaces ignored. → { bib: { short, isr: true } }
export const wcKey = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function intlMineByBib(rows, list) {
  const by = new Map((list || []).map(a => [wcKey(a.wcName), a]));
  return Object.fromEntries((rows || []).filter(isIsr).flatMap(x => (by.has(wcKey(x.name)) ? [[x.bib, { short: by.get(wcKey(x.name)).short, isr: true }]] : [])));
}
export const IFSC_POLL_MS = 15000;

export function ifscResults(d) {
  const rows = (d.rows || []).map(x => ({ bib: x.bib, name: x.name, club: x.country, country: x.country, cat: null, ifscRank: x.ifscRank ?? null, bs: x.bs, ...(x.ap?.length ? { ap: x.ap } : {}) }));
  const done = rows.reduce((n, r) => n + r.bs.filter(Boolean).length, 0), total = rows.length * (d.nB || 0);
  return { rows, status: d.status, live: d.status !== 'finished', done, total, started: rows.filter(r => r.bs.some(Boolean)).length,
    complete: d.status === 'finished' || (total > 0 && done === total), updated: d.updated || null, final: true, intl: true };
}

// 3.16.0 lead (saved rounds only): { lead, nR, rows: [{ bib, name, country, ifscRank, score, rs?, time? }] } → results
// shape. No boulder cells (bs []) — places, cards and the table come from World Climbing's own rank and score text.
export function ifscLeadResults(d) {
  const rows = (d.rows || []).map(x => ({ bib: x.bib, name: x.name, club: x.country, country: x.country, cat: null, ifscRank: x.ifscRank ?? null, score: x.score ?? null,
    ...(x.rs ? { rs: x.rs } : {}), ...(x.time != null ? { time: x.time } : {}), bs: [] }));
  const started = rows.filter(r => r.ifscRank != null).length;
  return { rows, status: d.status, live: d.status !== 'finished', done: started, total: rows.length, started, complete: d.status === 'finished',
    updated: d.updated || null, final: true, intl: true, lead: true, nR: d.nR || 1 };
}
// round id → 'W' | 'M' (3.16.0: youth ids too — w2004l-w19-q)
export const genderOf = id => (/-w\d*(-|$)/.test(id) ? 'W' : 'M');
export const ifscAnyResults = d => (d.lead ? ifscLeadResults(d) : ifscResults(d));
// place = World Climbing's rank; order follows it, non-starters last (stable)
export const leadRanked = rows => rows.map((x, i) => [{ ...x, rank: x.ifscRank ?? null }, i])
  .sort(([a, i], [b, j]) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || i - j).map(([x]) => x);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTop = s => /^top$/i.test(String(s || ''));
const fmtTime = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
// the lead table (World Climbing format): # · climber (country) · per route height + route place (quals) · score / height
// (· time when given). ranked = leadRanked(); adv = how many go on (qualifying line before the first one out).
// 3.18.0: mine = Set of my athletes' bibs → they get the marked row, other Israelis a plain tint ('isr'); without it every Israeli is marked
// 3.21.0: waiting = the round is not over yet → an unranked climber is still to climb (not DNS)
// 3.28.0 national: catOf(x) → category label after the club ('' = none), overall = Map bib → place in the whole round (a category
// view shows it small under the place; the qualifying line then follows the overall place, as in boulder)
export function leadTableHtml(ranked, { nR = 1, adv = 0, onlyIsr = false, fem = false, nameHtml = esc, mine = null, waiting = false, catOf = null, overall = null } = {}) {
  const multi = nR > 1, hasTime = !multi && ranked.some(x => x.time != null);
  const span = 3 + (multi ? nR : 0) + (hasTime ? 1 : 0);
  const sc = (s, cls) => `<td class="${cls}${isTop(s) ? ' top' : ''}">${s == null ? '–' : `<bdi dir="ltr">${esc(s)}</bdi>`}`;
  let cut = false;
  const rowCls = x => (mine ? (mine.has(x.bib) ? ' class="mine"' : isIsr(x) ? ' class="isr"' : '') : isIsr(x) ? ' class="mine"' : '');
  const body = (onlyIsr ? ranked.filter(isIsr) : ranked).map(x => {
    let pre = '';
    const ov = overall ? overall.get(x.bib) : x.rank, ct = catOf ? catOf(x) : '';
    if (adv && !cut && x.rank != null && ov > adv) { cut = true; pre = `<tr class="cut"><td colspan="${span}">קו העלייה לראונד הבא · ${adv} עולים${overall ? ' לפי הדירוג הכללי' : ''}</td></tr>`; }
    const name = `<td class="n"><b>${isIsr(x) ? '<span class="flag" aria-label="ישראל">🇮🇱</span> ' : ''}${nameHtml(x.name)}</b><small>${esc(x.club)}${ct ? ` · ${esc(ct)}` : ''}</small></td>`;
    if (x.rank == null) return pre + `<tr${rowCls(x)}><td class="rk">–</td>${name}<td colspan="${span - 2}" class="muted small">${waiting ? (fem ? 'עוד לא טיפסה' : 'עוד לא טיפס') : fem ? 'לא התחילה (DNS)' : 'לא התחיל (DNS)'}</td></tr>`;
    const routes = multi ? Array.from({ length: nR }, (_, j) => { const r = x.rs?.[j]; return sc(r?.[0], 'lh') + (r?.[1] != null ? `<small>(${r[1]})</small>` : '') + '</td>'; }).join('') : '';
    return pre + `<tr${rowCls(x)}><td class="rk">${x.rank}${overall && ov != null ? `<small class="rk-all">כללי ${ov}</small>` : ''}</td>${name}${routes}${sc(x.score, 'tt')}</td>${hasTime ? `<td class="tm">${x.time != null ? fmtTime(x.time) : ''}</td>` : ''}</tr>`;
  }).join('');
  return `<table class="res-tbl lead-tbl"><thead><tr><th class="rk">#</th><th class="n">${fem ? 'מטפסת' : 'מטפס'}</th>${multi ? Array.from({ length: nR }, (_, j) => `<th class="lh">מסלול ${j + 1}</th>`).join('') : ''}<th class="tt">${multi ? 'ניקוד' : 'גובה'}</th>${hasTime ? '<th class="tm">זמן</th>' : ''}</tr></thead><tbody>${body}</tbody></table>`;
}

// rankRows() output → the place IFSC shows (review 2026-10-16: their tie-breaks win), ours only where IFSC has none;
// a row we count as not started stays unranked (it has no score). Re-sorted by that place, unranked last (stable).
export function ifscRanked(ranked) {
  const out = ranked.map(x => (x.rank == null ? x : { ...x, rank: x.ifscRank ?? x.rank }));
  return out.map((x, i) => [x, i]).sort(([a, i], [b, j]) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || i - j).map(([x]) => x);
}

// round phase (3.11.1, Roei: IFSC marks a round 'active' long before anyone climbs): 'after' when IFSC says finished or
// the venue's day is over; 'live' from the start time or the first result; else 'before'
export function ifscPhaseOf({ nowMs, startMs, date, venueDay, status, started = 0 }) {
  if (status === 'finished' || venueDay > date) return 'after';
  return started > 0 || nowMs >= startMs ? 'live' : 'before';
}

// 3.12.0 (Roei): rounds split into groups (`group` 'A'/'B', ids <base>-a / <base>-b) → a combined entry <base> right
// before them: { combo: [group ids] } with the first group's day/start. Only an entry, never merged results.
export function withCombos(rounds) {
  const out = [], done = new Set(rounds.filter(r => r.combo).map(r => r.id));
  for (const r of rounds) {
    const base = r.group && r.id.replace(/-[a-z]$/, '');
    if (base && !done.has(base)) {
      const gs = rounds.filter(x => x.group && x.event === r.event && x.id.replace(/-[a-z]$/, '') === base);
      if (gs.length > 1) {
        done.add(base);
        out.push({ ...gs[0], id: base, group: undefined, combo: gs.map(x => x.id), title: `${gs[0].title.replace(/ · קבוצה \S+$/, '')} · ${gs.map(x => x.group).join(' + ')}` });
      }
    }
    out.push(r);
  }
  return out;
}

// one round from the Worker; throws on network / server error (the app keeps the last data)
export async function fetchIfsc(base, headers, id, timeoutMs = 10000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/ifsc?r=${encodeURIComponent(id)}`, { headers, cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally { clearTimeout(to); }
}

// 3.12.2 (Roei): appeals (World Climbing marks an ascent 'under_appeal'). Short name = the LASTNAME part.
export const lastName = n => n.split(' ').filter(w => /\p{Lu}/u.test(w) && w === w.toUpperCase()).join(' ') || n;
export const appealsOf = rows => rows.flatMap(r => (r.ap || []).map(j => ({ bib: r.bib, name: r.name, b: j + 1 })));
// could the appeal move someone across the line? out → that boulder as a flash top reaches place q; in → that boulder as
// nothing drops below the first one out. ranked = full ranking (rank set), q = how many advance.
export function appealNearLine(ranked, q) {
  const ok = ranked.filter(x => x.rank != null); if (!q || ok.length <= q) return [];
  const lastIn = ok[q - 1], firstOut = ok[q], pt = b => (!b ? 0 : b[0] ? 25 - 0.1 * (b[0] - 1) : b[1] ? 10 - 0.1 * (b[1] - 1) : 0);
  return ok.filter(x => x.ap?.some(j => (x.rank > q ? x.score - pt(x.bs[j]) + 25 >= lastIn.score : x.score - pt(x.bs[j]) <= firstOut.score)));
}
// Israelis' appeals opened / decided since the last poll → toast events
export function appealEvents(prev, rows) {
  if (!prev) return [];
  const key = (bib, j) => `${bib}:${j}`, before = new Set(prev.flatMap(r => (r.ap || []).map(j => key(r.bib, j)))), now = new Set();
  const out = [];
  for (const r of rows) for (const j of r.ap || []) { now.add(key(r.bib, j)); if (!before.has(key(r.bib, j))) out.push({ bib: r.bib, name: r.name, b: j + 1, kind: 'appeal' }); }
  for (const r of prev) for (const j of r.ap || []) if (!now.has(key(r.bib, j))) out.push({ bib: r.bib, name: r.name, b: j + 1, kind: 'appeal-done' });
  return out;
}
