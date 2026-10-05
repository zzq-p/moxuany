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

async function testCatalogUploads() {
  const file = uid => ({uid, type: 'image/png', size: 1024});
  // Element Plus calls beforeUpload with a raw file, then success/error with an UploadFile.
  const uploadFile = raw => ({uid: raw.uid, raw});
  const response = {code: 200, fileName: '/profile/new.png'};
  for (const boundary of ['switch', 'close', 'reopen', 'new-record', 'unmount', 'success']) {
    const messages = [], posts = [];
    const page = component('admin/src/views/food/Catalog.vue', {
      foodGet: async () => ({data: {rows: [], total: 0}}),
      foodPost: async (route, body) => posts.push({route, image: body.image}),
      ElMessage: {success: text => messages.push(text), error: text => messages.push(text)}
    }, {kind: 'products'});
    let aborts = 0, clears = 0;
    page.api.imageUpload.value = {abort() {aborts++;}, clearFiles() {clears++;}};
    const original = {id: 1, name: 'A', image: '/original.png'}, raw = file(1);
    page.api.edit(boundary === 'new-record' ? undefined : original);
    assert.equal(page.api.beforeUpload(raw), true);
    if (boundary === 'switch') page.api.edit({id: 2, name: 'B', image: '/other.png'});
    if (['close', 'reopen', 'new-record'].includes(boundary)) page.api.visible.value = false;
    if (boundary === 'reopen') page.api.edit(original);
    if (boundary === 'new-record') page.api.edit();
    if (boundary === 'unmount') page.close();
    const expected = page.api.form.value.image;
    page.api.uploaded(response, uploadFile(raw));
    assert.equal(page.api.form.value.image, boundary === 'success' ? response.fileName : expected, boundary);
    assert.equal(messages.length, boundary === 'success' ? 1 : 0, boundary);
    if (boundary === 'switch' || boundary === 'success') {
      await page.api.save();
      assert.equal(posts[0].image, boundary === 'success' ? response.fileName : '/other.png');
    }
    if (boundary !== 'success') {assert(aborts > 1); assert.equal(aborts, clears);}
    page.close();
  }
  {
    const messages = [], page = component('admin/src/views/food/Catalog.vue', {
      ElMessage: {success: text => messages.push(text), error: text => messages.push(text)}
    }, {kind: 'stores'});
    page.api.edit({id: 1, name: 'Store', image: '/original.png'});
    const older = file(1), newer = file(2);
    page.api.beforeUpload(older); page.api.beforeUpload(newer);
    page.api.uploaded({code: 200, fileName: '/newer.png'}, uploadFile(newer));
    page.api.uploaded({code: 200, fileName: '/older.png'}, uploadFile(older));
    assert.equal(page.api.form.value.image, '/newer.png'); assert.equal(messages.length, 1);
    const stale = file(3); page.api.beforeUpload(stale);
    page.api.edit({id: 2, image: '/other.png'});
    page.api.uploadFailed(Error('late failure'), uploadFile(stale));
    assert.equal(messages.length, 1);
    const rejected = file(4); page.api.beforeUpload(rejected);
    page.api.uploaded({code: 500, msg: 'Rejected upload'}, uploadFile(rejected));
    assert.equal(messages.at(-1), 'Rejected upload'); assert.equal(page.api.form.value.image, '/other.png');
    const failed = file(5); page.api.beforeUpload(failed);
    page.api.uploadFailed(Error('network'), uploadFile(failed));
    assert.equal(messages.at(-1), '图片上传失败，请重试');
    assert.equal(page.api.beforeUpload({...file(6), type: 'text/html'}), false);
    assert.equal(page.api.beforeUpload({...file(7), size: 6 * 1024 * 1024}), false);
    const retry = file(8); assert.equal(page.api.beforeUpload(retry), true);
    page.api.uploaded(response, uploadFile(retry));
    assert.equal(page.api.form.value.image, response.fileName); page.close();
  }
  console.log('PASS image uploads retain their editor and selection; switching, closing, reopening, new records and unmount discard stale callbacks; normal upload, retry and validation work');
}

async function testProductOptions() {
  const product = id => ({id, name: 'Product ' + id, price: 1000});
  const option = id => ({id, kind: 'SPEC', name: 'Option ' + id, price: 1000, stock: 20, active: 1, version: 0});
  for (const sameProduct of [false, true]) {
    const held = deferred(), posts = []; let reads = 0;
    const page = component('admin/src/views/food/ProductOptions.vue', {
      foodGet: () => ++reads === 1 ? held.promise : Promise.resolve({data: [option(202)]}),
      foodPost: async (route, body) => posts.push({route, body})
    });
    const pending = page.api.open(product(1));
    assert.equal(page.api.visible.value, true); assert.equal(page.api.loading.value, true);
    await page.api.save(); assert.equal(posts.length, 0, 'loading cannot submit empty options');
    await page.api.open(product(sameProduct ? 1 : 2));
    page.api.rows.value[0].price = 2500;
    held.resolve({data: [option(101)]}); await pending;
    assert.equal(page.api.rows.value[0].id, 202); assert.equal(page.api.rows.value[0].price, 2500);
    await page.api.save();
    assert.equal(posts[0].route, '/products/' + (sameProduct ? 1 : 2) + '/options');
    assert.deepEqual(posts[0].body, [{...option(202), price: 2500}]);
    assert.equal(page.api.visible.value, false); page.close();
  }
  for (const boundary of ['close', 'unmount', 'newer-failure', 'failure']) {
    const held = deferred(), posts = [];
    const page = component('admin/src/views/food/ProductOptions.vue', {
      foodGet: route => route === '/products/1/options' ? held.promise : Promise.reject(Error('newer load failed')),
      foodPost: async (...args) => posts.push(args)
    });
    const pending = page.api.open(product(1));
    if (boundary === 'close') page.api.visible.value = false;
    if (boundary === 'unmount') page.close();
    if (boundary === 'newer-failure') await page.api.open(product(2));
    if (boundary === 'failure') held.reject(Error('load failed'));
    else held.resolve({data: [option(101)]});
    await pending; await page.api.save();
    assert.deepEqual(page.api.rows.value, []); assert.equal(posts.length, 0);
    assert.equal(page.api.loading.value, false);
    if (boundary !== 'unmount') assert.equal(page.api.visible.value, false);
    page.close();
  }
  for (const boundary of ['switch', 'close', 'unmount', 'failure']) {
    const held = deferred(), nextSave = deferred(), posts = [], messages = [];
    const page = component('admin/src/views/food/ProductOptions.vue', {
      foodGet: async () => ({data: []}),
      foodPost: (route, body) => {posts.push({route, body}); return posts.length === 1 ? held.promise : nextSave.promise;},
      ElMessage: {success: text => messages.push(text)}
    });
    await page.api.open(product(1));
    page.api.rows.value.push(option(101));
    const pending = page.api.save(); await page.api.save(); assert.equal(posts.length, 1);
    page.api.rows.value[0].price = 2000;
    assert.equal(posts[0].body[0].price, 1000, 'in-flight payload is a snapshot');
    let newer;
    if (boundary === 'switch') {
      await page.api.open(product(2));
      newer = page.api.save(); assert.equal(posts.length, 2, 'successfully loaded empty options can be saved');
    }
    if (boundary === 'close') page.api.visible.value = false;
    if (boundary === 'unmount') page.close();
    if (boundary === 'failure') held.reject(Error('save failed')); else held.resolve();
    await pending; assert.equal(messages.length, 0);
    if (boundary === 'switch') {
      assert.equal(page.api.visible.value, true); assert.equal(page.api.product.value.id, 2);
      assert.equal(page.api.saving.value, true, 'old save must not reset the newer save');
      nextSave.resolve(); await newer; assert.equal(page.api.visible.value, false);
    } else if (boundary === 'failure') {
      assert.equal(page.api.visible.value, true); assert.equal(page.api.saving.value, false);
      const retry = page.api.save(); nextSave.resolve(); await retry;
      assert.equal(page.api.visible.value, false); assert.equal(messages.length, 1);
    }
    page.close();
  }
  console.log('PASS product options ignore old loads/saves across editor changes and lifecycle; loading/failure cannot submit, current drafts survive, duplicate saves are blocked and retry/empty options work');
}

async function test() {
  await testCatalogUploads();
  await testProductOptions();
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
