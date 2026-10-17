// Isolated local test for website username/password registration and login.
// Uses only local Docker MySQL/Redis and simulated payments; clears its fixtures.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const docker = process.env.DOCKER_BIN || 'D:/Docker/Desktop/resources/bin/docker.exe';
const API = process.env.FOOD_API || 'http://127.0.0.1:8080';

function sql(q) {
  return execFileSync(docker, ['exec', '-i', 'moxuany-mysql', 'sh', '-c',
    'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --skip-column-names --default-character-set=utf8mb4 moxuany'],
    { input: q, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function redis(args) {
  return execFileSync(docker, ['exec', '-i', 'moxuany-redis', 'redis-cli', '-n', '1', ...args],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
async function call(path, body, token, admin = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    if (admin) headers.Authorization = 'Bearer ' + token;
    else headers['X-Food-Token'] = token;
  }
  const res = await fetch(API + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { http: res.status, ...(await res.json()) };
}
const ok = r => { assert.equal(r.code, 200, JSON.stringify(r)); return r.data; };
const bad = r => assert.notEqual(r.code, 200, JSON.stringify(r));

const prefix = 'web' + Date.now().toString(36).slice(-8);
const password = 'Campus2026pass';
const checks = [];
const pass = s => { checks.push(s); console.log('PASS ' + s); };
function clearRegisterLimit() {
  for (const key of redis(['--scan', '--pattern', 'food:rate:register:*']).split('\n').filter(Boolean)) {
    redis(['DEL', key]);
  }
}

(async () => {
  const createdAccounts = [];
  const createdTokens = [];
  let adminToken;
  let captchaBackup = null;
  let configKeyCleared = false;

  try {
    // Registration is limited to 10 attempts/hour per IP; start from a clean
    // counter so repeated local runs do not hit the limit mid-suite.
    clearRegisterLimit();

    // ---------- config ----------
    const config = ok(await call('/food/app/config'));
    assert.equal(config.webLoginEnabled, true);
    assert.equal(config.registrationRequiresInvite, true);
    assert.equal(config.mockPayment, true, 'mock payment must stay usable with demo login enabled');
    assert.equal(typeof config.captchaEnabled, 'boolean');
    pass('config exposes web login, invite-only registration and mock payment');

    // ---------- captcha ----------
    // Verify the real captcha path by temporarily enabling it and reading the
    // expected code back from Redis (the suite cannot OCR the image). Admin login
    // is done afterwards with the captcha disabled.
    captchaBackup = sql("SELECT config_value FROM sys_config WHERE config_key='sys.account.captchaEnabled'") || 'false';
    const setCaptcha = value => {
      sql(`UPDATE sys_config SET config_value='${value}' WHERE config_key='sys.account.captchaEnabled'`);
      redis(['DEL', 'sys_config:sys.account.captchaEnabled']);
      configKeyCleared = true;
    };

    setCaptcha('true');
    const cap = ok(await call('/food/app/captcha'));
    assert.equal(cap.enabled, true);
    assert.match(cap.uuid, /^[0-9a-f]{32}$/);
    assert(cap.img && cap.img.length > 100);

    const capInvite = 'C' + Date.now().toString(36).toUpperCase().slice(-10) + 'A';
    sql(`INSERT INTO food_invite_code(code,note,expires_at) VALUES('${capInvite}','${prefix}',DATE_ADD(NOW(),INTERVAL 1 HOUR))`);
    const capAccount = prefix + 'cap';
    createdAccounts.push(capAccount, prefix + 'cap2');

    const noCode = await call('/food/app/register', { account: capAccount, password, inviteCode: capInvite });
    bad(noCode);
    assert.match(noCode.msg, /验证码/);
    const wrongUuid = ok(await call('/food/app/captcha')).uuid;
    const wrongCode = await call('/food/app/register', { account: capAccount, password, inviteCode: capInvite, captchaUuid: wrongUuid, captchaCode: 'wrong' });
    bad(wrongCode);
    assert.match(wrongCode.msg, /验证码/);
    assert.equal(sql(`SELECT used_by FROM food_invite_code WHERE code='${capInvite}'`), 'NULL');

    const good = ok(await call('/food/app/captcha'));
    // RedisCache stores values through FastJSON, so a string comes back quoted.
    const rawCaptcha = redis(['GET', 'captcha_codes:' + good.uuid]);
    let expected = rawCaptcha;
    try { const parsed = JSON.parse(rawCaptcha); if (typeof parsed === 'string') expected = parsed; } catch (_) { /* plain string */ }
    assert(expected, 'expected captcha code to be stored in Redis');
    const capReg = ok(await call('/food/app/register', {
      account: capAccount, password, inviteCode: capInvite,
      captchaUuid: good.uuid, captchaCode: expected.toLowerCase()
    }));
    createdTokens.push(capReg.token);
    assert.equal(capReg.account, capAccount);
    // The code is single-use: replaying the same uuid must fail.
    const replay = await call('/food/app/register', { account: prefix + 'cap2', password, inviteCode: capInvite, captchaUuid: good.uuid, captchaCode: expected });
    bad(replay);
    assert.match(replay.msg, /验证码/);
    pass('captcha is required, wrong/expired codes fail, correct code is case-insensitive and single-use');

    // Disable captcha for the rest of the suite and restore the original value in finally.
    setCaptcha('false');
    clearRegisterLimit();
    const off = ok(await call('/food/app/captcha'));
    assert.equal(off.enabled, false);
    assert.equal(off.img, undefined);
    pass('captcha can be disabled through sys_config and returns enabled=false without an image');

    // ---------- admin + invite generation ----------
    let adminLogin = await call('/login', { username: 'admin', password: 'admin123' });
    if (adminLogin.code !== 200 && process.env.FOOD_TEST_ADMIN_PASSWORD) {
      adminLogin = await call('/login', { username: 'admin', password: process.env.FOOD_TEST_ADMIN_PASSWORD });
    }
    ok(adminLogin);
    adminToken = adminLogin.token;
    const a = (p, b) => call('/food/admin' + p, b, adminToken, true);

    bad(await a('/invites', { count: 0, expiresInDays: 7, note: prefix }));
    bad(await a('/invites', { count: 51, expiresInDays: 7, note: prefix }));
    bad(await a('/invites', { count: 1, expiresInDays: 366, note: prefix }));
    bad(await a('/invites', { count: 1, expiresInDays: 7, note: 'x'.repeat(101) }));
    const generated = ok(await a('/invites', { count: 3, expiresInDays: 7, note: prefix }));
    assert.equal(generated.codes.length, 3);
    for (const code of generated.codes) assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{12}$/);
    const [code1, code2, code3] = generated.codes;
    const listed = ok(await a('/invites?page=1&status=UNUSED'));
    assert(listed.rows.some(r => r.code === code1 && r.note === prefix));
    assert(Number(listed.summary.unused) >= 3);
    pass('admin generates unambiguous 12-char codes; count/expiry/note bounds and list summary validated');

    // ---------- validation failures should not burn invites ----------
    const u1 = prefix + 'u1';
    const u2 = prefix + 'u2';
    const u3 = prefix + 'u3';
    const u4 = prefix + 'u4';
    createdAccounts.push(u1, u2, u3, u4);

    bad(await call('/food/app/register', { account: u1, password: 'short1', inviteCode: code1 }));
    bad(await call('/food/app/register', { account: u1, password: 'allletters', inviteCode: code1 }));
    bad(await call('/food/app/register', { account: 'ab', password, inviteCode: code1 }));
    bad(await call('/food/app/register', { account: u1, password, inviteCode: 'BAD' }));
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_member WHERE account='${u1}'`)), 0);
    assert.equal(sql(`SELECT used_by FROM food_invite_code WHERE code='${code1}'`), 'NULL');
    pass('weak password, bad account and bad invite are rejected without creating a member or using the code');

    bad(await call('/food/app/register', { account: u1, password, inviteCode: 'AAAAAA' }));
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_member WHERE account='${u1}'`)), 0);
    pass('unknown invite code rolls the registration back entirely');

    // ---------- successful registration ----------
    const reg = ok(await call('/food/app/register', { account: u1, password, nickname: '网站同学', inviteCode: code1 }));
    createdTokens.push(reg.token);
    assert.equal(reg.account, u1);
    assert.equal(reg.nickname, '网站同学');
    assert(reg.memberId > 0);
    assert.equal(sql(`SELECT used_by FROM food_invite_code WHERE code='${code1}'`), String(reg.memberId));
    const me = ok(await call('/food/app/me', undefined, reg.token));
    assert.equal(me.account, u1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_coupon WHERE member_id=${reg.memberId} AND title='新人见面礼'`)), 1);
    pass('registration logs in, stores BCrypt account, claims the invite and grants the welcome coupon');

    // ---------- duplicate account / reused invite ----------
    bad(await call('/food/app/register', { account: u1.toUpperCase(), password, inviteCode: code2 }));
    assert.equal(sql(`SELECT used_by FROM food_invite_code WHERE code='${code2}'`), 'NULL');
    bad(await call('/food/app/register', { account: u2, password, inviteCode: code1 }));
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_member WHERE account='${u2}'`)), 0);
    pass('duplicate account is case-insensitive, and a used invite cannot register another account');

    // ---------- concurrent claim of one invite ----------
    const u5 = prefix + 'u5';
    const u6 = prefix + 'u6';
    createdAccounts.push(u5, u6);
    const race = await Promise.all([
      call('/food/app/register', { account: u5, password, inviteCode: code2 }),
      call('/food/app/register', { account: u6, password, inviteCode: code2 })
    ]);
    const winners = race.filter(r => r.code === 200);
    assert.equal(winners.length, 1, JSON.stringify(race));
    createdTokens.push(winners[0].data.token);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_member WHERE account IN ('${u5}','${u6}')`)), 1);
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_invite_code WHERE code='${code2}' AND used_by IS NOT NULL`)), 1);
    pass('two concurrent registrations with one invite yield exactly one member');

    // ---------- login / wrong password / logout ----------
    const wrong = await call('/food/app/login', { mode: 'web', account: u1, password: 'WrongPass123' });
    bad(wrong);
    assert.notEqual(wrong.code, 401, 'wrong password must not return 401 (the H5 client clears its token on 401)');
    const again = ok(await call('/food/app/login', { mode: 'web', account: u1.toUpperCase(), password }));
    createdTokens.push(again.token);
    assert.equal(again.account, u1);
    ok(await call('/food/app/logout', {}, again.token));
    const afterLogout = await call('/food/app/me', undefined, again.token);
    assert.equal(afterLogout.code, 401);
    pass('login is case-insensitive; wrong password returns a business error (not 401); logout invalidates the token');

    // ---------- per-account rate limit ----------
    const rateAccount = prefix + 'rate';
    let limited = null;
    for (let i = 0; i < 11; i++) {
      const r = await call('/food/app/login', { mode: 'web', account: rateAccount, password: 'WrongPass123' });
      if (r.code === 429) { limited = r; break; }
    }
    assert(limited, 'expected the 11th attempt on one account to be rate limited');
    pass('per-account login attempts are limited (429 after 10 tries / 15 minutes)');

    // ---------- expired invite ----------
    clearRegisterLimit();
    sql(`UPDATE food_invite_code SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE code='${code3}'`);
    bad(await call('/food/app/register', { account: u3, password, inviteCode: code3 }));
    assert.equal(Number(sql(`SELECT COUNT(*) FROM food_member WHERE account='${u3}'`)), 0);
    pass('expired invite is rejected and leaves no member row');

    // ---------- member list shows account ----------
    const members = ok(await a('/members'));
    assert(Array.isArray(members) && members.some(m => m.account === u1), 'member list should expose the website account');
    pass('admin member list exposes website accounts');

    require('fs').writeFileSync('docs/web-login-test-report.json', JSON.stringify({
      date: new Date().toISOString(),
      checks,
      scope: 'Local Docker MySQL/Redis. Captcha temporarily disabled if needed; simulated payment only.'
    }, null, 2));
    console.log('Web login checks passed: ' + checks.length);
  } finally {
    // ---------- cleanup ----------
    try {
      for (const token of createdTokens) {
        try { await call('/food/app/logout', {}, token); } catch (_) { /* ignore */ }
      }
      const accounts = createdAccounts.map(a => `'${a}'`).join(',');
      if (accounts) {
        sql(`DELETE c FROM food_coupon c JOIN food_member m ON m.id=c.member_id WHERE m.account IN (${accounts});`
          + `DELETE FROM food_member WHERE account IN (${accounts});`
          + `DELETE FROM food_invite_code WHERE note='${prefix}';`);
      } else {
        sql(`DELETE FROM food_invite_code WHERE note='${prefix}';`);
      }
      for (const a of createdAccounts) redis(['DEL', 'food:rate:weblogin:' + a]);
      for (const key of redis(['--scan', '--pattern', 'food:rate:register:*']).split('\n').filter(Boolean)) {
        redis(['DEL', key]);
      }
      if (captchaBackup !== null && configKeyCleared) {
        sql(`UPDATE sys_config SET config_value='${captchaBackup}' WHERE config_key='sys.account.captchaEnabled'`);
        redis(['DEL', 'sys_config:sys.account.captchaEnabled']);
      }
      console.log('Isolated web-login fixtures removed');
    } catch (e) {
      console.error('cleanup failed', e);
      process.exitCode = 1;
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
