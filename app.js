(function () {
  'use strict';

  // ---- reveal on scroll ----
  document.documentElement.classList.add('js');
  var reveals = document.querySelectorAll('.reveal');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    // cards in a grid appear one after another; the delay is dropped once shown so hover stays snappy
    document.querySelectorAll('.pillars, .features, .steps').forEach(function (group) {
      Array.prototype.forEach.call(group.querySelectorAll('.reveal'), function (el, i) {
        el.style.transitionDelay = (i * 90) + 'ms';
        el.addEventListener('transitionend', function () { el.style.transitionDelay = ''; }, { once: true });
      });
    });
    reveals.forEach(function (el) { io.observe(el); });
  }

  // ---- L/U/M/A letters light up as each pillar reaches mid-screen ----
  var pillars = document.querySelectorAll('.pillar');
  if (reduce || !('IntersectionObserver' in window)) {
    pillars.forEach(function (el) { el.classList.add('is-lit'); });
  } else {
    var litIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add('is-lit'); litIo.unobserve(entry.target); }
      });
    }, { rootMargin: '-40% 0px -40% 0px' });
    pillars.forEach(function (el) { litIo.observe(el); });
  }

  // ---- count-up stats ----
  var counters = document.querySelectorAll('[data-count]');
  if (!reduce && 'IntersectionObserver' in window) {
    var countIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countIo.unobserve(entry.target);
        var el = entry.target, target = +el.getAttribute('data-count'), start = null;
        function tick(t) {
          if (start === null) start = t;
          var p = Math.min((t - start) / 1200, 1);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        }
        el.textContent = '0';
        requestAnimationFrame(tick);
        setTimeout(function () { el.textContent = target; }, 1500); // final value even if frames stall
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { countIo.observe(el); });
  }

  // ---- live feed in the hero phone ("בזמן אמת") ----
  var feed = document.getElementById('s-feed');
  if (feed && !reduce && 'IntersectionObserver' in window) {
    var updates = [
      'סיכום פגישה חדש — נועה לוי',
      'אימון כוח הושלם — עידו שגב',
      'שינוי שעה — אימון קבוצתי 17:30',
      'הערת פיזיו — יואב כהן',
      'תחרות נוספה ללוח — גביע המדינה'
    ];
    var next = 0, timer = null;
    function pushUpdate() {
      var items = feed.querySelectorAll('.s-item');
      items.forEach(function (it) { var d = it.querySelector('.dot'); if (d) d.classList.remove('dot-accent'); it.classList.remove('s-new'); });
      if (items.length >= 3) items[items.length - 1].remove();
      var item = document.createElement('div');
      item.className = 's-item s-new';
      item.innerHTML = '<i class="dot dot-accent"></i>';
      item.appendChild(document.createTextNode(updates[next]));
      next = (next + 1) % updates.length;
      feed.insertBefore(item, feed.querySelector('.s-item'));
    }
    new IntersectionObserver(function (entries) {
      var visible = entries[0].isIntersecting;
      if (visible && !timer) timer = setInterval(function () { if (!document.hidden) pushUpdate(); }, 4000);
      if (!visible && timer) { clearInterval(timer); timer = null; }
    }).observe(feed);
  }

  // ---- floating WhatsApp hides while the demo form is on screen ----
  var wa = document.querySelector('.wa-float');
  var demo = document.getElementById('demo');
  if (wa && demo && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      wa.classList.toggle('is-hidden', entries[0].isIntersecting);
    }, { threshold: 0.15 }).observe(demo);
  }

  // ---- lead form ----
  var form = document.getElementById('lead-form');
  if (!form) return;
  var submitBtn = document.getElementById('lead-submit');
  var statusEl = document.getElementById('form-status');
  var successEl = document.getElementById('form-success');
  var errorEl = document.getElementById('form-error');
  var sending = false;

  function readForm() {
    var data = {};
    ['name', 'org', 'sport', 'role', 'phone', 'email', 'notes', 'website'].forEach(function (n) {
      data[n] = form.elements[n] ? form.elements[n].value : '';
    });
    var size = form.querySelector('input[name="teamSize"]:checked');
    data.teamSize = size ? size.value : '';
    return data;
  }

  function showErrors(errors) {
    ['name', 'org', 'phone', 'email'].forEach(function (n) {
      var el = document.getElementById('err-' + n);
      var input = form.elements[n];
      var msg = errors[n] || '';
      if (el) el.textContent = msg;
      if (input) {
        input.parentNode.classList.toggle('has-error', !!msg);
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      }
    });
    var first = ['name', 'org', 'phone', 'email'].filter(function (n) { return errors[n]; })[0];
    if (first) form.elements[first].focus();
  }

  function showSuccess() {
    form.hidden = true;
    errorEl.hidden = true;
    successEl.hidden = false;
    successEl.focus();
  }

  function showFailure(err) {
    if (err) console.warn('LUMA lead submit failed:', err);
    sending = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'שליחה';
    statusEl.textContent = 'השליחה נכשלה.';
    errorEl.hidden = false;
    errorEl.focus();
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    var data = readForm();

    if (FormLogic.isBot(data)) { showSuccess(); return; }

    var result = FormLogic.validateLead(data);
    showErrors(result.errors);
    if (!result.valid) return;

    if (!LEADS_ENDPOINT_URL) { showFailure(); return; }

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'שולח…';
    errorEl.hidden = true;
    statusEl.textContent = '';

    fetch(LEADS_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(FormLogic.buildPayload(data))
    })
      .then(function (res) {
        if (!res.ok) throw new Error('bad status');
        return res.json();
      })
      .then(function (body) {
        if (!body || body.ok !== true) throw new Error('not ok');
        showSuccess();
      })
      .catch(showFailure);
  });
})();
