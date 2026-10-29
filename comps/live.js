// Live results (3.4.0, trial — the federation allowed it for this competition, Roei 2026-10-14).
// The federation's judging app (ilca-boulder-score.netlify.app) keeps every judge entry in a public Firebase Realtime
// Database; its own live page reads the same data. One record per athlete per boulder, key `bib|category|gender|route`
// (URL-encoded), { attempts, topAttempts?, zoneAttempts?, locked, updatedAt, … }. The database holds ONE round at a time
// (keys carry no round), so a record counts for our round only when config.roundNumber matches and it was entered on the
// round's date (Israel time). We read only bib + attempts — never names of judges or anything else.
import { zoneParts } from './engine.js';

export const LIVE_DB = 'https://realtime-database---test-default-rtdb.europe-west1.firebasedatabase.app/ilca-bldr-7kqm2n9x4wfp';

// our round → the federation's category group (config.categoryGroups) + gender. 3.26.0: lead ids too (lead1-sen-w-r1)
export function liveGroup(roundId) {
  const m = roundId.match(/(?:^|-)(sen|u17)-([mw])(?:-|$)/); if (!m) return null;
  const g = m[2] === 'w' ? 'W' : 'M';
  return { gender: g, group: m[1] === 'sen' ? (g === 'W' ? 'בוגרות' : 'בוגרים') : (g === 'W' ? 'בנות U17' : 'בנים U17') };
}
// 3.26.0: the group's categories. The federation renamed the youth groups for lead ("נערות U17" = בנות U15 + בנות U17)
// → by name first, else the group that holds our main category, else that category alone
export function groupCats(cfg, lg) {
  const gs = cfg?.categoryGroups || {};
  return gs[lg.group] || Object.values(gs).find(c => Array.isArray(c) && c.includes(lg.group)) || [lg.group];
}
export const isLeadCfg = cfg => String(cfg?.discipline ?? '').trim().toLowerCase() === 'lead';
export const roundNumberOf = roundId => Number((roundId.match(/-r(\d)$/) || [])[1] || 1);
// 'בוגרים' / 'בוגרות' → S, 'בנים U19' → U19 (same codes as src/results.mjs)
export const catCode = name => (/U\d+/.exec(name) || ['S'])[0];

const dayOf = ms => { const d = zoneParts(ms); return `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };

// → { rows, done, total, started, complete, updated } or null when the database is not on this round.
// rows like src/results.mjs rows; bs[j] = [top attempt, zone attempt] or null = not climbed yet. Only athletes of our
// start list (a leftover of another round can never slip in). nowMs: entries after it are ignored (simulation replays).
export function liveRows(round, cfg, results, nowMs) {
  const lg = liveGroup(round.id); if (!lg || !cfg || !results || !round.slots.length) return null;
  if (isLeadCfg(cfg) || (cfg.roundNumber != null && Number(cfg.roundNumber) !== roundNumberOf(round.id))) return null;
  const cats = groupCats(cfg, lg), nB = round.boulders;
  const bySlot = new Map(round.slots.filter(Boolean).map(s => [s.bib, { bib: s.bib, name: s.name, club: '', cat: null, bs: Array(nB).fill(null) }]));
  let updated = 0, done = 0; const seen = new Set();
  for (const [key, v] of Object.entries(results)) {
    let k; try { k = decodeURIComponent(key); } catch { continue; }
    const [bib, cat, gender, route] = k.split('|'), j = Number(route) - 1, row = bySlot.get(Number(bib));
    if (!row || gender !== lg.gender || !cats.includes(cat) || !(j >= 0 && j < nB) || !v) continue;
    const at = Date.parse(v.updatedAt); if (!at || at > nowMs || dayOf(at) !== round.date) continue;
    if (!seen.has(row.bib + '|' + j)) { seen.add(row.bib + '|' + j); done++; }
    // 0 attempts and no top/zone = the judge closed the boulder but he never climbed it (DNS) → not climbed
    const t = Number(v.topAttempts) || 0, z = Number(v.zoneAttempts) || 0;
    row.bs[j] = !t && !z && Number(v.attempts) === 0 ? null : [t, z];
    row.cat = catCode(cat); if (v.club) row.club = String(v.club).slice(0, 60);
    updated = Math.max(updated, at);
  }
  if (!done) return null;
  const rows = [...bySlot.values()], started = rows.filter(r => r.bs.some(Boolean)).length;
  return { rows, done, total: rows.length * nB, started, complete: done === rows.length * nB, updated };
}

// 3.26.0 lead: one record per climber per route { started?, top?, hold, plus?, timeMs?, updatedAt } (federation app,
// 27/10). Route 1 = our A, 2 = B. Score text like our manual files: "TOP" / "34" / "34+" / "23.5" (intermediate hold);
// a record that never started (opened, nothing entered) = no result yet.
export function leadScore(v) {
  if (!v) return null;
  const hold = Math.min(80, Math.max(0, Math.round((Number(String(v.hold ?? '').replace(',', '.')) || 0) * 100) / 100));
  if (!(v.started === true || v.top === true || hold > 0 || Number(v.timeMs) > 0)) return null;
  return v.top === true ? 'TOP' : `${hold}${v.plus ? '+' : ''}`;
}
// → { rows: [{ bib, name, club, cat, A, B }], done, total, started, complete, updated } or null (not our round / nothing yet)
export function liveLeadRows(round, cfg, results, nowMs) {
  const lg = liveGroup(round.id); if (!lg || !cfg || !results || !round.slots.length || !isLeadCfg(cfg)) return null;
  if (cfg.roundNumber != null && Number(cfg.roundNumber) !== roundNumberOf(round.id)) return null;
  const cats = groupCats(cfg, lg), routes = round.routes || (round.boulders > 1 ? ['A', 'B'] : ['A']);
  // 3.28.0: categories as in boulder (S / U21 / U19 / U17 / U15) — the start lists say 'Senior'
  const bySlot = new Map(round.slots.filter(Boolean).map(s => [s.bib, { bib: s.bib, name: s.name, club: s.club || '', cat: s.cat === 'Senior' ? 'S' : s.cat || null }]));
  // 3.31.2 (real data 29/10): the federation roster can carry another bib than our list (יובל עובדיה 83 vs 54) → a bib not
  // on the list counts for the climber of the same name, only when her own bib has no record of this gender
  const keys = Object.keys(results).map(key => { try { return decodeURIComponent(key).split('|'); } catch { return []; } });
  const own = new Set(keys.filter(p => p[2] === lg.gender).map(p => Number(p[0])));
  const nm = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const byName = new Map([...bySlot.values()].filter(r => !own.has(r.bib)).map(r => [nm(r.name), r]));
  let updated = 0, done = 0;
  for (const [key, v] of Object.entries(results)) {
    let k; try { k = decodeURIComponent(key); } catch { continue; }
    const [bib, cat, gender, route] = k.split('|'), x = routes[Number(String(route).replace(/[^\d]/g, '')) - 1];
    const row = bySlot.get(Number(bib)) || (v && byName.get(nm(v.name)));
    if (!row || gender !== lg.gender || !cats.includes(cat) || !x || !v) continue;
    const at = Date.parse(v.updatedAt); if (!at || at > nowMs || dayOf(at) !== round.date) continue;
    const sc = leadScore(v); if (sc == null) continue;
    if (!row.cat) row.cat = catCode(cat);
    // 3.27.1 (real data 28/10): the judge opens the record when the climb STARTS (started, hold 0, locked false) and locks
    // it with the final score → only a locked record is a result; an open one = she is on the wall since (now − timeMs)
    if (v.locked !== true) { (row.on || Object.defineProperty(row, 'on', { value: {}, enumerable: false }).on)[x] = at - (Number(v.timeMs) || 0); continue; }
    if (row[x] == null) done++;
    row[x] = sc;
    (row.at || Object.defineProperty(row, 'at', { value: {}, enumerable: false }).at)[x] = at; // 3.27.0: when (moves the route on; not a score field)
    updated = Math.max(updated, at);
  }
  const rows = [...bySlot.values()], total = rows.length * routes.length;
  if (!done) return rows.some(r => r.on) ? { rows, done, total, started: 0, complete: false, updated, routes, climbingOnly: true } : null;
  return { rows, done, total, started: rows.filter(r => routes.some(x => r[x] != null)).length, complete: done === total, updated, routes };
}
// new route results since the last poll → [{ bib, name, route: 1|2, score }]; prev = null → nothing (as liveEvents)
export function liveLeadEvents(prevRows, rows, routes = ['A', 'B']) {
  if (!prevRows || !rows) return [];
  const before = new Map(prevRows.map(r => [r.bib, r]));
  return rows.flatMap(r => routes.flatMap((x, j) => (r[x] != null && before.get(r.bib)?.[x] !== r[x] ? [{ bib: r.bib, name: r.name, route: j + 1, score: r[x] }] : [])));
}

export async function fetchLive(signal) {
  const get = p => fetch(`${LIVE_DB}/${p}.json`, { cache: 'no-store', signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  const [cfg, results] = await Promise.all([get('config'), get('results')]);
  return { cfg, results: results || {} };
}

// 3.8.0: what changed between two polls → one event per athlete per boulder: a new top (with or without a new zone in the
// same poll) or a new zone. prev = null (first data for the round) → nothing: no toasts for what happened before we looked.
export function liveEvents(prevRows, rows) {
  if (!prevRows || !rows) return [];
  const before = new Map(prevRows.map(r => [r.bib, r.bs]));
  const out = [];
  for (const r of rows) {
    const pb = before.get(r.bib) || [];
    r.bs.forEach((c, j) => {
      if (!c) return;
      const [t, z] = c, [pt, pz] = pb[j] || [0, 0];
      if (t && !pt) out.push({ bib: r.bib, name: r.name, b: j + 1, kind: 'top', att: t });
      else if (z && !pz) out.push({ bib: r.bib, name: r.name, b: j + 1, kind: 'zone', att: z });
    });
  }
  return out;
}
