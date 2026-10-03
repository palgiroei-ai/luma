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

  try {
    appendLeadRow_(data);
  } catch (err) {
    console.error('appendLeadRow_ failed: ' + err);
    return json_({ ok: false, error: 'server_error' });
  }
  try {
    sendLeadNotification_(data);
  } catch (err) {
    // The row is saved; an error response here would make the client resubmit and duplicate it.
    console.error('sendLeadNotification_ failed: ' + err);
  }
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

function appendLeadRow_(d) {
  getSheet_().appendRow([
    new Date(),
    textCell_(d.name),
    textCell_(d.org),
    textCell_(d.sport),
    textCell_(d.role),
    textCell_(d.teamSize),
    textCell_(d.phone),
    textCell_(d.email),
    textCell_(d.notes)
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
