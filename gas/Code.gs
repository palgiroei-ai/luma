var SHEET_NAME = 'Leads';
var HEADERS = ['תאריך', 'שם', 'ארגון', 'ענף', 'תפקיד', 'גודל קבוצה', 'טלפון', 'מייל', 'הערות'];
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

  appendLeadRow_(data);
  sendLeadNotification_(data);
  return json_({ ok: true });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeCell_(value) {
  var s = String(value === undefined || value === null ? '' : value).slice(0, 1000);
  return /^[=+\-@]/.test(s) ? "'" + s.slice(0, 999) : s;
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

function appendLeadRow_(d) {
  getSheet_().appendRow([
    new Date(),
    sanitizeCell_(d.name),
    sanitizeCell_(d.org),
    sanitizeCell_(d.sport),
    sanitizeCell_(d.role),
    sanitizeCell_(d.teamSize),
    sanitizeCell_(d.phone),
    sanitizeCell_(d.email),
    sanitizeCell_(d.notes)
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
    'הערות: ' + (d.notes || '-')
  ].join('\n');
}

function sendLeadNotification_(d) {
  MailApp.sendEmail({
    to: NOTIFY_TO,
    subject: 'LUMA – פנייה חדשה: ' + d.org,
    body: buildLeadEmailBody_(d)
  });
}
