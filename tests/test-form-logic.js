var FormLogic = require('../formLogic.js');

var fails = 0;
function check(name, cond, detail) {
  console.log((cond ? '✓ ' : '✗ FAIL ') + name + (cond ? '' : ' — ' + detail));
  if (!cond) fails++;
}

// normalizePhone / validatePhone
check('normalizePhone strips dashes and spaces', FormLogic.normalizePhone('050 772-1477') === '0507721477');
check('normalizePhone converts +972', FormLogic.normalizePhone('+972 50-772-1477') === '0507721477');
check('normalizePhone converts 972 without plus', FormLogic.normalizePhone('972507721477') === '0507721477');
check('normalizePhone handles non-string', FormLogic.normalizePhone(undefined) === '');
check('validatePhone accepts mobile', FormLogic.validatePhone('0507721477') === true);
check('validatePhone accepts landline', FormLogic.validatePhone('03-1234567') === true);
check('validatePhone accepts +972 form', FormLogic.validatePhone('+972-50-772-1477') === true);
check('validatePhone rejects short', FormLogic.validatePhone('12345') === false);
check('validatePhone rejects letters', FormLogic.validatePhone('05a7721477') === false);

// validateEmail
check('validateEmail accepts normal address', FormLogic.validateEmail('coach@team.org.il') === true);
check('validateEmail rejects missing @', FormLogic.validateEmail('coach.team.org') === false);
check('validateEmail rejects missing domain dot', FormLogic.validateEmail('coach@team') === false);

// validateLead
var good = { name: 'דנה כהן', org: 'מכבי ת"א כדורעף', phone: '0501234567', email: '' };
var r = FormLogic.validateLead(good);
check('validateLead passes a minimal valid lead', r.valid === true && Object.keys(r.errors).length === 0, JSON.stringify(r));

r = FormLogic.validateLead({ name: '', org: '', phone: '' });
check('validateLead flags name', !!r.errors.name);
check('validateLead flags org', !!r.errors.org);
check('validateLead flags phone', !!r.errors.phone);
check('validateLead is invalid when required missing', r.valid === false);

r = FormLogic.validateLead({ name: 'דנה כהן', org: 'קבוצה', phone: '0501234567', email: 'not-an-email' });
check('validateLead flags a bad optional email', r.valid === false && !!r.errors.email);

r = FormLogic.validateLead({ name: '  ד ', org: 'קבוצה', phone: '0501234567' });
check('validateLead trims before length check', !!r.errors.name);

// isBot
check('isBot false for empty honeypot', FormLogic.isBot({ website: '' }) === false);
check('isBot false for missing honeypot', FormLogic.isBot({}) === false);
check('isBot true when honeypot filled', FormLogic.isBot({ website: 'http://spam.example' }) === true);

// buildPayload
var p = FormLogic.buildPayload({ name: ' דנה ', org: 'קבוצה', phone: '+972 50-123-4567', teamSize: '20–50' });
check('buildPayload trims and normalizes', p.name === 'דנה' && p.phone === '0501234567' && p.teamSize === '20–50', JSON.stringify(p));
check('buildPayload defaults missing fields to empty strings',
  p.sport === '' && p.role === '' && p.email === '' && p.notes === '' && p.website === '', JSON.stringify(p));
check('buildPayload has exactly the expected keys',
  JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['email', 'name', 'notes', 'org', 'phone', 'role', 'sport', 'teamSize', 'website']));

check('TEAM_SIZES matches spec', JSON.stringify(FormLogic.TEAM_SIZES) === JSON.stringify(['עד 20', '20–50', '50–150', '150+']));

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED');
process.exit(fails === 0 ? 0 : 1);
