// Round picker inside an event (portal consistency round, Task 5): the rounds of one event grouped by day.
import { stateAt, roundStart, dayIn } from './engine.js';
import { roundTitle, hm } from './labels.js';

// default status = the app's notion for a timed round: running window → live, window over → done, otherwise (also no start list) soon
const defaultPhase = (r, now, off) => {
  if (r.ifsc) return r.date < dayIn(now) ? 'after' : now >= roundStart(r) ? 'live' : 'before';
  return r.slots.length ? stateAt(r, now, off(r.id)).phase : 'wait';
};
const STATUS = { live: 'live', after: 'done', before: 'soon', wait: 'soon' };

// → [{ day: 'YYYY-MM-DD', items: [{ id, title, time, status: 'live'|'done'|'soon', count }] }], days and rounds by start time.
// opts.phaseOf(r) → 'live'|'before'|'after'|'wait' (the app passes its own, which knows the live international data);
// opts.off(id) → the round's calibration offset (ms).
export function roundPickList(ev, rounds, now, mineCount = () => 0, opts = {}) {
  const off = opts.off || (() => 0), phaseOf = opts.phaseOf || (r => defaultPhase(r, now, off));
  const mine = (rounds || []).filter(r => (r.event || 'bl1') === ev?.id)
    .sort((a, b) => roundStart(a) - roundStart(b));
  const days = [];
  for (const r of mine) {
    const day = r.ifsc && !r.noTime ? dayIn(roundStart(r)) : r.date;
    let g = days.find(x => x.day === day);
    if (!g) days.push(g = { day, items: [] });
    g.items.push({
      id: r.id, title: roundTitle(r.title), status: STATUS[phaseOf(r)] || 'soon', count: mineCount(r.id) || 0,
      time: r.ifsc && r.noTime ? '' : hm(roundStart(r) + (r.ifsc ? 0 : off(r.id))),
    });
  }
  return days.sort((a, b) => (a.day < b.day ? -1 : 1));
}
