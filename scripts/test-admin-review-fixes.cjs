const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');

const root = path.resolve(__dirname, '..');
const requireAdmin = createRequire(path.join(root, 'admin/package.json'));
const vue = requireAdmin('vue'), compiler = requireAdmin('@vue/compiler-sfc');

// Run the real component actions with controlled request/confirmation timing.
function component(file, extras = {}, props = {}) {
  const {descriptor} = compiler.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  let source = compiler.compileScript(descriptor, {id: 'admin-review'}).content;
  const imports = compiler.babelParse(source, {sourceType: 'module'}).program.body.filter(n => n.type === 'ImportDeclaration');
  for (const n of imports.reverse()) source = source.slice(0, n.start) + source.slice(n.end);
  source = source.replaceAll('import.meta.env.VITE_APP_BASE_API', "''");
  const unmount = [], scope = vue.effectScope();
  const env = {...vue, onMounted() {}, onBeforeUnmount: fn => unmount.push(fn),
    Reviews: {}, DeliveryActions: {}, SellingDialog: {}, ProductOptions: {}, ReservationStock: {},
    allowed: () => true, getToken: () => '', parseCsv() {}, serializeCsv() {},
    money: n => (Number(n || 0) / 100).toFixed(2), statuses: {},
    useRoute: () => ({query: {}, path: '/food/orders'}), useRouter: () => ({replace() {}}),
    ElMessage: {success() {}}, ...extras};
  const api = scope.run(() => new Function(...Object.keys(env), source.replace('export default', 'return'))(...Object.values(env)).setup(props, {expose() {}, emit() {}}));
  let closed = false;
  return {api, close() { if (!closed) {closed = true; unmount.forEach(fn => fn()); scope.stop();} }};
}
const deferred = () => {let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};};
const orders = {
  A: {id: 'A', status: 'PENDING', refund_status: 'REQUESTED', refund_id: 'RA', refunds: [{id: 'RA', amount: 1200}]},
  B: {id: 'B', status: 'PENDING', refund_status: 'REQUESTED', refund_id: 'RB', refunds: [{id: 'RB', amount: 2400}]}
};
function orderPage(extra = {}) {
  return component('admin/src/views/food/orders/index.vue', {
    foodGet: async route => ({data: orders[route.split('/').pop()] || {rows: [], total: 0}}),
    foodPost: async () => {}, ElMessageBox: {confirm: async () => {}, prompt: async () => ({value: 'Out of stock'})}, ...extra
  });
}

async function test() {
  for (const decision of ['APPROVE', 'REJECT']) {
    const lateA = deferred(), confirm = deferred(), posts = [], prompts = [];
    let readsA = 0;
    const page = orderPage({
      foodGet: async route => route === '/orders/A' && ++readsA === 1 ? lateA.promise : {data: orders[route.split('/').pop()] || {rows: [], total: 0}},
      foodPost: async (route, body) => posts.push({route, body}),
      ElMessageBox: {confirm: text => {prompts.push(text); return confirm.promise;}}
    });
    const first = page.api.detail(orders.A);
    await page.api.detail(orders.B);
    page.api.refundReply.value = 'Reply for B';
    const pending = page.api.resolveRefund(decision);
    await page.api.resolveRefund(decision);
    assert.equal(prompts.length, 1);
    if (decision === 'APPROVE') assert.match(prompts[0], /24\.00/);
    lateA.resolve({data: orders.A}); await first;
    assert.equal(page.api.order.value.id, 'B');
    page.api.refundReply.value = 'Changed while awaiting confirmation';
    confirm.resolve(); await pending;
    assert.deepEqual(posts, [{route: '/orders/B/refund', body: {refundId: 'RB', decision, reply: 'Reply for B'}}]);
    assert.equal(page.api.busy.value, false); page.close();
  }
  console.log('PASS refund approval/rejection retains order, refund and reply; delayed detail and duplicate clicks cannot redirect an action');

  for (const action of ['resolveRefund', 'rejectOrder']) {
    for (const boundary of ['switch', 'close', 'unmount', 'cancel', 'success']) {
      const confirmation = deferred(), posts = [];
      const page = orderPage({foodPost: async (route, body) => posts.push({route, body}),
        ElMessageBox: {confirm: () => confirmation.promise, prompt: () => confirmation.promise}});
      await page.api.detail(orders.A);
      page.api.refundReply.value = 'Reply for A';
      const pending = page.api[action]('APPROVE');
      if (boundary === 'switch') await page.api.detail(orders.B);
      if (boundary === 'close') page.api.visible.value = false;
      if (boundary === 'unmount') page.close();
      if (boundary === 'cancel') confirmation.reject('cancel');
      else confirmation.resolve({value: 'Out of stock'});
      await pending;
      assert.equal(posts.length, boundary === 'success' ? 1 : 0, action + ': ' + boundary);
      if (posts.length) assert.equal(posts[0].route, '/orders/A/' + (action === 'rejectOrder' ? 'reject' : 'refund'));
      assert.equal(page.api.busy.value, false); page.close();
    }
  }
  console.log('PASS refund and merchant cancellation abort on order changes, drawer close, unmount and cancelled confirmation; normal submission works');

  for (const boundary of ['close', 'unmount', 'newer-failure']) {
    const held = deferred();
    const page = orderPage({foodGet: route => route === '/orders/A' ? held.promise : Promise.reject(Error('load failed'))});
    const pending = page.api.detail(orders.A);
    if (boundary === 'close') page.api.visible.value = false;
    if (boundary === 'unmount') page.close();
    if (boundary === 'newer-failure') await assert.rejects(page.api.detail(orders.B), /load failed/);
    held.resolve({data: orders.A}); await pending;
    assert.deepEqual(page.api.order.value, {});
    if (boundary !== 'unmount') assert.equal(page.api.visible.value, false);
    page.close();
  }
  {
    const held = deferred();
    const page = orderPage({foodPost: () => held.promise});
    await page.api.detail(orders.A);
    const pending = page.api.resolveRefund('APPROVE');
    await Promise.resolve();
    await page.api.detail(orders.B);
    held.resolve(); await pending;
    assert.equal(page.api.order.value.id, 'B'); page.close();
  }
  console.log('PASS old detail responses cannot reopen closed/failed views; mutation responses cannot replace a subsequently opened order');

  {
    const posts = [], dialog = component('admin/src/views/food/SellingDialog.vue', {foodPost: async (route, body) => posts.push(body)});
    const expired = {id: 1, sold_out: 1, sold_out_until: '2020-01-01 00:00:00', sale_periods: '', version: 1};
    dialog.api.open(expired);
    assert.equal(dialog.api.form.value.soldOut, false); assert.equal(dialog.api.form.value.until, '');
    dialog.api.form.value.periods = '11:00-14:00'; await dialog.api.save();
    assert.equal(posts[0].periods, '11:00-14:00'); assert.equal(posts[0].until, '');
    for (const until of ['', '2099-01-01 00:00:00']) {
      dialog.api.open({...expired, sold_out_until: until});
      assert.equal(dialog.api.form.value.soldOut, true);
      await dialog.api.save(); assert.equal(posts.at(-1).until, until);
    }
    dialog.api.form.value.until = expired.sold_out_until;
    dialog.api.form.value.soldOut = false; await dialog.api.save();
    assert.equal(posts.at(-1).until, ''); dialog.close();
  }
  console.log('PASS expired sold-out settings open as available; active schedules persist; disabling drops hidden recovery time');

  for (const kind of ['stores', 'products']) {
    const posts = [], row = {id: 7, name: 'Old name', active: 1, delivery_fee: 200, version: 3};
    const page = component('admin/src/views/food/Catalog.vue', {
      foodGet: async () => ({data: {rows: [], total: 0}}), foodPost: async (route, body) => posts.push({route, body}),
      ElMessageBox: {confirm: async () => {}}
    }, {kind});
    await page.api.toggle(row);
    assert.deepEqual(posts, [kind === 'stores' ? {route: '/stores/7/active', body: {active: 0}} : {route: '/products', body: {...row, active: 0}}]);
    page.close();
  }
  console.log('PASS store toggle sends only active; product toggle retains optimistic version protection');
}

module.exports = {component};
if (require.main === module) test().catch(error => {console.error(error); process.exitCode = 1;});
