(function (root) {
  'use strict';

  var TEAM_SIZES = ['עד 20', '20–50', '50–150', '150+'];
  var FIELDS = ['name', 'org', 'sport', 'role', 'teamSize', 'phone', 'email', 'notes', 'website'];

  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function normalizePhone(phone) {
    if (typeof phone !== 'string') return '';
    var digits = phone.replace(/[\s\-().]/g, '');
    if (digits.indexOf('+972') === 0) digits = '0' + digits.slice(4);
    else if (digits.indexOf('972') === 0 && digits.length >= 11) digits = '0' + digits.slice(3);
    return digits;
  }

  function validatePhone(phone) {
    return /^0\d{8,9}$/.test(normalizePhone(phone));
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(email));
  }

  function validateLead(data) {
    data = data || {};
    var errors = {};
    if (str(data.name).length < 2) errors.name = 'נא למלא שם';
    if (str(data.org).length < 2) errors.org = 'נא למלא ארגון או קבוצה';
    if (!validatePhone(data.phone)) errors.phone = 'נא למלא מספר טלפון תקין';
    if (str(data.email) !== '' && !validateEmail(data.email)) errors.email = 'כתובת המייל לא תקינה';
    return { valid: Object.keys(errors).length === 0, errors: errors };
  }

  function isBot(data) {
    return !!data && str(data.website) !== '';
  }

  function buildPayload(data) {
    data = data || {};
    var out = {};
    FIELDS.forEach(function (f) { out[f] = str(data[f]); });
    out.phone = normalizePhone(out.phone);
    return out;
  }

  var FormLogic = {
    TEAM_SIZES: TEAM_SIZES,
    normalizePhone: normalizePhone,
    validatePhone: validatePhone,
    validateEmail: validateEmail,
    validateLead: validateLead,
    isBot: isBot,
    buildPayload: buildPayload
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FormLogic;
  } else {
    root.FormLogic = FormLogic;
  }
})(typeof window !== 'undefined' ? window : this);
