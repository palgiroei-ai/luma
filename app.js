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
    reveals.forEach(function (el) { io.observe(el); });
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
  }

  function showFailure() {
    sending = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'שליחה';
    statusEl.textContent = '';
    errorEl.hidden = false;
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
