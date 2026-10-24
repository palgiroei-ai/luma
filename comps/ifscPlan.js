// 3.21.0 (Roei 2026-10-24: "every competition with all its rounds, also the ones that have not happened yet"):
// a World Climbing event's round list (Worker /ifsc/event) → portal rounds, built in the browser so a new round or a new
// event needs no portal deploy. Results come live through /ifsc?r=<ref>. Rounds the build already has (saved results,
// the hand-made SLC rounds) are kept as they are — same ids as src/ifscRounds.mjs: `<ifscPre>-<cat>-<kind>[-<group>]`.

const G = { m: 'גברים', w: 'נשים' }, KIND_HE = { q: 'מוקדמות', s: 'חצי גמר', f: 'גמר' }, ORDER = 'qsf';
// how many go on (3.12.1 SLC rule = World Climbing senior World Cups / World Championships): quals 24 (boulder in two
// groups: 12 from each), semis 8. Youth / continental formats differ → no line there rather than a wrong one.
const advOf = (ev, r, grouped) => (['wc', 'wch'].includes(ev.type) && r.cat.length === 1 ? (r.kind === 'q' ? (grouped ? 12 : 24) : r.kind === 's' ? 8 : undefined) : undefined);
const catRank = c => (c.length > 1 ? 100 - Number(c.slice(1)) : 0) * 2 + (c[0] === 'w' ? 1 : 0);
export const autoTitle = (cat, kind, grp) => `${G[cat[0]]}${cat.length > 1 ? ` U${cat.slice(1)}` : ''} · ${KIND_HE[kind]}${grp ? ` · קבוצה ${grp.toUpperCase()}` : ''}`;

// ev = the portal event (ifscPre, ifscDisc, id, schedule?, dates?) · info = /ifsc/event answer · have = ids already there
// → the missing rounds. With a schedule time: date + start in venue time. Without one: the day is a guess (quals = first
// day, later rounds = last day) → noTime + dateGuess (the round is never "over" by date alone; World Climbing's status is),
// and its start = the first day, so polling may begin as soon as the competition does.
export function planIfscRounds(ev, info, have = new Set()) {
  if (!ev?.ifscPre || !info?.rounds) return [];
  const disc = ev.ifscDisc || null, sch = ev.schedule || {};
  const first = info.start || ev.dates?.[0], last = info.end || ev.dates?.at(-1) || first;
  if (!first) return [];
  const out = [];
  for (const r of info.rounds) {
    if (disc && r.disc !== disc) continue;
    const key = `${r.cat}-${r.kind}`, at = sch[key], lead = r.disc === 'L';
    const date = at ? at.slice(0, 10) : r.kind === 'q' ? first : last;
    const base = { date, start: at ? `${at}:00` : `${first}T00:00:00`, tz: info.tz || ev.tz, ...(at ? {} : { noTime: true, dateGuess: true }),
      slotSec: 300, boulders: r.n, trailingRest: true, slots: [], event: ev.id, ifsc: true, auto: true, ...(lead ? { lead: true } : {}) };
    const parts = r.groups ? r.groups.map(g => ({ id: `${ev.ifscPre}-${key}-${g.g}`, grp: g.g, ref: g.ref, status: g.status })) : [{ id: `${ev.ifscPre}-${key}`, ref: r.ref, status: r.status }];
    for (const p of parts) {
      if (have.has(p.id)) continue;
      const adv = advOf(ev, r, !!p.grp);
      out.push({ id: p.id, title: autoTitle(r.cat, r.kind, p.grp), ...base, ifscRef: p.ref, ifscStatus: p.status, ...(p.grp ? { group: p.grp.toUpperCase() } : {}), ...(adv ? { adv } : {}) });
    }
  }
  return out;
}

// the rounds of one international event in order: by day, then start, then quals → semis → final, men before women
export function sortIntl(rounds) {
  const k = r => { const m = /-([mw]\d*)-([qsf])(?:-([a-z]))?$/.exec(r.id) || []; return [m[2] || 'q', m[1] || 'm', m[3] || '']; };
  return rounds.map((r, i) => [r, i]).sort(([a, i], [b, j]) => {
    const [ka, ca, ga] = k(a), [kb, cb, gb] = k(b);
    return a.date.localeCompare(b.date) || (a.noTime || b.noTime ? 0 : a.start.localeCompare(b.start)) || ORDER.indexOf(ka) - ORDER.indexOf(kb)
      || catRank(ca) - catRank(cb) || ga.localeCompare(gb) || i - j;
  }).map(([r]) => r);
}
