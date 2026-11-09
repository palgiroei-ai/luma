// 3.32.0 (Roei 2026-11-09): athletes the coach marked by hand (blue, `added`) are not "mine" for the home screen and the
// climbing-overlap counts — only Hub athletes are. They still show (blue) on the board, lists and the "שלי" cards,
// and get alerts unless settings.alertsAdded is off.
export const hubOnly = list => list.filter(m => !m.added);
export const alertable = (list, alertsAdded) => (alertsAdded === false ? hubOnly(list) : list);
