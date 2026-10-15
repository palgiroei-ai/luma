// Live results (3.4.0, trial — the federation allowed it for this competition, Roei 2026-10-14).
// The federation's judging app (ilca-boulder-score.netlify.app) keeps every judge entry in a public Firebase Realtime
// Database; its own live page reads the same data. One record per athlete per boulder, key `bib|category|gender|route`
// (URL-encoded), { attempts, topAttempts?, zoneAttempts?, locked, updatedAt, … }. The database holds ONE round at a time
// (keys carry no round), so a record counts for our round only when config.roundNumber matches and it was entered on the
// round's date (Israel time). We read only bib + attempts — never names of judges or anything else.
import { zoneParts } from './engine.js';

export const LIVE_DB = 'https://realtime-database---test-default-rtdb.europe-west1.firebasedatabase.app/ilca-bldr-7kqm2n9x4wfp';

// our round → the federation's category group (config.categoryGroups) + gender
export function liveGroup(roundId) {
  const m = roundId.match(/^(sen|u17)-([mw])/); if (!m) return null;
  const g = m[2] === 'w' ? 'W' : 'M';
  return { gender: g, group: m[1] === 'sen' ? (g === 'W' ? 'בוגרות' : 'בוגרים') : (g === 'W' ? 'בנות U17' : 'בנים U17') };
}
export const roundNumberOf = roundId => Number((roundId.match(/-r(\d)$/) || [])[1] || 1);
// 'בוגרים' / 'בוגרות' → S, 'בנים U19' → U19 (same codes as src/results.mjs)
export const catCode = name => (/U\d+/.exec(name) || ['S'])[0];

const dayOf = ms => { const d = zoneParts(ms); return `${d.y}-${String(d.mo).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; };

// → { rows, done, total, started, complete, updated } or null when the database is not on this round.
// rows like src/results.mjs rows; bs[j] = [top attempt, zone attempt] or null = not climbed yet. Only athletes of our
// start list (a leftover of another round can never slip in). nowMs: entries after it are ignored (simulation replays).
export function liveRows(round, cfg, results, nowMs) {
  const lg = liveGroup(round.id); if (!lg || !cfg || !results || !round.slots.length) return null;
  if (cfg.roundNumber != null && Number(cfg.roundNumber) !== roundNumberOf(round.id)) return null;
  const cats = cfg.categoryGroups?.[lg.group] || [lg.group], nB = round.boulders;
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
