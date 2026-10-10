
## Climbing Academy guides (2026-10-09)
`guides/climbing-academy/athlete.html` and `coach.html` (personal coach): animated walkthroughs of the
Climbing Academy Hub app — real app screenshots (fictional sample data) inside a phone, a finger showing
each tap, a Hebrew caption per step, chapters and a "try it yourself" mode. Self-contained (images are
data: URIs, ~2–2.5MB each). Generated from the app by the capture/build scripts kept with the app
(palgiroei-ai/wingate-academy-hub); regenerate there when the app's screens change.

## Site: "נסו בעצמכם" instead of drawn phones (2026-10-10)
Roei: the site was too long and the three drawn demo phones (hero + two showcases) added little. Removed all three
(their CSS and the hero live-feed script too). Hero = text only. Features 9 → 6 cards (3 columns on desktop) + the wide
"פיתוח והתאמה אישית" card. New section `#try` "ככה זה נראה באמת": two cards (coach / athlete) with a real screenshot
(`assets/demo/*.jpg`, taken from the guides, fictional data) linking to `guides/climbing-academy/*.html?demo`.
The Climbing Academy case card links to `#try`; the top nav has "נסו בעצמכם" instead of "יכולות".
- **`?demo` in the guides:** a small script at the end of each guide swaps the bar label, `h1`, intro and title to
  "הדגמה: צד המאמן / הספורטאי" for visitors coming from the site. The guides are generated files: if they are rebuilt
  from the app repo (branch guide-tools), add this script back (or add it to the generator).

- **2026-10-10 polish:** hero proof line (`.hero-proof`, "פועלת היום באקדמיית הטיפוס…"); every `.section-head` is
  centered (Roei chose centered over all-right); smaller gap under the hero. In `?demo` mode the guides also get a
  "שיחת היכרות" button in the top bar (→ `https://luma.palgitraining.com/#demo`) and, where it fits without scrolling
  (desktop), a line under the last step. Part of the same `?demo` script — keep it if the guides are regenerated.
- **CTA wording (Roei, 2026-10-10):** "בקשו הדגמה" → "קבעו שיחת היכרות" (hero, form heading/text), "שיחת היכרות"
  in the top bar and the guides' demo bar — so "הדגמה" only means the self-serve animated demos ("פתחו הדגמה").
