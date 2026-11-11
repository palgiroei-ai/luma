var SHEET_NAME = 'Leads';
var HEADERS = ['תאריך', 'שם', 'ארגון', 'ענף', 'תפקיד', 'גודל קבוצה', 'טלפון', 'מייל', 'הערות', 'אישור עדכונים'];
// Privacy policy promise: leads are kept up to 24 months, then deleted (purged on every new submission).
var RETENTION_MONTHS = 24;
// Abuse guard: at most this many accepted submissions per minute (the endpoint is anonymous).
var MAX_PER_MINUTE = 10;
var NOTIFY_TO = 'palgiroei@gmail.com';

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_request' });
  }
  if (!data || typeof data !== 'object') return json_({ ok: false, error: 'bad_request' });
  if (data.website && String(data.website).trim() !== '') return json_({ ok: true });
  if (!data.name || !data.org || !data.phone) return json_({ ok: false, error: 'missing_fields' });
  if (!validPhone_(data.phone) || (data.email && !validEmail_(data.email))) return json_({ ok: false, error: 'invalid_fields' });
  if (rateLimited_()) return json_({ ok: false, error: 'rate_limited' });

  try {
    appendLeadRow_(data);
  } catch (err) {
    console.error('appendLeadRow_ failed: ' + err);
    return json_({ ok: false, error: 'server_error' });
  }
  try {
    purgeOldLeads_(getSheet_(), new Date());
  } catch (err) {
    console.error('purgeOldLeads_ failed: ' + err);
  }
  try {
    sendLeadNotification_(data);
  } catch (err) {
    // The row is saved; an error response here would make the client resubmit and duplicate it.
    console.error('sendLeadNotification_ failed: ' + err);
  }
  return json_({ ok: true });
}

function validPhone_(v) {
  var digits = String(v).replace(/[\s\-().+]/g, '');
  return /^\d{9,15}$/.test(digits);
}

function validEmail_(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) && String(v).length <= 254;
}

function rateLimited_() {
  if (typeof CacheService === 'undefined') return false;
  try {
    var cache = CacheService.getScriptCache();
    var key = 'n' + Math.floor(Date.now() / 60000);
    var n = Number(cache.get(key) || 0);
    if (n >= MAX_PER_MINUTE) return true;
    cache.put(key, String(n + 1), 120);
  } catch (err) {
    console.error('rateLimited_ failed: ' + err);
  }
  return false;
}

// Rows are appended in time order, so the expired ones are a block right under the header.
function purgeOldLeads_(sheet, now) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var cutoff = new Date(now.getTime());
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  var dates = sheet.getRange(2, 1, last - 1, 1).getValues();
  var n = 0;
  while (n < dates.length && dates[n][0] instanceof Date && dates[n][0] < cutoff) n++;
  if (n > 0) sheet.deleteRows(2, n);
  return n;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeCell_(value) {
  var s = String(value === undefined || value === null ? '' : value).slice(0, 1000);
  return /^[=+\-@]/.test(s) ? "'" + s.slice(0, 999) : s;
}

// appendRow parses values like typed input ("0507…" -> number, "1/2" -> date).
// A leading apostrophe forces plain text; Sheets hides it.
function textCell_(value) {
  var s = sanitizeCell_(value);
  if (s === '') return '';
  return s.charAt(0) === "'" ? s : "'" + s;
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function setupSheet() {
  var sheet = getSheet_();
  if (sheet.getRange(1, 1).getValue() === '') {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

// The consent column was added later: make sure an existing sheet gets its header.
function ensureConsentHeader_(sheet) {
  var col = HEADERS.length;
  var cell = sheet.getRange(1, col);
  if (cell.getValue() === '') cell.setValue(HEADERS[col - 1]).setFontWeight('bold');
}

function appendLeadRow_(d) {
  var sheet = getSheet_();
  try { ensureConsentHeader_(sheet); } catch (err) { console.error('ensureConsentHeader_ failed: ' + err); }
  sheet.appendRow([
    new Date(),
    textCell_(d.name),
    textCell_(d.org),
    textCell_(d.sport),
    textCell_(d.role),
    textCell_(d.teamSize),
    textCell_(d.phone),
    textCell_(d.email),
    textCell_(d.notes),
    d.marketing === 'כן' ? 'כן' : 'לא'
  ]);
}

function buildLeadEmailBody_(d) {
  return [
    'פנייה חדשה מאתר LUMA:',
    '',
    'שם: ' + d.name,
    'ארגון / קבוצה: ' + d.org,
    'ענף: ' + (d.sport || '-'),
    'תפקיד: ' + (d.role || '-'),
    'גודל קבוצה: ' + (d.teamSize || '-'),
    'טלפון: ' + d.phone,
    'מייל: ' + (d.email || '-'),
    'הערות: ' + (d.notes || '-'),
    'אישור לקבלת עדכונים: ' + (d.marketing === 'כן' ? 'כן' : 'לא')
  ].join('\n');
}

function sendLeadNotification_(d) {
  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: 'LUMA – פנייה חדשה: ' + d.org,
    body: buildLeadEmailBody_(d)
  });
}
