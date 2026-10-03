# LUMA — marketing site design

Date: 2026-10-03
Status: awaiting Roei's review

## 1. Purpose

LUMA (**L**ive **U**nified **M**anagement-system for **A**thletes) is the
productized version of the system built for the climbing academy at Wingate,
offered to other sports teams, federations, associations, clubs and academies
as a licensed, separately-hosted, customized instance (not a code sale).

The site has two jobs, both equally important:

1. **Lead generation** — an interested organization leaves its details / asks
   for a demo.
2. **Business card** — a link Roei sends (mostly via WhatsApp) after a call so
   the other side understands what the system does and is convinced.

Success = a decision-maker at a sports organization understands within ~30
seconds what LUMA does and why it fits them, and submits the demo form.

## 2. Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Name / brand | LUMA, "מבית PalgiTraining" |
| Content line | **Sports teams in general** — "כל הקבוצה / כל הספורטאים". The academy is only one example (case-study section). No climbing-specific wording elsewhere. |
| Slogan | **"כל הקבוצה. מערכת אחת. בזמן אמת."** |
| Language | Hebrew only, RTL. "LUMA" and the acronym line stay in English as brand elements. |
| Address | `luma.palgitraining.com` |
| Approach | Single, clean, polished static page (HTML/CSS/JS, no framework, no build step) |
| Visual direction | Direction C — in the line of the Climbing Academy logo, own colors |
| Pricing | Not on the site — "צרו קשר להצעה מותאמת" |
| App visuals | HTML/SVG mockups with fictional data only — never screenshots of the real app (sensitive athlete/medical data) |
| "Wingate-Grade" | Dropped (can't use the institute's name as a quality mark). Case study naming the academy only after Roei confirms it's OK; otherwise phrased without the name. |
| "Watch Video" | Dropped until a real video exists |

## 3. Page structure (single page, top to bottom)

1. **Top bar** — LUMA wordmark + mark (right), "בקשו הדגמה" button (left).
   Sticky, compact on mobile.
2. **Hero** — wordmark + mark, acronym line with L/U/M/A in the accent color,
   slogan (last phrase "בזמן אמת." in accent), one-line sub ("ניהול צוות,
   ספורטאים, תוכניות ולוחות זמנים — לקבוצות, נבחרות, התאחדויות ומועדונים"),
   primary CTA "בקשו הדגמה" (scrolls to form), secondary "איך זה עובד"
   (scrolls to pillars), phone mockup of the home screen. "BY PALGITRAINING"
   small label.
3. **Four pillars — L·U·M·A** — four cards, big Latin letter + Hebrew title +
   one sentence:
   - **Live — בזמן אמת:** עדכונים והתראות לטלפון ברגע שמשהו משתנה.
   - **Unified — מאוחד:** מאמנים, מאמני כושר, פיזיותרפיסטים, תזונאים
     ופסיכולוגים במערכת אחת; כל אחד רואה רק את מה שרלוונטי לו.
   - **Management — ניהול:** סגל, לוח אימונים ואירועים, אימוני קבוצה שבועיים.
   - **Athletes — ספורטאים:** תיק אישי לכל ספורטאי — תוכניות כוח, סיכומים,
     מעקב התקדמות.
4. **Capabilities** — 6–8 cards with thin-line icons, based on what the system
   really does: role-based permissions (head coach, fitness coach, physio…),
   meeting summaries with sensitivity levels, strength-training plans,
   training & events calendar, athlete tracking, manager review feed, push
   notifications, works on the phone (installable app). 2–3 cards paired with a
   phone mockup (athlete file, calendar).
5. **Who it's for + the model** (dark navy band) — teams, national squads,
   federations, associations, academies, clubs. The model: a separate instance
   per organization, adapted to the sport, isolated data, onboarding and
   ongoing support.
6. **"פועלת היום"** — short case study of the academy (example, not the
   headline). Named or anonymous per Roei's answer.
7. **Demo form** — see §5.
8. **Footer** — "LUMA מבית PalgiTraining", link to palgitraining.com, contact
   details, copyright. No product social accounts (PalgiTraining's only if Roei
   wants).

## 4. Visual system

- **Colors (tokens on `:root`):**
  - background chalk `#F5F1EA`
  - ink / primary deep navy `#14243B` (text, primary button, dark bands)
  - accent copper `#C0743A` — used sparingly: L/U/M/A letters, numbers, icons,
    key phrase in hero
  - surfaces: white cards with a thin warm border (e.g. `#E4DCCF`)
  - text on navy bands: chalk
  - copper on navy has low contrast for small text → on dark bands copper is
    used only for large/decorative elements
- **Type:** Jost (500, uppercase, wide letter-spacing ~0.3em) for the LUMA
  wordmark and English labels; Heebo for all Hebrew (body 400, headings
  700–800). Google Fonts.
- **Mark (temporary):** thin-stroke pulse line inside a circle (navy stroke,
  copper circle), same stroke weight as the icons. A proper logo can come later.
- **Icons:** thin-line, consistent stroke, inline SVG.
- **Motion:** subtle reveal on scroll (IntersectionObserver), gentle hover on
  cards/buttons. `prefers-reduced-motion` → everything static and visible.
- **Layout:** mobile-first (most visits come from WhatsApp links); 16px side
  gutter on phones, no horizontal scroll; 1–2 dark bands to give rhythm.
- **Theme:** light only (brand is chalk-based); `body` has an explicit
  background.

## 5. Demo form + backend

- Reference pattern: `palgi-leads` (vanilla JS + standalone Apps Script).
- **Fields:** שם*, ארגון / קבוצה*, ענף, תפקיד, גודל קבוצה (ranges: עד 20 /
  20–50 / 50–150 / 150+), טלפון*, מייל, הערות. (* = required)
- **Validation:** client-side required + Israeli phone format; email format if
  filled.
- **Spam:** honeypot hidden field; submissions with it filled are dropped
  silently (client and server).
- **Backend:** new standalone Google Sheet "LUMA – פניות" + bound Apps Script
  Web App under palgitraining@gmail.com. `doPost` appends a row (timestamp +
  fields) and emails a notification to palgiroei@gmail.com. Endpoint is
  anonymous (same accepted tradeoff as palgi-leads).
- **UX:** submit button shows a loading state; success → thank-you message in
  place of the form; failure → error message + WhatsApp button to Roei as a
  fallback.
- Endpoint URL lives in `config.js`.

## 6. Repo, hosting, domain

- Local: `~/claude-projects/luma-site`. Remote: new repo `palgiroei-ai/luma`,
  GitHub Pages from `main`.
- Files: `index.html`, `style.css`, `app.js`, `config.js`, `formLogic.js`,
  `assets/` (mark SVG, favicon, OG image), `gas/Code.gs`, `tests/`, `CNAME`
  (`luma.palgitraining.com`).
- DNS: Namecheap CNAME record `luma` → `palgiroei-ai.github.io`.
- ⚠️ This GitHub account auto-serves new Pages repos under
  `palgitraining.com/<repo>/`. Order: commit `CNAME` **before** enabling Pages;
  enabling Pages / pushing = going live → **ask Roei first**.
- Link from the main site: small footer link on palgitraining.com
  ("LUMA – מערכת לניהול קבוצות ספורט"). That repo's push is a live deploy →
  ask first.
- SEO/sharing: `<title>`, meta description, OG tags + OG image (WhatsApp
  preview), favicon, `lang="he" dir="rtl"`.

## 7. Testing

- Node tests for form logic (validation, honeypot, payload shape) and the
  Apps Script `doPost` (row append, email, honeypot drop), following
  palgi-leads' test style.
- Visual check desktop + mobile widths + reduced-motion.
- One real end-to-end submission after backend deploy, then delete the test
  row.

## 8. Out of scope (for now)

Video, pricing, English version, analytics, multi-page site, final logo.

## 9. Open items needing Roei

1. OK to name the academy / Wingate in the case-study section?
2. Contact details for the footer (phone / email / WhatsApp number for the
   fallback).
3. Include PalgiTraining social links in the footer or not.
