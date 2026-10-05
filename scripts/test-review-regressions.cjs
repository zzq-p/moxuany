// Local integration regressions: a temporary schema and an empty Redis DB14.
// Requires the migrated local Docker services, a current backend JAR and admin dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {createRequire} = require('node:module');
const {execFileSync, spawn} = require('node:child_process');
const {component} = require('./test-admin-review-fixes.cjs');

process.chdir(path.resolve(__dirname, '..'));
const docker = process.env.DOCKER_BIN || 'D:/Docker/Desktop/resources/bin/docker.exe';
const database = 'moxuany_review_' + Date.now() + '_' + process.pid;
const port = 18080, redisDb = '14', checks = [];
const mysqlArgs = ['exec', '-i', 'moxuany-mysql', 'sh', '-c',
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --batch --unbuffered --skip-column-names --default-character-set=utf8mb4'];
const sql = query => execFileSync(docker, mysqlArgs, {
  input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
}).trim();
const ownSql = query => sql('USE ' + database + ';\n' + query);
const redis = (...args) => execFileSync(docker, ['exec', 'moxuany-redis', 'redis-cli', '-n', redisDb, ...args], {
  encoding: 'utf8', windowsHide: true
}).trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = result => { assert.equal(result.code, 200, JSON.stringify(result)); return result.data; };
const denied = result => { assert.notEqual(result.code, 200); assert.match(result.msg, /无权|没有权限|店长/); };
const pass = message => { checks.push(message); console.log('PASS ' + message); };
async function call(route, body, token, admin = false) {
  return (await fetch('http://127.0.0.1:' + port + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'Content-Type': 'application/json', ...(token ? {
      [admin ? 'Authorization' : 'X-Food-Token']: admin ? 'Bearer ' + token : token
    } : {})},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000)
  })).json();
}
async function waitFor(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await sleep(100); }
  throw Error('Timed out: ' + label);
}
async function stop(child) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'child process exit');
  }
}

let server, log, created = false, ownsRedis = false;
async function setup() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  assert.equal(redis('DBSIZE'), '0', 'Redis DB14 must be unused');
  assert.equal(sql("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='" + database + "'"), '0');
  sql('CREATE DATABASE ' + database + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  created = true; ownsRedis = true;
  const schema = execFileSync(docker, ['exec', 'moxuany-mysql', 'sh', '-c',
    'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --no-data --skip-comments --no-tablespaces moxuany'], {
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, windowsHide: true
  });
  ownSql(schema);
  for (const table of ['sys_config', 'sys_dict_type', 'sys_dict_data', 'sys_dept', 'sys_role', 'sys_menu', 'sys_role_menu', 'food_message_template']) {
    ownSql('INSERT INTO ' + table + ' SELECT * FROM moxuany.' + table);
  }
  ownSql("INSERT INTO sys_user SELECT * FROM moxuany.sys_user WHERE user_id=1; " +
    "INSERT INTO sys_user_role SELECT * FROM moxuany.sys_user_role WHERE user_id=1; " +
    "UPDATE sys_config SET config_value='false' WHERE config_key='sys.account.captchaEnabled'");
  const env = {...process.env};
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/); if (match) env[match[1]] = match[2];
  }
  Object.assign(env, {
    MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '13306', MYSQL_DATABASE: database,
    MYSQL_USER: 'root', MYSQL_PASSWORD: env.MYSQL_ROOT_PASSWORD,
    REDIS_HOST: '127.0.0.1', REDIS_PORT: '16379', REDIS_PASSWORD: '',
    FOOD_DEMO_ENABLED: 'true', FOOD_SUBSCRIPTIONS_ENABLED: 'false',
    FOOD_UPLOAD_PATH: path.resolve('.runtime/review-uploads').replaceAll('\\', '/')
  });
  fs.mkdirSync('.runtime', {recursive: true});
  log = fs.openSync('.runtime/review-regressions-backend.log', 'w');
  server = spawn(process.env.JAVA_BIN || 'java', ['-jar', 'server/ruoyi-admin/target/ruoyi-admin.jar',
    '--spring.profiles.active=druid,food', '--server.address=127.0.0.1', '--server.port=' + port,
    '--spring.data.redis.database=' + redisDb], {env, windowsHide: true, stdio: ['ignore', log, log]});
  let startupError;
  server.once('error', error => { startupError = error; });
  await waitFor(async () => {
    if (startupError) throw startupError;
    assert.equal(server.exitCode, null, 'Backend exited; inspect .runtime/review-regressions-backend.log');
    try { return ok(await call('/food/app/config')).demoEnabled; } catch { return false; }
  }, 'isolated backend startup', 60000);
}

async function concurrentStaffChanges(admin, store, managers, changes) {
  const blocker = spawn(docker, mysqlArgs, {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
  let output = '', requests = [];
  blocker.stdout.on('data', data => { output += data.toString(); });
  try {
    blocker.stdin.write('USE ' + database + '; START TRANSACTION; SELECT id FROM food_store WHERE id=' +
      store.id + " FOR UPDATE; SELECT 'REVIEW_LOCK_READY';\n");
    await waitFor(() => output.includes('REVIEW_LOCK_READY'), 'store mutex');
    requests = managers.map((manager, index) => admin('/staff/' + manager.user_id, {storeId: store.id, ...changes[index]}));
    // Both transactions must have passed the permission reads before either can mutate staff.
    await waitFor(() => Number(sql("SELECT COUNT(*) FROM performance_schema.data_lock_waits w " +
      "JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID " +
      "WHERE r.OBJECT_SCHEMA='" + database + "' AND r.OBJECT_NAME='food_store'")) >= 2, 'both staff requests waiting');
    blocker.stdin.end('COMMIT;\n');
    const results = await Promise.all(requests);
    assert.equal(results.filter(result => result.code === 200).length, 1, JSON.stringify(results));
    const rejected = results.find(result => result.code !== 200);
    assert.match(rejected.msg, /至少保留一位在职店长/);
    const staff = ok(await admin('/staff?storeId=' + store.id));
    assert.equal(staff.filter(row => row.active === 1 && row.staff_role === 'MANAGER').length, 1);
    results.forEach((result, index) => {
      const row = staff.find(row => row.user_id === managers[index].user_id);
      assert.equal(row.active, result.code === 200 ? changes[index].active : 1);
      assert.equal(row.staff_role, result.code === 200 ? changes[index].role : 'MANAGER');
      const role = ownSql('SELECT r.role_key FROM sys_user_role ur JOIN sys_role r ON r.role_id=ur.role_id WHERE ur.user_id=' + row.user_id);
      assert.equal(role, row.staff_role === 'MANAGER' ? 'food_merchant' : 'food_clerk');
    });
  } finally {
    if (!blocker.stdin.destroyed && !blocker.stdin.writableEnded) blocker.stdin.end('ROLLBACK;\n');
    await Promise.allSettled(requests);
    await stop(blocker);
  }
}

async function verifyCsv(rows, summary) {
  // Execute the real Vue download action and inspect the resulting CSV Blob.
  const requireAdmin = createRequire(path.resolve('admin/package.json'));
  const compiler = requireAdmin('@vue/compiler-sfc'), vue = requireAdmin('vue');
  const {parseCsv, serializeCsv} = await import('../admin/src/views/food/csv.js');
  const {descriptor} = compiler.parse(fs.readFileSync('admin/src/views/food/reports/index.vue', 'utf8'));
  let source = compiler.compileScript(descriptor, {id: 'report-export-regression'}).content;
  const imports = compiler.babelParse(source, {sourceType: 'module'}).program.body.filter(node => node.type === 'ImportDeclaration');
  for (const node of imports.reverse()) source = source.slice(0, node.start) + source.slice(node.end);
  let blob, clicked = false;
  const env = {...vue, onMounted() {}, foodGet: async () => ({data: rows}), serializeCsv,
    money: value => (Number(value || 0) / 100).toFixed(2), statuses: {}, ElMessage: {success() {}},
    Blob, URL: {createObjectURL(value) { blob = value; return 'blob:review'; }, revokeObjectURL() {}},
    document: {createElement: () => ({click() { clicked = true; }})}, setTimeout() {}};
  const component = new Function(...Object.keys(env), source.replace('export default', 'return'))(...Object.values(env));
  const bindings = component.setup({}, {expose() {}});
  await bindings.download(); assert(clicked);
  const [header, ...exported] = parseCsv(await blob.text());
  const paid = header.indexOf('实付(元)'), net = header.indexOf('净实收(元)');
  assert(paid >= 0 && net >= 0); assert.equal(exported.length, rows.length);
  for (const line of exported) {
    const original = rows.find(row => row.id === line[0]); assert(original);
    assert.equal(Math.round(Number(line[paid]) * 100), original.paid_total);
    assert.equal(Math.round(Number(line[net]) * 100), original.net_total);
  }
  assert.equal(exported.reduce((sum, line) => sum + Math.round(Number(line[paid]) * 100), 0), summary.gross);
  assert.equal(exported.reduce((sum, line) => sum + Math.round(Number(line[net]) * 100), 0), summary.revenue);
}

async function test() {
  const login = await call('/login', {username: 'admin', password: process.env.FOOD_TEST_ADMIN_PASSWORD || 'admin123'}); ok(login);
  const admin = (route, body) => call('/food/admin' + route, body, login.token, true);
  const member = ok(await call('/food/app/login', {mode: 'demo'}));
  const app = (route, body) => call('/food/app' + route, body, member.token);
  const stores = [];
  for (const name of ['Review primary', 'Review other']) {
    ok(await admin('/stores', {name, category: 'Review', zone: 'Review', image: '/static/food/rice.jpg',
      minutes: 20, minimum: 0, delivery_fee: 200, active: 1}));
    const store = ok(await admin('/catalog/stores?q=' + encodeURIComponent(name))).rows[0];
    ok(await admin('/products', {store_id: store.id, name, category: 'Review', image: store.image, price: 1000, stock: 100, active: 1}));
    store.product = ok(await admin('/catalog/products?storeId=' + store.id)).rows[0]; stores.push(store);
  }
  const store = stores[0], actors = {};
  for (const role of ['CLERK', 'KITCHEN', 'MANAGER']) {
    const username = 'review_' + role.toLowerCase(), password = 'ReviewTest123!';
    ok(await admin('/staff', {storeId: store.id, username, password, name: role, role}));
    const loggedIn = await call('/login', {username, password}); ok(loggedIn);
    actors[role] = (route, body) => call('/food/admin' + route, body, loggedIn.token, true);
  }
  ok(await app('/addresses', {contact: 'Review', phone: '13800000000', detail: 'Isolated review address'}));
  const address = ok(await app('/addresses'))[0];
  const create = (extra = {}, selectedStore = store) => app('/orders', {
    storeId: selectedStore.id, type: 'DELIVERY', addressId: address.id, requestKey: crypto.randomUUID(),
    items: [{productId: selectedStore.product.id, quantity: 1}], ...extra
  }).then(ok);
  const detail = id => app('/orders/' + id).then(ok);
  const pay = id => app('/orders/' + id + '/pay', {}).then(ok);
  const status = (actor, id, target) => actor('/orders/' + id + '/status', {status: target});
  for (const target of ['READY', 'WAITING_DELIVERY', 'DELIVERING']) {
    const order = await create({type: target === 'READY' ? 'PICKUP' : 'DELIVERY'}); await pay(order.id);
    denied(await status(actors.KITCHEN, order.id, 'PREPARING'));
    ok(await status(actors.CLERK, order.id, 'PREPARING'));
    denied(await status(actors.CLERK, order.id, target));
    assert.equal((await detail(order.id)).status, 'PREPARING');
    ok(await status(actors.KITCHEN, order.id, target));
    assert.equal((await detail(order.id)).status, target);
    if (target === 'DELIVERING') {
      denied(await status(actors.KITCHEN, order.id, 'COMPLETED'));
      ok(await status(actors.CLERK, order.id, 'COMPLETED'));
    }
  }
  const managerOrder = await create(); await pay(managerOrder.id);
  ok(await status(actors.MANAGER, managerOrder.id, 'PREPARING'));
  ok(await status(actors.MANAGER, managerOrder.id, 'DELIVERING'));
  const otherOrder = await create({}, stores[1]); await pay(otherOrder.id);
  ok(await status(admin, otherOrder.id, 'PREPARING'));
  denied(await status(actors.KITCHEN, otherOrder.id, 'DELIVERING'));
  ok(await status(admin, otherOrder.id, 'DELIVERING'));
  pass('all preparation-exit paths require COOK; kitchen, clerk completion, manager and platform permissions remain correct; cross-store access denied');

  const unpaid = await create(), cancelled = await create(); ok(await app('/orders/' + cancelled.id + '/cancel', {}));
  const coupon = ok(await app('/coupons'))[0];
  const partial = await create({couponId: coupon.id, items: [{productId: store.product.id, quantity: 2}]});
  await pay(partial.id);
  ok(await app('/orders/' + partial.id + '/refund', {kind: 'ITEMS', reason: 'One item missing', items: [{itemId: partial.items[0].id, quantity: 1}]}));
  ok(await admin('/orders/' + partial.id + '/refund', {refundId: (await detail(partial.id)).refund_id, decision: 'APPROVE', reply: 'Partial refund confirmed'}));
  const full = await create(); await pay(full.id);
  ok(await admin('/orders/' + full.id + '/reject', {reason: 'Full refund confirmed'}));
  const day = ownSql('SELECT CURRENT_DATE'), query = '?from=' + day + '&to=' + day;
  const report = ok(await admin('/reports' + query)), rows = ok(await admin('/reports/export' + query));
  const expected = [[unpaid.id, 1200, 0, 0, 0], [cancelled.id, 1200, 0, 0, 0],
    [partial.id, 1900, 1900, 850, 1050], [full.id, 1200, 1200, 1200, 0], [managerOrder.id, 1200, 1200, 0, 1200]];
  for (const [id, total, paid, refunded, net] of expected) {
    const row = rows.find(row => row.id === id); assert(row);
    assert.deepEqual([row.total, row.paid_total, row.refunded_amount, row.net_total], [total, paid, refunded, net]);
  }
  for (const [field, metric] of [['paid_total', 'gross'], ['refunded_amount', 'refunds'], ['net_total', 'revenue']]) {
    assert.equal(rows.reduce((sum, row) => sum + row[field], 0), report.summary[metric]);
  }
  const ownRows = ok(await actors.MANAGER('/reports/export' + query));
  assert(ownRows.length > 0); assert(!ownRows.some(row => row.id === otherOrder.id));
  denied(await actors.CLERK('/reports/export' + query));
  await verifyCsv(rows, report.summary);
  pass('report and actual CSV totals reconcile for unpaid, cancelled, paid, discounted partial-refund and full-refund orders; merchant scope preserved');

  await verifyAdminFixes(admin, actors, stores, app, create, pay, detail);

  ok(await admin('/staff', {storeId: store.id, username: 'review_manager_b', password: 'ReviewTest123!', name: 'Second manager', role: 'MANAGER'}));
  const managers = ok(await admin('/staff?storeId=' + store.id)).filter(row => row.staff_role === 'MANAGER'); assert.equal(managers.length, 2);
  const disable = {role: 'MANAGER', active: 0}, demote = {role: 'CLERK', active: 1};
  for (const changes of [[disable, disable], [demote, demote], [disable, demote]]) {
    for (const manager of managers) ok(await admin('/staff/' + manager.user_id, {storeId: store.id, role: 'MANAGER', active: 1}));
    await concurrentStaffChanges(admin, store, managers, changes);
  }
  pass('deterministic simultaneous deactivation, demotion and mixed requests always retain one active manager; rejected staff/role changes roll back');
}

async function verifyAdminFixes(admin, actors, stores, app, create, pay, detail) {
  const store = stores[0];
  const a = await create(), b = await create({items: [{productId: store.product.id, quantity: 2}]});
  for (const order of [a, b]) {
    await pay(order.id);
    ok(await app('/orders/' + order.id + '/refund', {kind: 'FULL', reason: 'Review refund request'}));
  }
  const snapshotA = await admin('/orders/' + a.id); ok(snapshotA);
  let releaseA, confirm, firstA = true;
  const delayedA = new Promise(resolve => {releaseA = resolve;});
  const confirmation = new Promise(resolve => {confirm = resolve;});
  const page = component('admin/src/views/food/orders/index.vue', {
    foodGet: async route => {
      if (route === '/orders/' + a.id && firstA) {firstA = false; return delayedA;}
      const result = await admin(route); ok(result); return result;
    },
    foodPost: async (route, body) => {const result = await admin(route, body); ok(result); return result;},
    ElMessageBox: {confirm: text => {assert(text.includes((b.total / 100).toFixed(2))); return confirmation;}}
  });
  try {
    const first = page.api.detail(a);
    await page.api.detail(b);
    page.api.refundReply.value = 'Approve only the selected order B';
    const approval = page.api.resolveRefund('APPROVE');
    releaseA(snapshotA); await first; confirm(); await approval;
    const resultA = await detail(a.id), resultB = await detail(b.id);
    assert.equal(resultA.refund_status, 'REQUESTED'); assert.equal(resultA.refunded_amount, 0);
    assert.equal(resultB.refund_status, 'APPROVED'); assert.equal(resultB.refunded_amount, b.total);
  } finally {page.close();}
  pass('actual Vue refund confirmation with reordered responses approves only the selected order; other order remains unrefunded in MySQL');

  const productPath = '/products/' + store.product.id + '/selling';
  const product = () => admin('/catalog/products?storeId=' + store.id).then(ok).then(data => data.rows.find(p => p.id === store.product.id));
  let p = await product();
  const future = ownSql('SELECT DATE_ADD(NOW(),INTERVAL 1 HOUR)');
  ok(await actors.MANAGER(productPath, {periods: '', soldOut: true, until: future, version: p.version}));
  // Model the timer passing without a minute-long test sleep.
  ownSql('UPDATE food_product SET sold_out_until=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=' + p.id);
  p = await product();
  const expired = p.sold_out_until;
  for (const actor of [actors.CLERK, actors.KITCHEN]) denied(await actor(productPath, {periods: '', soldOut: false, until: expired, version: p.version}));
  ok(await actors.MANAGER(productPath, {periods: '', soldOut: false, until: expired, version: p.version}));
  let fresh = await product();
  assert.equal(fresh.sold_out, 0); assert.equal(fresh.sold_out_until, null);
  assert.match((await admin(productPath, {periods: '', soldOut: false, version: p.version})).msg, /菜品已变化/);
  for (const [until, message] of [[expired, /必须晚于现在/], ['invalid date', /格式不正确/]]) {
    const result = await admin(productPath, {periods: '', soldOut: true, until, version: fresh.version});
    assert.notEqual(result.code, 200); assert.match(result.msg, message);
  }
  for (const until of [future, '']) {
    ok(await admin(productPath, {periods: '', soldOut: true, until, version: fresh.version}));
    fresh = await product(); assert.equal(fresh.sold_out, 1);
    assert.equal(fresh.sold_out_until === null, until === '');
  }
  ok(await admin(productPath, {periods: '', soldOut: false, until: 'ignored hidden value', version: fresh.version}));
  fresh = await product(); assert.equal(fresh.sold_out, 0); assert.equal(fresh.sold_out_until, null);
  pass('expired sold-out settings can be disabled; enabled settings still validate dates; manual/future recovery, optimistic locking and role checks remain correct');

  const stale = ok(await admin('/catalog/stores?q=Review%20primary')).rows[0];
  ok(await admin('/stores', {...stale, delivery_fee: 800, notice: 'Concurrent store edit',
    latitude: 31, longitude: 121, delivery_radius: 500, slot_limit: 7, kitchen_capacity: 4}));
  const expected = ok(await admin('/catalog/stores?q=Review%20primary')).rows[0];
  ok(await app('/stores/' + store.id)); // Populate the public cache before toggling.
  const catalog = component('admin/src/views/food/Catalog.vue', {
    foodGet: async route => {const result = await admin(route); ok(result); return result;},
    foodPost: async (route, body) => {const result = await actors.MANAGER(route, body); ok(result); return result;},
    ElMessageBox: {confirm: async () => {}}
  }, {kind: 'stores'});
  try {await catalog.api.toggle(stale);} finally {catalog.close();}
  const current = ok(await admin('/catalog/stores?q=Review%20primary')).rows[0];
  assert.equal(current.active, 0);
  for (const [key, value] of Object.entries(expected)) {
    if (!['active', 'open_now', 'updated_at'].includes(key)) assert.deepEqual(current[key], value, key);
  }
  assert.notEqual((await app('/stores/' + store.id)).code, 200, 'closed store must be evicted from public cache');
  for (const body of [{}, {active: null}, {active: -1}, {active: 2}, {active: 1.5}]) {
    assert.notEqual((await admin('/stores/' + store.id + '/active', body)).code, 200);
  }
  for (const actor of [actors.CLERK, actors.KITCHEN]) denied(await actor('/stores/' + store.id + '/active', {active: 1}));
  denied(await actors.MANAGER('/stores/' + stores[1].id + '/active', {active: 0}));
  assert.equal(ownSql('SELECT active FROM food_store WHERE id=' + store.id), '0');
  ok(await admin('/stores/' + store.id + '/active', {active: 1}));
  assert.equal(ok(await app('/stores/' + store.id)).delivery_fee, 800);
  assert.equal(ownSql("SELECT COUNT(*) FROM food_staff_audit WHERE store_id=" + store.id + " AND action='STORE_EDIT' AND note IN ('开启营业','店铺休息')"), '2');
  pass('actual Vue store toggle preserves concurrent fee, notice, coordinates and reservation edits; status validation, cache invalidation, audit and merchant scope verified');
}

(async () => { await setup(); await test(); })().catch(error => {
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  try {
    await stop(server);
    if (created) { assert.match(database, /^moxuany_review_\d+_\d+$/); sql('DROP DATABASE ' + database); }
    if (ownsRedis) { const keys = redis('KEYS', '*').split(/\r?\n/).filter(Boolean); if (keys.length) redis('DEL', ...keys); }
    console.log('Temporary schema, server and Redis DB14 keys removed.');
    if (!process.exitCode) fs.writeFileSync('docs/review-regressions-test-report.json', JSON.stringify({
      date: new Date().toISOString(), checks, scope: 'Local simulated API in a temporary schema and Redis DB14; actual Vue refund, store toggle and CSV actions; deterministic MySQL lock contention.'
    }, null, 2) + '\n');
  } catch (error) { console.error('Cleanup failed:', error); process.exitCode = 1; }
  finally { if (log !== undefined) fs.closeSync(log); }
});
