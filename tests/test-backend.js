var fs = require('fs');
var vm = require('vm');

function loadGas(file) {
  var appendedRows = [];
  var sentEmails = [];
  var headerRow = null;
  var fakeSheet = {
    appendRow: function (row) { appendedRows.push(row); },
    getRange: function () {
      return {
        getValue: function () { return headerRow ? headerRow[0] : ''; },
        setValues: function (v) { headerRow = v[0]; return this; },
        setFontWeight: function () { return this; }
      };
    },
    setFrozenRows: function () {}
  };
  var fakeSpreadsheet = {
    getSheetByName: function (name) { return name === 'Leads' ? fakeSheet : null; },
    insertSheet: function () { return fakeSheet; }
  };
  var sandbox = {
    SpreadsheetApp: { getActiveSpreadsheet: function () { return fakeSpreadsheet; } },
    MailApp: { sendEmail: function (o) { sentEmails.push(o); } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (t) { return { _text: t, setMimeType: function () { return this; } }; }
    },
    Date: Date, JSON: JSON, String: String
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  return { sb: sandbox, rows: appendedRows, mails: sentEmails, header: function () { return headerRow; } };
}

var file = process.argv[2] || 'gas/Code.gs';
var fails = 0;
function check(name, cond, detail) {
  console.log((cond ? '✓ ' : '✗ FAIL ') + name + (cond ? '' : ' — ' + detail));
  if (!cond) fails++;
}
function post(ctx, body) {
  var res = ctx.sb.doPost({ postData: { contents: body } });
  return JSON.parse(res._text);
}

var lead = {
  name: 'דנה כהן', org: 'הפועל ירושלים כדורסל', sport: 'כדורסל', role: 'מנהלת מקצועית',
  teamSize: '20–50', phone: '0501234567', email: 'dana@example.com', notes: 'מעוניינת בהדגמה', website: ''
};

// happy path
var ctx = loadGas(file);
var out = post(ctx, JSON.stringify(lead));
check('valid lead returns ok:true', out.ok === true, JSON.stringify(out));
check('valid lead appends one row', ctx.rows.length === 1, 'rows=' + ctx.rows.length);
var row = ctx.rows[0] || [];
check('row[0] is a Date', row[0] instanceof Date);
check('row columns in spec order',
  JSON.stringify(row.slice(1)) === JSON.stringify([lead.name, lead.org, lead.sport, lead.role, lead.teamSize, lead.phone, lead.email, lead.notes]),
  JSON.stringify(row.slice(1)));
check('valid lead sends one email', ctx.mails.length === 1);
var mail = ctx.mails[0] || {};
check('email goes to Roei', mail.to === 'palgiroei@gmail.com');
check('email subject has org name', (mail.subject || '').indexOf(lead.org) !== -1, mail.subject);
check('email body has phone and name', (mail.body || '').indexOf(lead.phone) !== -1 && mail.body.indexOf(lead.name) !== -1);

// Review Focus 1: formula injection
ctx = loadGas(file);
var evil = JSON.parse(JSON.stringify(lead));
evil.notes = '=HYPERLINK("http://x","y")';
evil.org = '+קבוצה';
post(ctx, JSON.stringify(evil));
check('notes starting with = are prefixed with apostrophe', ctx.rows[0][8] === "'" + evil.notes, ctx.rows[0][8]);
check('org starting with + is prefixed', ctx.rows[0][2] === "'+קבוצה", ctx.rows[0][2]);
check('sanitizeCell_ prefixes - and @', ctx.sb.sanitizeCell_('-1') === "'-1" && ctx.sb.sanitizeCell_('@a') === "'@a");
check('sanitizeCell_ leaves normal text', ctx.sb.sanitizeCell_('שלום') === 'שלום');
check('sanitizeCell_ truncates to 1000 chars', ctx.sb.sanitizeCell_(new Array(1500).join('א')).length === 1000);
check('sanitizeCell_ turns undefined into empty string', ctx.sb.sanitizeCell_(undefined) === '');

// Review Focus 2: malformed / partial
ctx = loadGas(file);
out = post(ctx, '{not json');
check('bad JSON returns ok:false bad_request', out.ok === false && out.error === 'bad_request', JSON.stringify(out));
out = post(ctx, JSON.stringify({ name: 'דנה' }));
check('missing org/phone returns missing_fields', out.ok === false && out.error === 'missing_fields', JSON.stringify(out));
var noBody = JSON.parse(ctx.sb.doPost({})._text);
check('missing postData returns bad_request', noBody.ok === false && noBody.error === 'bad_request');
check('malformed requests append nothing', ctx.rows.length === 0);
check('malformed requests send no email', ctx.mails.length === 0);

// Review Focus 4: honeypot
ctx = loadGas(file);
var bot = JSON.parse(JSON.stringify(lead));
bot.website = 'http://spam.example';
out = post(ctx, JSON.stringify(bot));
check('honeypot returns ok:true (silent)', out.ok === true);
check('honeypot appends nothing', ctx.rows.length === 0);
check('honeypot sends no email', ctx.mails.length === 0);

// setupSheet
ctx = loadGas(file);
ctx.sb.setupSheet();
check('setupSheet writes the header row',
  JSON.stringify(ctx.header()) === JSON.stringify(['תאריך', 'שם', 'ארגון', 'ענף', 'תפקיד', 'גודל קבוצה', 'טלפון', 'מייל', 'הערות']),
  JSON.stringify(ctx.header()));

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
