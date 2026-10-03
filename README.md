# LUMA — marketing site

Live: https://luma.palgitraining.com (GitHub Pages, repo `palgiroei-ai/luma`, branch `main`).
**Pushing to `main` = deploying live. Ask Roei first.**

Static HTML/CSS/JS, no build. Local preview: `python3 -m http.server 8642` → http://localhost:8642

## Tests
    node tests/test-form-logic.js
    node tests/test-backend.js gas/Code.gs

## Lead form backend
Google Sheet "LUMA – פניות" (palgitraining@gmail.com) with bound Apps Script = `gas/Code.gs`.
Web App URL is in `config.js`. Endpoint is anonymous (accepted tradeoff, same as palgi-leads);
honeypot field `website` drops bots; cells are sanitized against formula injection.
After editing `gas/Code.gs`: paste into the Apps Script editor → Deploy → Manage deployments →
edit the existing deployment → New version (keeps the same URL).

## OG image
Edit `assets/og.html`, then re-render (see plan Task 6) to `assets/og.png`.
    open http://localhost:8642/tests/browser-harness.html   # 13 scripted form/UI checks (needs local server)
