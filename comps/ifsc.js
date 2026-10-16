// 3.11.0: international rounds (IFSC / World Climbing). The comp-push Worker proxies ifsc.results.info (/ifsc?r=<round>)
// and answers { round, status: pending|active|finished, updated, nB, rows: [{ bib, name, country, ifscRank, bs }] }.
// Here: that answer → the same results shape as live.js / src/results.mjs (club = country), so rankRows / cards / table
// work unchanged. Israelis (country ISR) play the part of "my athletes".
export const ISR = 'ISR';
export const isIsr = r => r?.country === ISR;
export const IFSC_POLL_MS = 15000;

export function ifscResults(d) {
  const rows = (d.rows || []).map(x => ({ bib: x.bib, name: x.name, club: x.country, country: x.country, cat: null, ifscRank: x.ifscRank ?? null, bs: x.bs }));
  const done = rows.reduce((n, r) => n + r.bs.filter(Boolean).length, 0), total = rows.length * (d.nB || 0);
  return { rows, status: d.status, live: d.status !== 'finished', done, total, started: rows.filter(r => r.bs.some(Boolean)).length,
    complete: d.status === 'finished' || (total > 0 && done === total), updated: d.updated || null, final: true, intl: true };
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

// one round from the Worker; throws on network / server error (the app keeps the last data)
export async function fetchIfsc(base, headers, id, timeoutMs = 10000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/ifsc?r=${encodeURIComponent(id)}`, { headers, cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally { clearTimeout(to); }
}
