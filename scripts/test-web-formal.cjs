// Formal-mode (FOOD_DEMO_ENABLED=false) end-to-end check:
// invitation registration -> login -> order -> simulated payment.
// Run against a local backend started with FOOD_DEMO_ENABLED=false.
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
  if (token) headers[admin ? 'Authorization' : 'X-Food-Token'] = admin ? 'Bearer ' + token : token;
  return (await fetch(API + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })).json();
}
const ok = r => { assert.equal(r.code, 200, JSON.stringify(r)); return r.data; };
const bad = r => assert.notEqual(r.code, 200, JSON.stringify(r));
const prefix = 'formal' + Date.now().toString(36).slice(-7);
const account = prefix + 'u1';
const password = 'Campus2026pass';
const checks = [];
const pass = s => { checks.push(s); console.log('PASS ' + s); };

(async () => {
  let storeId = null;
  let memberId = null;
  let adminToken = null;
  let captchaBackup = null;
  try {
    // Keep the suite runnable when local captcha is on; restore it afterwards.
    captchaBackup = sql("SELECT config_value FROM sys_config WHERE config_key='sys.account.captchaEnabled'") || 'false';
    sql("UPDATE sys_config SET config_value='false' WHERE config_key='sys.account.captchaEnabled'");
    redis(['DEL', 'sys_config:sys.account.captchaEnabled']);
    for (const key of redis(['--scan', '--pattern', 'food:rate:register:*']).split('\n').filter(Boolean)) redis(['DEL', key]);

    const config = ok(await call('/food/app/config'));
    assert.equal(config.demoEnabled, false, 'start the backend with FOOD_DEMO_ENABLED=false');
    assert.equal(config.webLoginEnabled, true);
    assert.equal(config.mockPayment, true, 'mock payment must remain available when demo login is off');
    bad(await call('/food/app/login', { mode: 'demo' }));
    pass('formal mode: demo login is closed while website login and simulated payment stay enabled');

    const adminLogin = await call('/login', { username: 'admin', password: 'admin123' });
    ok(adminLogin);
    adminToken = adminLogin.token;
    const a = (p, b) => call('/food/admin' + p, b, adminToken, true);

    const invite = ok(await a('/invites', { count: 1, expiresInDays: 1, note: prefix }));
    const reg = ok(await call('/food/app/register', { account, password, nickname: '正式验收', inviteCode: invite.codes[0] }));
    memberId = reg.memberId;
    assert.equal(reg.account, account);
    pass('invitation registration and automatic login succeed with demo mode off');

    ok(await a('/stores', {
      name: prefix, category: '验收', zone: prefix, description: '', image: '/static/food/rice.jpg',
      minutes: 20, minimum: 0, delivery_fee: 200, active: 1, latitude: null, longitude: null,
      delivery_radius: 0, open_time: '', close_time: '', business_periods: '',
      reservation_enabled: 0, reservation_days: 3, lead_minutes: 30, slot_limit: 20,
      kitchen_capacity: 1, cooking_minutes: 10
    }));
    const store = ok(await a('/catalog/stores?q=' + prefix)).rows[0];
    storeId = store.id;
    ok(await a('/products', { store_id: store.id, name: prefix + '菜品', category: '验收', description: '', image: store.image, price: 1200, stock: 10, active: 1 }));
    const product = ok(await call('/food/app/catalog/products?storeId=' + store.id)).rows[0];

    const order = ok(await call('/food/app/orders', {
      storeId: store.id, type: 'PICKUP',
      items: [{ productId: product.id, quantity: 1 }],
      requestKey: crypto.randomUUID()
    }, reg.token));
    ok(await call('/food/app/orders/' + order.id + '/pay', {}, reg.token));
    const detail = ok(await call('/food/app/orders/' + order.id, undefined, reg.token));
    assert.equal(detail.status, 'PENDING');
    assert(detail.paid_at, 'order should record paid_at after simulated payment');
    pass('website account can place and pay an order while demo login is disabled');
  } finally {
    try {
      if (storeId) {
        sql(`DELETE e FROM food_order_event e JOIN food_order o ON o.id=e.order_id WHERE o.store_id=${storeId};`
          + `DELETE i FROM food_order_item i JOIN food_order o ON o.id=i.order_id WHERE o.store_id=${storeId};`
          + `DELETE FROM food_order WHERE store_id=${storeId};`
          + `DELETE FROM food_product WHERE store_id=${storeId};`
          + `DELETE FROM food_store WHERE id=${storeId};`);
      }
      if (memberId) {
        sql(`DELETE FROM food_coupon WHERE member_id=${memberId};DELETE FROM food_member WHERE id=${memberId};`);
      }
      sql(`DELETE FROM food_invite_code WHERE note='${prefix}'`);
      for (const key of redis(['--scan', '--pattern', 'food:rate:weblogin:*']).split('\n').filter(Boolean)) redis(['DEL', key]);
      if (captchaBackup !== null) {
        sql(`UPDATE sys_config SET config_value='${captchaBackup}' WHERE config_key='sys.account.captchaEnabled'`);
        redis(['DEL', 'sys_config:sys.account.captchaEnabled']);
      }
      require('fs').writeFileSync('docs/web-formal-test-report.json', JSON.stringify({
        date: new Date().toISOString(), checks, scope: 'FOOD_DEMO_ENABLED=false local end-to-end, simulated payment.'
      }, null, 2));
      console.log('Formal-mode fixtures removed');
    } catch (e) {
      console.error('cleanup failed', e.message);
      process.exitCode = 1;
    }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
