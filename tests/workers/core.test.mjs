// styrigx-daymark-core（workers/core）：
// - 路由表与 src/api 接口文件一一对应
// - /api/today 公开（CORS 只给 styrigx.com），其余先问网关；网关出错 → 500 不是 401
// - 读：visitor 只看公开，owner 看全部；写：非同源 403、visitor 403、校验、增改删
// - 今日一句：只从公开里挑，同一天固定，按北京时间换天
// - wrangler.toml：不开 workers.dev，只挂 daymark.styrigx.com/api/*，服务绑定网关，不持钥匙
// SQL 用 node:sqlite 真跑（CI 用 Node 22）。
// 运行：node --test tests/workers/core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = REPO + '/workers/core';
const worker = (await import(W + '/src/index.js')).default;
const { API_ROUTES } = await import(W + '/src/routes.js');
const Q = await import(W + '/src/api/_quotes.js');

/** node:sqlite 包成 D1 的样子 */
function makeD1() {
  const db = new DatabaseSync(':memory:');
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => db.prepare(sql).run(...args),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => list.map((s) => s._exec()),
  };
}
function auth(role = null, throws = false) {
  return {
    async session() {
      if (throws) throw new Error('down');
      return role ? { ok: true, role } : { ok: false, reason: 'no-cookie' };
    },
  };
}
const CTX = { waitUntil() {} };
const ORIGIN = 'https://daymark.styrigx.com';
function call(p, { role = null, db = makeD1(), method = 'GET', body, origin = ORIGIN, throws = false } = {}) {
  const headers = { Cookie: 'sgx-verified=x' };
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return worker.fetch(req, { AUTH: auth(role, throws), DB: db }, CTX);
}
const add = async (db, q) => (await (await call('/api/quotes', { role: 'owner', db, method: 'POST', body: q })).json()).quote;

test('路由表与 src/api 接口文件一一对应', () => {
  const files = readdirSync(W + '/src/api').filter((n) => n.endsWith('.js') && !n.startsWith('_')).map((n) => '/api/' + n.slice(0, -3)).sort();
  assert.deepEqual([...API_ROUTES.keys()].sort(), files);
});

test('未登录读 /api/quotes → 401，带运行标记；不存在 404；网关挂了 500', async () => {
  const r = await call('/api/quotes');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('X-Daymark-Runtime'), 'worker');
  assert.equal((await call('/api/nope', { role: 'owner' })).status, 404);
  assert.equal((await call('/api/quotes', { throws: true })).status, 500);
});

test('/api/today 公开：不验会话，CORS 只给 styrigx.com，空库 quote=null', async () => {
  const r = await call('/api/today?d=2026-10-20');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://styrigx.com');
  assert.deepEqual(await r.json(), { ok: true, day: '2026-10-20', quote: null });
  const o = await call('/api/today', { method: 'OPTIONS' });
  assert.equal(o.status, 204);
});

test('写：非同源 403、没 Origin 403、访客 403、未登录 401', async () => {
  const body = { text: 'x' };
  assert.equal((await call('/api/quotes', { role: 'owner', method: 'POST', body, origin: 'https://evil.com' })).status, 403);
  assert.equal((await call('/api/quotes', { role: 'owner', method: 'POST', body, origin: null })).status, 403);
  assert.equal((await call('/api/quotes', { role: 'visitor', method: 'POST', body })).status, 403);
  assert.equal((await call('/api/quotes', { method: 'POST', body })).status, 401);
});

test('新增：校验与规整；坏 JSON 400；空句子 400', async () => {
  const db = makeD1();
  assert.equal((await call('/api/quotes', { role: 'owner', db, method: 'POST', body: '{x' })).status, 400);
  const r = await call('/api/quotes', { role: 'owner', db, method: 'POST', body: { text: '  ' } });
  assert.equal((await r.json()).error, 'bad-text');
  const q = await add(db, { text: ' 第一行\r\n\n\n\n第二行 ', author: '鲁迅', source: '《呐喊》', tags: '#人生, 勇气 人生', visibility: 'private' });
  assert.match(q.id, /^[0-9a-f]{12}$/);
  assert.equal(q.text, '第一行\n\n第二行');
  assert.deepEqual(q.tags, ['人生', '勇气']);
  assert.equal(q.visibility, 'private');
  assert.equal((await call('/api/quotes', { role: 'owner', db, method: 'POST', body: { text: 'x', visibility: 'secret' } })).status, 400);
});

test('读：访客只拿公开，主人拿全部且 owner=true', async () => {
  const db = makeD1();
  await add(db, { text: '公开' });
  await add(db, { text: '私密', visibility: 'private' });
  const v = await (await call('/api/quotes', { role: 'visitor', db })).json();
  assert.equal(v.owner, false);
  assert.deepEqual(v.quotes.map((q) => q.text), ['公开']);
  const o = await (await call('/api/quotes', { role: 'owner', db })).json();
  assert.equal(o.owner, true);
  assert.equal(o.quotes.length, 2);
});

test('改、删：只改给的字段；id 不对 400；不存在 404', async () => {
  const db = makeD1();
  const q = await add(db, { text: '原句', author: '甲', tags: ['a'] });
  const r = await call('/api/quotes?id=' + q.id, { role: 'owner', db, method: 'PUT', body: { trans: 'Original', tags: [] } });
  const u = (await r.json()).quote;
  assert.equal(u.text, '原句');
  assert.equal(u.author, '甲');
  assert.equal(u.trans, 'Original');
  assert.deepEqual(u.tags, []);
  assert.equal((await call('/api/quotes?id=zz', { role: 'owner', db, method: 'PUT', body: { text: 'y' } })).status, 400);
  assert.equal((await call('/api/quotes?id=000000000000', { role: 'owner', db, method: 'PUT', body: { text: 'y' } })).status, 404);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'owner', db, method: 'PUT', body: {} })).status, 400);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'visitor', db, method: 'DELETE' })).status, 403);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'owner', db, method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'owner', db, method: 'DELETE' })).status, 404);
});

test('今日一句：只挑公开的；同一天固定；不同天会换', async () => {
  const db = makeD1();
  for (let i = 0; i < 12; i++) await add(db, { text: '句' + i });
  await add(db, { text: '私密', visibility: 'private' });
  const seen = new Set();
  for (let d = 1; d <= 20; d++) {
    const day = '2026-11-' + String(d).padStart(2, '0');
    const a = await (await call('/api/today?d=' + day, { db })).json();
    const b = await (await call('/api/today?d=' + day, { db })).json();
    assert.equal(a.quote.text, b.quote.text);
    assert.notEqual(a.quote.text, '私密');
    assert.ok(!('visibility' in a.quote));
    seen.add(a.quote.text);
  }
  assert.ok(seen.size > 3, '20 天里应该换过好几句');
});

test('北京时间换天：UTC 15:59 还是当天，16:00 是第二天', () => {
  assert.equal(Q.dayInShanghai(Date.parse('2026-10-20T15:59:00Z')), '2026-10-20');
  assert.equal(Q.dayInShanghai(Date.parse('2026-10-20T16:00:00Z')), '2026-10-21');
});

test('wrangler.toml：不开 workers.dev，只挂 daymark 的 /api/*，D1 + 网关服务绑定，没有钥匙', () => {
  const t = readFileSync(W + '/wrangler.toml', 'utf8');
  assert.match(t, /^name = "styrigx-daymark-core"$/m);
  assert.match(t, /^workers_dev = false$/m);
  assert.match(t, /^pattern = "daymark\.styrigx\.com\/api\/\*"$/m);
  assert.match(t, /^database_id = "[0-9a-f-]{36}"$/m);
  assert.match(t, /^service = "styrigx-auth-gateway"$/m);
  assert.doesNotMatch(t, /SGX_|r2_buckets/);
});
