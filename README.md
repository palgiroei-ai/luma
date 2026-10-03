# LUMA — marketing site

Live: https://luma.palgitraining.com (GitHub Pages, repo `palgiroei-ai/luma`, branch `main`).
**Pushing to `main` = deploying live. Ask Roei first.**

Static HTML/CSS/JS, no build. Local preview: `python3 -m http.server 8642` → http://localhost:8642

## Tests
    node tests/test-form-logic.js
    node tests/test-backend.js gas/Code.gs
    open http://localhost:8642/tests/browser-harness.html   # 13 scripted form/UI checks (needs local server)

## Lead form backend
Google Sheet "LUMA – פניות" (palgitraining@gmail.com) with bound Apps Script = `gas/Code.gs`.
Web App URL is in `config.js`.
Sheet id `1GSzXOulhVF1qSkETf7hkC1DFsSDkxvm7fPI_GtMW83I`, scriptId `1AvIjpXE9CdzwgY8MhaiHamiv1ufLrYkjAzFleD_s_R4fUiz_5FL9wsfn`,
deploymentId `AKfycbwEHvcs4hvE2qfsQtm83u28nHxZN04uB-J5DCIApLQWT0GM4hq2EPeqfyYy1g6d9ybl`.
Programmatic redeploy works (gws script projects updateContent → versions create → deployments update). Endpoint is anonymous (accepted tradeoff, same as palgi-leads);
honeypot field `website` drops bots; cells are sanitized against formula injection.
After editing `gas/Code.gs`: paste into the Apps Script editor → Deploy → Manage deployments →
edit the existing deployment → New version (keeps the same URL).

## OG image
Edit `assets/og.html`, then re-render (see plan Task 6) to `assets/og.png`.
