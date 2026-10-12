// "Add to home screen" guide — ported from Wingate's (src/JavaScript.html install_*, 2026-10-07): a drawn phone
// loops through the real taps and highlights the matching step; full written list folded below.
// Opens from the gate ("איך מוסיפים…"), settings (row hidden when already installed) and the lock-screen page.
// Coach gets a 6th step (lock-screen alerts); viewers (parents) stop at 5. Android Chrome: one-tap "התקן עכשיו".

const APP_URL = 'luma.palgitraining.com/comps';
let deferredPrompt = null, timer = null, isViewer = () => false;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
addEventListener('appinstalled', () => { deferredPrompt = null; });

export function installPlatform() {
  const ua = navigator.userAgent || '';
  if (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) return 'installed';
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

const ICONS = {
  share: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M8 7l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5v9h14v-9h-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plusSquare: '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 18.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

const STEPS = {
  ios: [
    ['phone', `פותחים את <b dir="ltr">${APP_URL}</b> ב-<b>Safari</b>.`],
    ['share', 'לוחצים על <b>כפתור השיתוף</b>: באייפד למעלה ליד שורת הכתובת, באייפון בסרגל התחתון. אם לא רואים אותו, לוחצים קודם על <b>⋯</b>.'],
    ['plusSquare', 'גוללים מטה בתפריט ובוחרים <b>"הוספה למסך הבית"</b>.'],
    [null, 'לוחצים <b>"הוסף"</b> בפינה העליונה.'],
    [null, 'מעכשיו פותחים <b>מהאייקון במסך הבית</b>. בפתיחה הראשונה מזינים שוב את קוד הכניסה.'],
    [null, 'להתראות על מסך נעול: <b>⚙︎</b> ← <b>התראות על מסך נעול</b> ← מדליקים את המתג ומאשרים ב-<b>"אפשר"</b>. עובד רק מהאייקון.'],
  ],
  android: [
    ['phone', `פותחים את <b dir="ltr">${APP_URL}</b> ב-<b>Chrome</b>.`],
    ['dots', 'לוחצים על <b>⋮</b> (שלוש הנקודות) בפינה העליונה.'],
    ['plusSquare', 'בוחרים <b>"התקנת אפליקציה"</b> או <b>"הוספה למסך הבית"</b>.'],
    [null, 'מאשרים ב-<b>"התקנה"</b> / <b>"הוספה"</b>.'],
    [null, 'האייקון יופיע במסך הבית. פותחים ממנו ומזינים שוב את קוד הכניסה.'],
  ],
};

// Finger targets are % of the phone screen (measured in WebKit for Wingate's identical mock).
const FLOWS = {
  ios: [
    { s: 'page', f: [50, 55], step: 1, ms: 1500 },
    { s: 'page', f: [50, 95.5], tap: true, step: 2, ms: 1500 },
    { s: 'share', f: [62, 86.5], step: 3, ms: 1300 },
    { s: 'share-tap', f: [62, 86.5], tap: true, step: 3, ms: 700 },
    { s: 'add', f: [14.4, 9.4], step: 4, ms: 1300 },
    { s: 'add-tap', f: [14.4, 9.4], tap: true, step: 4, ms: 700 },
    { s: 'home', f: null, step: 5, ms: 1600 },
    { s: 'home', f: [11.7, 26.4], step: 5, ms: 1100 },
    { s: 'home-tap', f: [11.7, 26.4], tap: true, step: 5, ms: 700 },
    { s: 'app', f: [50, 29.2], step: 6, ms: 1300 },
    { s: 'app-tap', f: [50, 29.2], tap: true, step: 6, ms: 700 },
    { s: 'perm', f: [30.2, 54.8], step: 6, ms: 1300 },
    { s: 'perm-tap', f: [30.2, 54.8], tap: true, step: 6, ms: 700 },
    { s: 'on', f: null, step: 6, ms: 2600 },
  ],
  android: [
    { s: 'page', f: [50, 55], step: 1, ms: 1500 },
    { s: 'page', f: [7.8, 7.9], tap: true, step: 2, ms: 1500 },
    { s: 'menu', f: [37.2, 28.6], step: 3, ms: 1300 },
    { s: 'menu-tap', f: [37.2, 28.6], tap: true, step: 3, ms: 700 },
    { s: 'dialog', f: [24.8, 54.3], step: 4, ms: 1300 },
    { s: 'dialog-tap', f: [24.8, 54.3], tap: true, step: 4, ms: 700 },
    { s: 'home', f: null, step: 5, ms: 2800 },
  ],
};

function animHtml(tab) {
  const icon = '<img src="icon-180.png" alt="">';
  const line = c => `<div class="ia-line${c ? ' ' + c : ''}"></div>`;
  const page = `<div class="ia-page"><div class="ia-pgbar">${icon}<b>מעקב ראונד</b></div><div class="ia-hello">ליגת העל בולדר</div>` +
    `<div class="ia-card">${line('')}${line('s')}${line('t')}</div><div class="ia-card">${line('')}${line('s')}</div><div class="ia-card">${line('s')}${line('t')}</div></div>`;
  const home = `<div class="ia-layer ia-home"><div class="ia-grid">${'<div class="ia-app"><i></i><span></span></div>'.repeat(7)}` +
    `<div class="ia-app ia-new">${icon}<em>מעקב ראונד</em></div></div></div>`;
  let body;
  if (tab === 'ios') {
    body = page +
      `<div class="ia-safari"><div class="ia-url">${APP_URL}</div><div class="ia-tools">` +
        '<svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '<svg viewBox="0 0 24 24" fill="none" opacity=".35"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        ICONS.share +
        '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h6a2 2 0 012 2v12a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v12a2 2 0 012-2h6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>' +
        '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="7" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 4h10a2 2 0 012 2v10" stroke="currentColor" stroke-width="1.8"/></svg>' +
      '</div></div><div class="ia-dim"></div>' +
      `<div class="ia-layer ia-sheet"><div class="ia-grab"></div><div class="ia-apphead">${icon}<div>מעקב ראונד<small>${APP_URL}</small></div></div>` +
        `<div class="ia-list"><div class="ia-row">העתקה</div><div class="ia-row">הוספה לרשימת קריאה</div><div class="ia-row ia-hit">הוספה למסך הבית${ICONS.plusSquare}</div><div class="ia-row">הדפסה</div></div></div>` +
      `<div class="ia-layer ia-addpage"><div class="ia-top"><span>ביטול</span><b>הוספה למסך הבית</b><span class="ia-add">הוסף</span></div><div class="ia-addcard">${icon}<div>מעקב ראונד</div></div></div>` +
      home +
      `<div class="ia-layer ia-standalone"><div class="ia-pgbar">${icon}<b>מעקב ראונד</b><span class="ia-gear">⚙</span></div>` +
        '<div class="ia-set"><h5>התראות על מסך נעול</h5><span class="ia-pill ia-pill-off">כבוי</span><span class="ia-pill ia-pill-on">✓ פעיל</span><div class="ia-enable">הפעל התראות</div></div>' +
        `<div class="ia-card">${line('')}${line('s')}</div>` +
        '<div class="ia-perm-dim"></div><div class="ia-perm"><b>״מעקב ראונד״ מבקש לשלוח לך הודעות</b><p>הודעות יכולות לכלול התראות, צלילים ותגים.</p><div class="ia-perm-btns"><span>אל תאפשר</span><span class="ia-allow">אפשר</span></div></div>' +
      '</div>';
  } else {
    body = `<div class="ia-chrome"><div class="ia-url">${APP_URL}</div><div class="ia-kebab">${ICONS.dots}</div></div>` + page + '<div class="ia-dim"></div>' +
      `<div class="ia-layer ia-menu"><div class="ia-row">כרטיסייה חדשה</div><div class="ia-row">היסטוריה</div><div class="ia-row">הורדות</div><div class="ia-row ia-hit">${ICONS.phone}התקנת אפליקציה</div><div class="ia-row">הגדרות</div></div>` +
      `<div class="ia-layer ia-dialog"><h4>התקנת אפליקציה</h4><div class="ia-who">${icon}<div>מעקב ראונד<small>${APP_URL}</small></div></div><div class="ia-btns"><span>ביטול</span><span class="ia-ok">התקנה</span></div></div>` +
      home;
  }
  return `<div class="install-anim" aria-hidden="true"><div class="ia-phone ia-${tab}" id="install-anim-phone" data-s="page"><div class="ia-screen"><div class="ia-notch"></div>${body}<div class="ia-finger"></div></div></div></div>`;
}

const stepsFor = tab => (tab === 'ios' && isViewer() ? STEPS.ios.slice(0, 5) : STEPS[tab]);
const flowFor = tab => (tab === 'ios' && isViewer() ? FLOWS.ios.filter(st => st.step <= 5) : FLOWS[tab]);
const stepHtml = (n, icon, html) => `<li class="install-step"><span class="install-step-num">${n}</span><span class="install-step-text">${html}</span>${icon ? `<span class="install-step-icon">${ICONS[icon]}</span>` : ''}</li>`;
const capHtml = (n, li) => `<span class="install-step-num">${n}</span><span>${li.querySelector('.install-step-text').innerHTML}</span>`;

function guideHtml(platform, tab) {
  const intro = platform === 'installed' ? '<p class="install-note install-ok">✓ האפליקציה כבר פתוחה מהאייקון במסך הבית.</p>'
    : platform === 'other' ? `<p class="install-note">את השלבים עושים באייפד או בטלפון: פותחים בו את <b dir="ltr">${APP_URL}</b>.</p>` : '';
  const tabs = `<div class="install-tabs">${[['ios', 'אייפד / אייפון'], ['android', 'אנדרואיד']].map(([k, l]) =>
    `<button type="button" class="segmented-option${tab === k ? ' active' : ''}" data-install-tab="${k}">${l}</button>`).join('')}</div>`;
  const steps = `<ol class="install-steps">${stepsFor(tab).map(([icon, html], i) => stepHtml(i + 1, icon, html)).join('')}</ol>`;
  return `<button type="button" class="install-close-btn" id="install-close-btn" aria-label="סגירה">✕</button>` +
    '<h2>הוספה למסך הבית</h2>' + intro + tabs + animHtml(tab) +
    '<p class="install-anim-cap" id="install-anim-cap" aria-live="polite"></p><div class="install-anim-dots" id="install-anim-dots"></div>' +
    (tab === 'android' && deferredPrompt ? '<button type="button" class="btn btn-primary install-now-btn" id="install-now-btn">התקן עכשיו</button>' : '') +
    `<details class="install-all-steps"><summary>כל השלבים בכתב</summary>${steps}</details>`;
}

// Shrinks the drawn phone (never above its 0.8 design size) so the whole card fits the screen height.
function fitAnim(card) {
  const wrap = card.querySelector('.install-anim'), phone = card.querySelector('#install-anim-phone');
  if (!wrap || !phone || !innerHeight) return;
  const rest = card.offsetHeight - wrap.offsetHeight;
  const h = Math.max(240, Math.min(384, innerHeight - 32 - rest - 8));
  wrap.style.height = h + 'px'; phone.style.transform = `scale(${h / 480})`;
}

function stopAnim() { clearTimeout(timer); timer = null; }

function startAnim(tab, card) {
  stopAnim();
  const phone = card.querySelector('#install-anim-phone'), flow = flowFor(tab);
  const finger = phone.querySelector('.ia-finger'), steps = card.querySelectorAll('.install-step');
  const cap = card.querySelector('#install-anim-cap'), dots = card.querySelector('#install-anim-dots');
  dots.innerHTML = [...steps].map(() => '<i></i>').join('');
  // reserve the tallest step's height so the phone never jumps between 1-line and 3-line steps
  let tallest = 0;
  steps.forEach((li, k) => { cap.innerHTML = capHtml(k + 1, li); tallest = Math.max(tallest, cap.offsetHeight); });
  if (tallest) cap.style.minHeight = tallest + 'px';
  fitAnim(card);
  let i = 0;
  const tick = () => {
    if (!phone.isConnected) return;
    const st = flow[i];
    phone.dataset.s = st.s;
    steps.forEach((li, k) => li.classList.toggle('active', k + 1 === st.step));
    cap.innerHTML = capHtml(st.step, steps[st.step - 1]);
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k + 1 === st.step));
    finger.classList.remove('tap');
    if (st.f) {
      Object.assign(finger.style, { opacity: '1', left: st.f[0] + '%', top: st.f[1] + '%' });
      if (st.tap) setTimeout(() => finger.classList.add('tap'), Math.max(0, st.ms - 450));
    } else finger.style.opacity = '0';
    i = (i + 1) % flow.length;
    timer = setTimeout(tick, st.ms);
  };
  tick();
}

// A modal <dialog> so it sits above the settings dialog (top layer).
export function openInstallGuide(tab) {
  const platform = installPlatform();
  tab = tab || (platform === 'android' ? 'android' : 'ios');
  let dlg = document.getElementById('install-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog'); dlg.id = 'install-dlg'; dlg.className = 'install-overlay-card';
    dlg.setAttribute('aria-label', 'הוספה למסך הבית');
    dlg.addEventListener('click', e => {
      if (e.target === dlg) { dlg.close(); return; }
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'install-close-btn') dlg.close();
      else if (b.dataset.installTab) openInstallGuide(b.dataset.installTab);
      else if (b.id === 'install-now-btn' && deferredPrompt) {
        const p = deferredPrompt; p.prompt();
        p.userChoice.then(c => { deferredPrompt = null; if (c?.outcome === 'accepted') dlg.close(); else openInstallGuide('android'); }, () => {});
      }
    });
    dlg.addEventListener('close', stopAnim);
    document.body.append(dlg);
  }
  dlg.innerHTML = guideHtml(platform, tab);
  if (!dlg.open) dlg.showModal();
  startAnim(tab, dlg);
}

// Any element with data-install-open opens the guide (gate link, settings row, lock-screen page).
export function setupInstall(viewerFn) {
  isViewer = viewerFn;
  document.addEventListener('click', e => { if (e.target.closest('[data-install-open]')) { e.preventDefault(); openInstallGuide(); } });
  const installed = installPlatform() === 'installed';
  document.querySelectorAll('[data-install-open]').forEach(el => { if (installed) el.hidden = true; });
}
