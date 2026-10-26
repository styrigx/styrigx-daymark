// styrigx-daymark-core（workers/core）：
// - 路由表与 src/api 接口文件一一对应
// - /api/today 公开（CORS 只给 styrigx.com），其余先问网关；网关出错 → 500 不是 401
// - 读：visitor 只看公开，admin 看全部；写：非同源 403、visitor 403、校验、增改删
// - 今日一句：只从公开里挑，同一天固定，按北京时间换天；当天第一次请求锁进 daily_pick（加句子不变）；
//   GET 只给今天（?d= 别的日期 / 格式不对 400）；缓存不跨过北京时间零点；边缘缓存键只认当天，写操作后清掉；
//   记下的那句被删 / 改私密就重挑；PUT /api/today 设为今日只给管理员 + 同源（未登录 401、访客 403、私密 409）
// - 三页签：出处类型、随手一笔（访客和 /api/today 永不返回）、百味专题的增删改、归属与排序、访客只见公开
// - 迁移 0001 + 0002 依次跑在 SQLite 上，接口照常工作
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
const TD = await import(W + '/src/api/_today.js');
const { isPublic } = await import(W + '/src/index.js');

/** node:sqlite 包成 D1 的样子（batch 和 D1 一样是一个事务，每条回 { meta: { changes } }） */
function makeD1(db = new DatabaseSync(':memory:')) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
function auth(role = null, throws = false) {
  return {
    async lockSession() {
      if (throws) throw new Error('down');
      return role ? { ok: true, role } : { ok: false, reason: 'no-cookie' };
    },
  };
}
const CTX = { waitUntil() {} };
const ORIGIN = 'https://daymark.styrigx.com';
function call(p, { role = null, db = makeD1(), method = 'GET', body, origin = ORIGIN, throws = false } = {}) {
  const headers = { Cookie: 'sgx-lock-session=x' };
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return worker.fetch(req, { AUTH: auth(role, throws), D1_QUOTES: db, KV_SEARCH_INDEX: { async put() {} } }, CTX);
}
const add = async (db, q) => (await (await call('/api/quotes', { role: 'admin', db, method: 'POST', body: q })).json()).quote;

test('路由表与 src/api 接口文件一一对应', () => {
  const files = readdirSync(W + '/src/api').filter((n) => n.endsWith('.js') && !n.startsWith('_')).map((n) => '/api/' + n.slice(0, -3)).sort();
  assert.deepEqual([...API_ROUTES.keys()].sort(), files);
});

test('未登录读 /api/quotes → 401，带运行标记；不存在 404；网关挂了 500', async () => {
  const r = await call('/api/quotes');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('X-Daymark-Runtime'), 'worker');
  assert.equal((await call('/api/nope', { role: 'admin' })).status, 404);
  assert.equal((await call('/api/quotes', { throws: true })).status, 500);
});

test('网关回答：只认 AuthVerifier.lockSession 的 admin / visitor；别的角色当无效会话，没有 lockSession 方法当绑定缺失', async () => {
  assert.equal((await call('/api/quotes', { role: 'owner' })).status, 401);
  assert.equal((await call('/api/quotes', { role: 'admin' })).status, 200);
  /* /api/lock-session-check 线上由网关的精确路由回答；万一落到本 Worker，同样问网关 */
  assert.equal((await call('/api/lock-session-check')).status, 401);
  assert.deepEqual(await (await call('/api/lock-session-check', { role: 'visitor' })).json(), { ok: true });
  const req = new Request(ORIGIN + '/api/quotes', { headers: { Cookie: 'sgx-lock-session=x' } });
  const legacy = { async session() { return { ok: true, role: 'admin' }; } };
  const errs = console.error;
  console.error = () => {};
  try {
    assert.equal((await worker.fetch(req, { AUTH: legacy, D1_QUOTES: makeD1(), KV_SEARCH_INDEX: { async put() {} } }, CTX)).status, 500);
  } finally {
    console.error = errs;
  }
});

test('/api/today 公开：不验会话，CORS 只给 styrigx.com，空库 quote=null', async () => {
  const r = await call('/api/today');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://styrigx.com');
  assert.deepEqual(await r.json(), { ok: true, day: Q.dayInShanghai(), quote: null });
  const o = await call('/api/today', { method: 'OPTIONS' });
  assert.equal(o.status, 204);
});

test('每个接口请求只问网关一次（index.js 验过的角色经 context.data.role 传给 handler）；公开的 GET /api/today 不问', async () => {
  let n = 0;
  const counting = (role) => ({ async lockSession() { n++; return { ok: true, role }; } });
  const db = makeD1();
  const env = (role) => ({ AUTH: counting(role), D1_QUOTES: db, KV_SEARCH_INDEX: { async put() {} } });
  const req = (p, method = 'GET', body) => new Request(ORIGIN + p, {
    method,
    headers: { Cookie: 'sgx-lock-session=x', Origin: ORIGIN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const go = async (role, p, method, body) => {
    n = 0;
    const res = await worker.fetch(req(p, method, body), env(role), CTX);
    return { res, n };
  };
  let r = await go('admin', '/api/quotes', 'POST', { text: '一句' });
  assert.equal(r.res.status, 201);
  assert.equal(r.n, 1);
  const id = (await r.res.json()).quote.id;
  for (const [role, p, method, body] of [
    ['admin', '/api/quotes'],
    ['visitor', '/api/quotes'],
    ['admin', '/api/collections'],
    ['visitor', '/api/collections'],
    ['admin', '/api/quotes?id=' + id, 'PUT', { trans: 'A line' }],
    ['visitor', '/api/quotes?id=' + id, 'PUT', { trans: 'x' }],
    ['admin', '/api/collections', 'POST', { name: '晨读' }],
    ['admin', '/api/today', 'PUT', { id }],
    ['visitor', '/api/today', 'PUT', { id }],
  ]) {
    r = await go(role, p, method, body);
    assert.ok(r.res.status < 500, p + ' ' + r.res.status);
    assert.equal(r.n, 1, role + ' ' + (method || 'GET') + ' ' + p);
  }
  r = await go('visitor', '/api/quotes?id=' + id, 'DELETE');
  assert.equal(r.res.status, 403);
  assert.equal(r.n, 1);
  r = await go('admin', '/api/quotes?id=' + id, 'DELETE');
  assert.equal(r.res.status, 200);
  assert.equal(r.n, 1);
  r = await go(null, '/api/today');
  assert.equal(r.res.status, 200);
  assert.equal(r.n, 0);
  /* handler 被直接调用（没有 context.data.role）时仍自己问网关；data.role 只认 admin / visitor */
  const A = await import(W + '/src/api/_auth.js');
  n = 0;
  assert.equal(await A.sessionRole({ request: req('/api/quotes'), env: env('admin'), data: {} }), 'admin');
  assert.equal(n, 1);
  n = 0;
  assert.equal(await A.sessionRole({ request: req('/api/quotes'), env: env('admin'), data: { role: 'visitor' } }), 'visitor');
  assert.equal(n, 0);
  assert.equal(await A.sessionRole({ request: req('/api/quotes'), env: env('visitor'), data: { role: 'owner' } }), 'visitor');
  assert.equal(n, 1);
});

test('接口响应都带 nosniff 和 HSTS（core 不经过网关，自己补；公开的 /api/today 也有）', async () => {
  for (const r of [await call('/api/quotes'), await call('/api/quotes', { role: 'admin' }), await call('/api/today'), await call('/api/nope', { role: 'admin' }), await call('/api/quotes', { throws: true })]) {
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(r.headers.get('Strict-Transport-Security'), 'max-age=31536000');
    assert.equal(r.headers.get('X-Daymark-Runtime'), 'worker');
  }
});

test('删句子：句子和专题归属在同一个事务里删；第二条失败时句子也不删', async () => {
  const db = makeD1();
  const q = await add(db, { text: '要删的' });
  const c = (await (await call('/api/collections', { role: 'admin', db, method: 'POST', body: { name: '晨读' } })).json()).collection;
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'PUT', body: { collections: [c.id] } })).status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM collection_quotes WHERE quote_id = ?').get(q.id).n, 1);
  db.raw.exec("CREATE TRIGGER boom BEFORE DELETE ON collection_quotes BEGIN SELECT RAISE(ABORT, 'boom'); END");
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'DELETE' })).status, 500);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM quotes WHERE id = ?').get(q.id).n, 1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM collection_quotes WHERE quote_id = ?').get(q.id).n, 1);
  db.raw.exec('DROP TRIGGER boom');
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'DELETE' })).status, 200);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM quotes WHERE id = ?').get(q.id).n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM collection_quotes WHERE quote_id = ?').get(q.id).n, 0);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'DELETE' })).status, 404);
});

test('写：非同源 403、没 Origin 403、访客 403、未登录 401', async () => {
  const body = { text: 'x' };
  assert.equal((await call('/api/quotes', { role: 'admin', method: 'POST', body, origin: 'https://evil.com' })).status, 403);
  assert.equal((await call('/api/quotes', { role: 'admin', method: 'POST', body, origin: null })).status, 403);
  assert.equal((await call('/api/quotes', { role: 'visitor', method: 'POST', body })).status, 403);
  assert.equal((await call('/api/quotes', { method: 'POST', body })).status, 401);
});

test('新增：校验与规整；坏 JSON 400；空句子 400', async () => {
  const db = makeD1();
  assert.equal((await call('/api/quotes', { role: 'admin', db, method: 'POST', body: '{x' })).status, 400);
  const r = await call('/api/quotes', { role: 'admin', db, method: 'POST', body: { text: '  ' } });
  assert.equal((await r.json()).error, 'bad-text');
  const q = await add(db, { text: ' 第一行\r\n\n\n\n第二行 ', author: '鲁迅', source: '《呐喊》', tags: '#人生, 勇气 人生', visibility: 'private' });
  assert.match(q.id, /^[0-9a-f]{12}$/);
  assert.equal(q.text, '第一行\n\n第二行');
  assert.deepEqual(q.tags, ['人生', '勇气']);
  assert.equal(q.visibility, 'private');
  assert.equal((await call('/api/quotes', { role: 'admin', db, method: 'POST', body: { text: 'x', visibility: 'secret' } })).status, 400);
});

test('读：访客只拿公开，管理员拿全部且 admin=true', async () => {
  const db = makeD1();
  await add(db, { text: '公开' });
  await add(db, { text: '私密', visibility: 'private' });
  const v = await (await call('/api/quotes', { role: 'visitor', db })).json();
  assert.equal(v.admin, false);
  assert.deepEqual(v.quotes.map((q) => q.text), ['公开']);
  const o = await (await call('/api/quotes', { role: 'admin', db })).json();
  assert.equal(o.admin, true);
  assert.equal(o.quotes.length, 2);
});

test('改、删：只改给的字段；id 不对 400；不存在 404', async () => {
  const db = makeD1();
  const q = await add(db, { text: '原句', author: '甲', tags: ['a'] });
  const r = await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'PUT', body: { trans: 'Original', tags: [] } });
  const u = (await r.json()).quote;
  assert.equal(u.text, '原句');
  assert.equal(u.author, '甲');
  assert.equal(u.trans, 'Original');
  assert.deepEqual(u.tags, []);
  assert.equal((await call('/api/quotes?id=zz', { role: 'admin', db, method: 'PUT', body: { text: 'y' } })).status, 400);
  assert.equal((await call('/api/quotes?id=000000000000', { role: 'admin', db, method: 'PUT', body: { text: 'y' } })).status, 404);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'PUT', body: {} })).status, 400);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'visitor', db, method: 'DELETE' })).status, 403);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'DELETE' })).status, 404);
});

test('今日一句：只挑公开的；同一天固定；不同天会换', async () => {
  const db = makeD1();
  for (let i = 0; i < 12; i++) await add(db, { text: '句' + i });
  await add(db, { text: '私密', visibility: 'private' });
  /* 接口只给今天：同一天两次一样 */
  const a = await (await call('/api/today', { db })).json();
  const b = await (await call('/api/today', { db })).json();
  assert.equal(a.quote.text, b.quote.text);
  assert.notEqual(a.quote.text, '私密');
  assert.ok(!('visibility' in a.quote));
  /* 别的日期不走接口了（?d= 400），挑句规则直接测 resolveDay（只读不写） */
  const seen = new Set();
  for (let d = 1; d <= 20; d++) {
    const day = '2026-11-' + String(d).padStart(2, '0');
    const x = TD.publicQuote(await TD.resolveDay(db, day));
    const y = TD.publicQuote(await TD.resolveDay(db, day));
    assert.equal(x.text, y.text);
    assert.notEqual(x.text, '私密');
    assert.ok(!('visibility' in x));
    seen.add(x.text);
  }
  assert.ok(seen.size > 3, '20 天里应该换过好几句');
});

test('/api/today 只给今天：?d= 是今天照常；别的日期、格式不对、空值 → 400 bad-day，也不碰 D1', async () => {
  const db = makeD1();
  for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
  const t = await call('/api/today?d=' + Q.dayInShanghai(), { db });
  assert.equal(t.status, 200);
  assert.equal((await t.json()).day, Q.dayInShanghai());
  let reads = 0;
  const spy = { ...db, prepare: (sql) => { reads++; return db.prepare(sql); } };
  for (const d of ['2026-01-02', '2099-12-31', '2026-1-2', 'today', '', '2026-01-02T00:00', Q.dayInShanghai() + 'x']) {
    reads = 0;
    const r = await call('/api/today?d=' + encodeURIComponent(d), { db: spy });
    assert.equal(r.status, 400, 'd=' + d);
    assert.deepEqual(await r.json(), { ok: false, error: 'bad-day' });
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(reads, 0, '400 不碰 D1：d=' + d);
  }
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM daily_pick WHERE day != ?").get(Q.dayInShanghai()).n, 0);
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
  assert.match(t, /^entrypoint = "AuthVerifier"$/m);
  assert.doesNotMatch(t, /SGX_|r2_buckets/);
});

/* ================= 三页签：出处类型、随手一笔、百味专题 ================= */
const addC = async (db, c) => (await (await call('/api/collections', { role: 'admin', db, method: 'POST', body: c })).json()).collection;
const listC = async (db, role) => (await (await call('/api/collections', { role, db })).json());

test('出处类型 + 随手一笔：管理员拿得到；类型不合法 400', async () => {
  const db = makeD1();
  const q = await add(db, { text: '床前明月光', author: '李白', source: '静夜思', source_type: 'poetry', note: '小时候背的第一首' });
  assert.equal(q.source_type, 'poetry');
  assert.equal(q.note, '小时候背的第一首');
  assert.deepEqual(q.collections, []);
  assert.equal((await call('/api/quotes', { role: 'admin', db, method: 'POST', body: { text: 'x', source_type: 'tv' } })).status, 400);
  const u = (await (await call('/api/quotes?id=' + q.id, { role: 'admin', db, method: 'PUT', body: { source_type: '', note: '改了' } })).json()).quote;
  assert.equal(u.source_type, '');
  assert.equal(u.note, '改了');
  const o = await (await call('/api/quotes', { role: 'admin', db })).json();
  assert.equal(o.quotes[0].note, '改了');
});

test('随手一笔不外泄：访客列表、访客专题、/api/today 都没有 note 键，也没有内容', async () => {
  const db = makeD1();
  const SECRET = '只给自己看的悄悄话';
  const q = await add(db, { text: '公开的一句', note: SECRET });
  const c = await addC(db, { name: '晨读' });
  await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'PUT', body: { quote_ids: [q.id] } });
  const vr = await call('/api/quotes', { role: 'visitor', db });
  const vt = await vr.text();
  assert.ok(!vt.includes(SECRET));
  const v = JSON.parse(vt);
  assert.equal(v.quotes.length, 1);
  assert.ok(!('note' in v.quotes[0]));
  assert.ok(!('collections' in v.quotes[0]));
  const ct = await (await call('/api/collections', { role: 'visitor', db })).text();
  assert.ok(!ct.includes(SECRET));
  const t = await (await call('/api/today', { db })).text();
  assert.ok(!t.includes(SECRET));
  assert.ok(!('note' in JSON.parse(t).quote));
  assert.ok(!('visibility' in JSON.parse(t).quote));
  for (let d = 1; d <= 3; d++) {
    const pq = JSON.stringify(TD.publicQuote(await TD.resolveDay(db, '2026-12-0' + d)));
    assert.ok(!pq.includes(SECRET));
    assert.ok(!('note' in JSON.parse(pq)) && !('visibility' in JSON.parse(pq)));
  }
});

test('百味专题：新建校验、写操作只给管理员 + 同源', async () => {
  const db = makeD1();
  assert.equal((await call('/api/collections', { role: 'admin', db, method: 'POST', body: { name: ' ' } })).status, 400);
  assert.equal((await call('/api/collections', { role: 'visitor', db, method: 'POST', body: { name: 'x' } })).status, 403);
  assert.equal((await call('/api/collections', { role: 'admin', db, method: 'POST', body: { name: 'x' }, origin: 'https://evil.com' })).status, 403);
  assert.equal((await call('/api/collections', { db, method: 'POST', body: { name: 'x' } })).status, 401);
  assert.equal((await call('/api/collections', { db })).status, 401);
  const a = await addC(db, { name: '  晨读  ', intro: '早上读的' });
  const b = await addC(db, { name: '电影台词' });
  assert.equal(a.name, '晨读');
  assert.equal(a.intro, '早上读的');
  assert.ok(b.sort > a.sort);
  assert.deepEqual(a.quote_ids, []);
  const o = await listC(db, 'admin');
  assert.equal(o.admin, true);
  assert.deepEqual(o.collections.map((c) => c.name), ['晨读', '电影台词']);
});

test('百味专题：归入（句子的 collections）、排序和移出（专题的 quote_ids）、删句子 / 删专题都清掉归属', async () => {
  const db = makeD1();
  const c = await addC(db, { name: '晨读' });
  const d = await addC(db, { name: '夜读' });
  const q1 = await add(db, { text: '一', collections: [c.id] });
  const q2 = await add(db, { text: '二', collections: [c.id, d.id, '000000000000'] });
  const q3 = await add(db, { text: '三' });
  assert.deepEqual(q2.collections, [c.id, d.id]);
  assert.equal((await call('/api/quotes', { role: 'admin', db, method: 'POST', body: { text: 'x', collections: ['bad'] } })).status, 400);
  let o = await listC(db, 'admin');
  assert.deepEqual(o.collections[0].quote_ids, [q1.id, q2.id]);
  /* 编辑句子时加入：排到末尾 */
  const u3 = (await (await call('/api/quotes?id=' + q3.id, { role: 'admin', db, method: 'PUT', body: { collections: [c.id] } })).json()).quote;
  assert.deepEqual(u3.collections, [c.id]);
  o = await listC(db, 'admin');
  assert.deepEqual(o.collections[0].quote_ids, [q1.id, q2.id, q3.id]);
  /* 排序 + 移出 */
  const r = await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'PUT', body: { quote_ids: [q3.id, q1.id], name: '晨读·改' } });
  const cc = (await r.json()).collection;
  assert.deepEqual(cc.quote_ids, [q3.id, q1.id]);
  assert.equal(cc.name, '晨读·改');
  /* 句子自己的归属跟着变 */
  const all = (await (await call('/api/quotes', { role: 'admin', db })).json()).quotes;
  assert.deepEqual(all.find((q) => q.id === q2.id).collections, [d.id]);
  /* 句子里只改正文，归属不动 */
  const u1 = (await (await call('/api/quotes?id=' + q1.id, { role: 'admin', db, method: 'PUT', body: { text: '一·改' } })).json()).quote;
  assert.deepEqual(u1.collections, [c.id]);
  /* 删句子 → 从专题里消失 */
  await call('/api/quotes?id=' + q3.id, { role: 'admin', db, method: 'DELETE' });
  o = await listC(db, 'admin');
  assert.deepEqual(o.collections[0].quote_ids, [q1.id]);
  /* 坏参数 / 不存在 */
  assert.equal((await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'PUT', body: {} })).status, 400);
  assert.equal((await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'PUT', body: { quote_ids: 'x' } })).status, 400);
  assert.equal((await call('/api/collections?id=000000000000', { role: 'admin', db, method: 'PUT', body: { name: 'y' } })).status, 404);
  assert.equal((await call('/api/collections?id=zz', { role: 'admin', db, method: 'DELETE' })).status, 400);
  /* 删专题：句子还在，归属没了 */
  assert.equal((await call('/api/collections?id=' + c.id, { role: 'visitor', db, method: 'DELETE' })).status, 403);
  assert.equal((await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'DELETE' })).status, 404);
  const left = (await (await call('/api/quotes', { role: 'admin', db })).json()).quotes;
  assert.equal(left.length, 2);
  assert.deepEqual(left.find((q) => q.id === q1.id).collections, []);
});

test('百味专题 · 访客：只含公开句子，空专题不返回', async () => {
  const db = makeD1();
  const pub = await add(db, { text: '公开' });
  const pri = await add(db, { text: '私密', visibility: 'private' });
  const c = await addC(db, { name: '混合' });
  const e = await addC(db, { name: '只有私密' });
  await addC(db, { name: '空的' });
  await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'PUT', body: { quote_ids: [pri.id, pub.id] } });
  await call('/api/collections?id=' + e.id, { role: 'admin', db, method: 'PUT', body: { quote_ids: [pri.id] } });
  const v = await listC(db, 'visitor');
  assert.equal(v.admin, false);
  assert.deepEqual(v.collections.map((x) => x.name), ['混合']);
  assert.deepEqual(v.collections[0].quote_ids, [pub.id]);
  const o = await listC(db, 'admin');
  assert.equal(o.collections.length, 3);
  assert.deepEqual(o.collections[0].quote_ids, [pri.id, pub.id]);
});

test('迁移：0001 + 0002 + 0004 + 0005 依次跑完（0004、0005 重复跑不报错），老数据保留、新字段有默认值、接口可用', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(W + '/migrations/0001_init.sql', 'utf8'));
  raw.prepare("INSERT INTO quotes (id, text, created_at) VALUES ('aaaaaaaaaaaa', '老句子', 1)").run();
  raw.exec(readFileSync(W + '/migrations/0002_three_tabs.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0004_daily_pick.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0004_daily_pick.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0005_daily_pick_set_by_admin.sql', 'utf8'));
  const db = makeD1(raw);
  const o = await (await call('/api/quotes', { role: 'admin', db })).json();
  assert.equal(o.quotes[0].text, '老句子');
  assert.equal(o.quotes[0].source_type, '');
  assert.equal(o.quotes[0].note, '');
  const c = await addC(db, { name: '旧句' });
  assert.equal((await call('/api/collections?id=' + c.id, { role: 'admin', db, method: 'PUT', body: { quote_ids: ['aaaaaaaaaaaa'] } })).status, 200);
  /* 迁移里的列与兜底建表一致 */
  const cols = (t, d) => d.prepare('PRAGMA table_info(' + t + ')').all().map((r) => r.name).sort();
  const fresh = makeD1();
  await call('/api/quotes', { role: 'admin', db: fresh });
  for (const t of ['quotes', 'collections', 'collection_quotes', 'daily_pick']) assert.deepEqual(cols(t, raw), cols(t, fresh.raw), t);
});

test('迁移 0005：daily_pick.set_by 旧值 owner → admin，auto 不动，其余列原样；重复跑结果不变；没有 owner 相关的约束 / 默认值', async () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(W + '/migrations/0001_init.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0002_three_tabs.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0004_daily_pick.sql', 'utf8'));
  const ins = raw.prepare('INSERT INTO daily_pick (day, quote_id, set_by, set_at) VALUES (?, ?, ?, ?)');
  ins.run('2026-01-01', 'aaaaaaaaaaaa', 'owner', 11);
  ins.run('2026-01-02', 'bbbbbbbbbbbb', 'auto', 22);
  ins.run('2026-01-03', 'cccccccccccc', 'owner', 33);
  raw.prepare('INSERT INTO daily_pick (day, quote_id) VALUES (?, ?)').run('2026-01-04', 'dddddddddddd');
  const all = () => raw.prepare('SELECT day, quote_id, set_by, set_at FROM daily_pick ORDER BY day').all().map((r) => ({ ...r }));
  const sql = readFileSync(W + '/migrations/0005_daily_pick_set_by_admin.sql', 'utf8');
  const want = [
    { day: '2026-01-01', quote_id: 'aaaaaaaaaaaa', set_by: 'admin', set_at: 11 },
    { day: '2026-01-02', quote_id: 'bbbbbbbbbbbb', set_by: 'auto', set_at: 22 },
    { day: '2026-01-03', quote_id: 'cccccccccccc', set_by: 'admin', set_at: 33 },
    { day: '2026-01-04', quote_id: 'dddddddddddd', set_by: 'auto', set_at: 0 },
  ];
  raw.exec(sql);
  assert.deepEqual(all(), want);
  raw.exec(sql);
  assert.deepEqual(all(), want, '重复跑结果不变');
  const ddl = raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'daily_pick'").get().sql;
  assert.doesNotMatch(ddl, /owner|CHECK/i, '表定义里没有 owner 默认值或 CHECK，只改数据不用重建表');
  /* 代码里已经没有写 'owner' 的地方 */
  assert.doesNotMatch(readFileSync(W + '/src/api/_today.js', 'utf8').replace(/^\/\/.*$/gm, ''), /'owner'/);
});

/* ================= 种子迁移 0003_seed_quotes ================= */
test('种子迁移：全新库上连跑两次都不报错，得到 63 句 + 2 个专题，归属按 JSON 顺序', async () => {
  const raw = new DatabaseSync(':memory:');
  const seed = readFileSync(W + '/migrations/0003_seed_quotes.sql', 'utf8');
  raw.exec(readFileSync(W + '/migrations/0001_init.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0002_three_tabs.sql', 'utf8'));
  raw.exec(seed);
  raw.exec(seed);
  const n = (sql) => Number(raw.prepare(sql).get().n);
  assert.equal(n('SELECT COUNT(*) AS n FROM quotes'), 63);
  assert.equal(n('SELECT COUNT(*) AS n FROM collections'), 2);
  assert.equal(n('SELECT COUNT(*) AS n FROM collection_quotes'), 63);
  const cols = raw.prepare('SELECT name, intro, sort FROM collections ORDER BY sort').all().map((r) => ({ ...r }));
  assert.deepEqual(cols, [
    { name: '尼采', intro: '尼采原著摘句，英文为公版译本', sort: 0 },
    { name: '了不起的盖茨比', intro: '菲茨杰拉德原文摘句', sort: 1 },
  ]);
  /* 通过接口读：管理员看到两专题；访客看到的都是公开句子；note 为空、类型是 book */
  const db = makeD1(raw);
  const o = await (await call('/api/collections', { role: 'admin', db })).json();
  assert.equal(o.collections[0].quote_ids.length + o.collections[1].quote_ids.length, 63);
  const qs = (await (await call('/api/quotes', { role: 'visitor', db })).json()).quotes;
  assert.equal(qs.length, 63);
  assert.ok(qs.every((q) => q.source_type === 'book' && !('note' in q)));
  /* 拾录新的在前 = JSON 顺序；专题里也是 JSON 顺序 */
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  const first = byId[o.collections[0].quote_ids[0]];
  assert.equal(first.text, qs[0].text);
  assert.equal(first.author, '尼采');
  const gatsby = o.collections[1].quote_ids.map((id) => byId[id].text);
  assert.match(gatsby[gatsby.length - 1], /逆流而上/);
});

test('种子迁移：只增不删，已有的同正文句子不重复、专题已存在就并进去', () => {
  const raw = new DatabaseSync(':memory:');
  const seed = readFileSync(W + '/migrations/0003_seed_quotes.sql', 'utf8');
  for (const line of seed.split('\n').filter((l) => l && !l.startsWith('--'))) {
    assert.match(line, /^INSERT /);
    assert.doesNotMatch(line, /\b(DELETE|UPDATE|DROP|REPLACE INTO)\b/);
  }
  raw.exec(readFileSync(W + '/migrations/0001_init.sql', 'utf8'));
  raw.exec(readFileSync(W + '/migrations/0002_three_tabs.sql', 'utf8'));
  const sample = seed.match(/SELECT '[0-9a-f]{12}', '((?:[^']|'')*)'/)[1].replace(/''/g, "'");
  raw.prepare("INSERT INTO quotes (id, text, note, created_at) VALUES ('ffffffffffff', ?, '我的笔记', 1)").run(sample);
  raw.prepare("INSERT INTO quotes (id, text, created_at) VALUES ('eeeeeeeeeeee', '用户自己的句子', 2)").run();
  raw.prepare("INSERT INTO collections (id, name, intro, created_at, sort) VALUES ('dddddddddddd', '尼采', '我自己的简介', 1, 0)").run();
  raw.exec(seed);
  const n = (sql) => Number(raw.prepare(sql).get().n);
  assert.equal(n('SELECT COUNT(*) AS n FROM quotes'), 64);
  assert.equal(n('SELECT COUNT(*) AS n FROM quotes WHERE text = ' + "'" + sample.replace(/'/g, "''") + "'"), 1);
  assert.equal(raw.prepare("SELECT note FROM quotes WHERE id = 'ffffffffffff'").get().note, '我的笔记');
  assert.equal(n("SELECT COUNT(*) AS n FROM collections WHERE name = '尼采'"), 1);
  assert.equal(raw.prepare("SELECT intro FROM collections WHERE name = '尼采'").get().intro, '我自己的简介');
  assert.equal(n("SELECT COUNT(*) AS n FROM collection_quotes WHERE quote_id = 'ffffffffffff' AND collection_id = 'dddddddddddd'"), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM quotes WHERE id = 'eeeeeeeeeeee'"), 1);
});

test('种子迁移与生成脚本一致（设了 DAYMARK_SEED_JSON=<quotes.json> 时检查；种子原文不进仓库）', async (t) => {
  const SEED = process.env.DAYMARK_SEED_JSON;
  if (!SEED) return t.skip('没设 DAYMARK_SEED_JSON');
  const { seedSql } = await import(REPO + '/scripts/gen-seed-sql.mjs');
  assert.equal(seedSql(JSON.parse(readFileSync(SEED, 'utf8'))), readFileSync(W + '/migrations/0003_seed_quotes.sql', 'utf8'));
});

/* ================= 锁定今日一句 + 设为今日（daily_pick，迁移 0004） ================= */
const TODAY = () => Q.dayInShanghai();
const pickRow = (db, day = TODAY()) => { const r = db.raw.prepare('SELECT quote_id, set_by FROM daily_pick WHERE day = ?').get(day); return r ? { ...r } : null; };
const getToday = async (db, role = null, p = '/api/today') => (await call(p, { db, role })).json();
const setToday = (db, id, o = {}) => call('/api/today', { db, method: 'PUT', body: o.body !== undefined ? o.body : { id }, role: 'role' in o ? o.role : 'admin', origin: 'origin' in o ? o.origin : ORIGIN });

test('锁定：当天第一次请求挑好写进 daily_pick（auto），之后加句子当天也不变', async () => {
  const db = makeD1();
  for (let i = 0; i < 5; i++) await add(db, { text: '原有' + i });
  const a = await getToday(db);
  assert.equal(a.day, TODAY());
  assert.deepEqual(pickRow(db), { quote_id: a.quote.id, set_by: 'auto' });
  for (let i = 0; i < 30; i++) await add(db, { text: '新加' + i });
  for (const role of [null, 'visitor', 'admin']) assert.equal((await getToday(db, role)).quote.id, a.quote.id, String(role));
  assert.equal((await getToday(db, null, '/api/today?d=' + TODAY())).quote.id, a.quote.id);
  /* 初选仍是原来的规则：没锁时按 pickForDay 在当时的公开句子里挑 */
  const fresh = makeD1();
  for (let i = 0; i < 5; i++) await add(fresh, { text: '原有' + i });
  const ids = fresh.raw.prepare("SELECT id FROM quotes WHERE visibility = 'public' ORDER BY id").all().map((r) => ({ id: r.id }));
  assert.equal((await getToday(fresh)).quote.id, Q.pickForDay(ids, TODAY()).id);
});

test('锁定：别的日期接口不给（?d= 400、不写库）；resolveDay 看别的日期只读不写，那天有记录就读记录', async () => {
  const db = makeD1();
  for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
  assert.equal((await call('/api/today?d=2026-01-02', { db })).status, 400);
  assert.equal(pickRow(db, '2026-01-02'), null);
  await TD.resolveDay(db, '2026-01-02');
  assert.equal(pickRow(db, '2026-01-02'), null);
  const qs = db.raw.prepare('SELECT id FROM quotes ORDER BY id').all();
  db.raw.prepare("INSERT INTO daily_pick (day, quote_id, set_by, set_at) VALUES ('2026-01-02', ?, 'admin', 1)").run(qs[3].id);
  assert.equal((await TD.resolveDay(db, '2026-01-02')).id, qs[3].id);
});

test('锁定：记下的那句被删了 / 改成私密了 → 重挑一条公开的并重新锁住；空库不写', async () => {
  const db = makeD1();
  await getToday(db);
  assert.equal(pickRow(db), null, '没有句子不写记录');
  for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
  const first = (await getToday(db)).quote;
  assert.equal((await call('/api/quotes?id=' + first.id, { role: 'admin', db, method: 'DELETE' })).status, 200);
  const second = (await getToday(db)).quote;
  assert.notEqual(second.id, first.id);
  assert.deepEqual(pickRow(db), { quote_id: second.id, set_by: 'auto' });
  assert.equal((await call('/api/quotes?id=' + second.id, { role: 'admin', db, method: 'PUT', body: { visibility: 'private' } })).status, 200);
  for (const role of [null, 'visitor', 'admin']) {
    const t = await getToday(db, role);
    assert.notEqual(t.quote.id, second.id, '私密句子不出 /api/today：' + role);
    assert.ok(!('visibility' in t.quote) && !('note' in t.quote));
  }
  assert.notEqual(pickRow(db).quote_id, second.id);
});

test('锁定：resolveDay 同时首挑以先写进去的为准；persist=false 不写', async () => {
  const db = makeD1();
  await Q.ensureSchema(db);
  for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
  const day = '2026-03-04';
  const hit = await TD.resolveDay(db, day);
  assert.equal(pickRow(db, day), null);
  const other = db.raw.prepare('SELECT id FROM quotes WHERE id != ? ORDER BY id').get(hit.id).id;
  /* 模拟另一请求抢先写入：INSERT OR IGNORE 不覆盖，返回已写的那句 */
  db.raw.prepare("INSERT INTO daily_pick (day, quote_id, set_by, set_at) VALUES (?, ?, 'auto', 1)").run(day, other);
  assert.equal((await TD.resolveDay(db, day, { persist: true })).id, other);
});

test('设为今日：只管理员 + 同源；未登录 401、访客 403、非同源 / 没 Origin 403；GET 才公开', async () => {
  const db = makeD1();
  for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
  const before = (await getToday(db)).quote.id;
  const target = db.raw.prepare('SELECT id FROM quotes WHERE id != ? ORDER BY id').get(before).id;
  assert.equal((await setToday(db, target, { role: null })).status, 401);
  assert.equal((await setToday(db, target, { role: 'visitor' })).status, 403);
  assert.equal((await setToday(db, target, { origin: 'https://styrigx.com' })).status, 403);
  assert.equal((await setToday(db, target, { origin: 'https://evil.com' })).status, 403);
  assert.equal((await setToday(db, target, { origin: null })).status, 403);
  assert.equal((await call('/api/today', { db, method: 'PUT', body: { id: target }, throws: true })).status, 500);
  assert.equal((await getToday(db)).quote.id, before, '没设成就不变');
  assert.equal(pickRow(db).set_by, 'auto');
  assert.equal(isPublic('/api/today', 'GET'), true);
  assert.equal(isPublic('/api/today/', 'OPTIONS'), true);
  assert.equal(isPublic('/api/today', 'PUT'), false);
  assert.equal((await call('/api/today', { db, method: 'DELETE', role: 'admin' })).status, 405);
});

test('设为今日：管理员改写当天这一句；所有人的 GET 跟着变；之后加句子也不变；校验 / 404 / 私密 409', async () => {
  const db = makeD1();
  for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
  const pri = await add(db, { text: '私密', visibility: 'private', note: '心里话' });
  const before = (await getToday(db)).quote.id;
  const target = db.raw.prepare("SELECT id FROM quotes WHERE id != ? AND visibility = 'public' ORDER BY id").get(before).id;
  assert.equal((await setToday(db, null, { body: '{x' })).status, 400);
  assert.equal((await (await setToday(db, 'nope')).json()).error, 'bad-id');
  assert.equal((await setToday(db, 'ffffffffffff')).status, 404);
  const p = await setToday(db, pri.id);
  assert.equal(p.status, 409);
  assert.equal((await p.json()).error, 'private');
  assert.equal(pickRow(db).quote_id, before);
  const r = await setToday(db, target);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.day, TODAY());
  assert.equal(j.quote.id, target);
  assert.deepEqual(Object.keys(j.quote).sort(), ['author', 'id', 'source', 'source_type', 'tags', 'text', 'trans']);
  assert.deepEqual(pickRow(db), { quote_id: target, set_by: 'admin' });
  for (const role of [null, 'visitor', 'admin']) assert.equal((await getToday(db, role)).quote.id, target, String(role));
  for (let i = 0; i < 10; i++) await add(db, { text: '再加' + i });
  assert.equal((await getToday(db)).quote.id, target);
  /* 再设一次照样覆盖 */
  assert.equal((await (await setToday(db, before)).json()).quote.id, before);
  assert.equal((await getToday(db)).quote.id, before);
  /* GET 的缓存：公开、最多一分钟、不跨过北京时间零点（管理员改了之后主站很快跟上） */
  const cc = (await call('/api/today', { db })).headers.get('Cache-Control');
  const m = /^public, max-age=(\d+), s-maxage=(\d+)$/.exec(cc) || /^public, max-age=(0), must-revalidate$/.exec(cc);
  assert.ok(m, cc);
  assert.ok(Number(m[1]) <= 60);
});

/* ================= /api/today 缓存：不跨过换天；边缘缓存（caches.default） ================= */
const TODAY_JS = await import(W + '/src/api/today.js');

test('缓存秒数：最多 60 秒，离北京时间零点不足 60 秒时只缓存到零点，零点前最后一秒不缓存', () => {
  const at = (s) => Date.parse(s);
  assert.equal(TODAY_JS.cacheSeconds(at('2026-10-26T12:00:00+08:00')), 60);
  assert.equal(TODAY_JS.cacheSeconds(at('2026-10-26T23:58:59+08:00')), 60);
  assert.equal(TODAY_JS.cacheSeconds(at('2026-10-26T23:59:30+08:00')), 30);
  assert.equal(TODAY_JS.cacheSeconds(at('2026-10-26T23:59:59.500+08:00')), 0);
  assert.equal(TODAY_JS.cacheSeconds(at('2026-10-27T00:00:00+08:00')), 60);
  /* UTC 16:00 就是北京零点 */
  assert.equal(TODAY_JS.cacheSeconds(at('2026-10-26T15:59:45Z')), 15);
});

test('_lib.js 的 json() / err() 自己就带 nosniff（不只靠 index.js 的 tag()）', async () => {
  const L = await import(W + '/src/api/_lib.js');
  assert.equal(L.json({ ok: true }).headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(L.err('x').headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(L.json({ ok: true }, 200, { 'Cache-Control': 'public, max-age=1' }).headers.get('X-Content-Type-Options'), 'nosniff');
});

/** 假的 caches.default：按 URL 存；记下 put / delete 的键 */
function fakeCaches() {
  const store = new Map();
  const log = { put: [], del: [] };
  const def = {
    async match(req) { const r = store.get(new URL(req.url).toString()); return r ? new Response(r.body, { status: r.status, headers: r.headers }) : undefined; },
    async put(req, res) { log.put.push(req.url); store.set(req.url, { body: await res.text(), status: res.status, headers: [...res.headers] }); },
    async delete(req) { log.del.push(req.url); return store.delete(req.url); },
  };
  return { caches: { default: def }, store, log };
}
async function withCaches(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'caches');
  const old = globalThis.caches;
  const f = fakeCaches();
  globalThis.caches = f.caches;
  try {
    await fn(f);
  } finally {
    if (had) globalThis.caches = old;
    else delete globalThis.caches;
  }
}
/** 和 call 一样，但收集 waitUntil 的 promise 并等完 */
async function callWait(p, o = {}) {
  const pending = [];
  const ctx = { waitUntil: (x) => pending.push(x) };
  const headers = { Cookie: 'sgx-lock-session=x', Origin: 'origin' in o ? o.origin : ORIGIN };
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(ORIGIN + p, { method: o.method || 'GET', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = await worker.fetch(req, { AUTH: auth(o.role || null), D1_QUOTES: o.db, KV_SEARCH_INDEX: { async put() {} } }, ctx);
  await Promise.all(pending);
  return res;
}

test('边缘缓存：第一次读 D1 并存一份（键只有当天日期）；之后命中不碰 D1；乱加查询串也打不穿', async () => {
  await withCaches(async ({ store, log }) => {
    const db = makeD1();
    for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
    let reads = 0;
    const spy = { ...db, prepare: (sql) => { reads++; return db.prepare(sql); } };
    const a = await callWait('/api/today', { db: spy });
    assert.equal(a.status, 200);
    const ja = await a.json();
    assert.ok(reads > 0);
    if (TODAY_JS.cacheSeconds() === 0) return; /* 正好卡在零点前最后一秒：不缓存，后面不测 */
    assert.deepEqual(log.put, [ORIGIN + '/api/today?day=' + Q.dayInShanghai()]);
    for (const p of ['/api/today', '/api/today?x=1', '/api/today?d=' + Q.dayInShanghai(), '/api/today/']) {
      reads = 0;
      const r = await callWait(p, { db: spy });
      assert.equal(r.status, 200, p);
      assert.deepEqual(await r.json(), ja, p);
      assert.equal(reads, 0, '命中缓存不碰 D1：' + p);
      assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://styrigx.com');
      assert.match(r.headers.get('Cache-Control'), /^public, max-age=\d+, s-maxage=\d+$/);
    }
    assert.equal(store.size, 1);
    assert.equal(log.put.length, 1);
    /* 400 不进缓存 */
    assert.equal((await callWait('/api/today?d=2026-01-02', { db: spy })).status, 400);
    assert.equal(store.size, 1);
  });
});

test('边缘缓存：命中时 Cache-Control 按现在重算，浏览器缓存也不跨过北京时间零点', async () => {
  const realNow = Date.now;
  await withCaches(async ({ log }) => {
    try {
      const db = makeD1();
      for (let i = 0; i < 3; i++) await add(db, { text: '句' + i });
      Date.now = () => Date.parse('2026-10-26T23:58:30+08:00');
      const a = await callWait('/api/today', { db });
      assert.equal(a.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
      assert.deepEqual(log.put, [ORIGIN + '/api/today?day=2026-10-26']);
      Date.now = () => Date.parse('2026-10-26T23:59:50+08:00');
      let reads = 0;
      const spy = { ...db, prepare: (sql) => { reads++; return db.prepare(sql); } };
      const b = await callWait('/api/today', { db: spy });
      assert.equal(reads, 0);
      assert.equal(b.headers.get('Cache-Control'), 'public, max-age=10, s-maxage=10');
      /* 换天：键带日期，不会读到昨天那份 */
      Date.now = () => Date.parse('2026-10-27T00:00:01+08:00');
      const c = await (await callWait('/api/today', { db: spy })).json();
      assert.equal(c.day, '2026-10-27');
      assert.ok(reads > 0);
    } finally {
      Date.now = realNow;
    }
  });
});

test('边缘缓存：设为今日、改句子（改私密 / 删）之后清掉今天那份，下一次 GET 拿到新的', async () => {
  await withCaches(async ({ store, log }) => {
    const db = makeD1();
    for (let i = 0; i < 6; i++) await add(db, { text: '句' + i });
    const key = ORIGIN + '/api/today?day=' + Q.dayInShanghai();
    const before = (await (await callWait('/api/today', { db })).json()).quote.id;
    const target = db.raw.prepare("SELECT id FROM quotes WHERE id != ? ORDER BY id").get(before).id;
    const s = await callWait('/api/today', { db, method: 'PUT', body: { id: target }, role: 'admin' });
    assert.equal(s.status, 200);
    assert.ok(log.del.includes(key));
    assert.equal((await (await callWait('/api/today', { db })).json()).quote.id, target);
    /* 改成私密：清缓存，GET 不再给这句 */
    log.del.length = 0;
    const u = await callWait('/api/quotes?id=' + target, { db, method: 'PUT', body: { visibility: 'private' }, role: 'admin' });
    assert.equal(u.status, 200);
    assert.ok(log.del.includes(key));
    assert.ok(!store.has(key));
    assert.notEqual((await (await callWait('/api/today', { db })).json()).quote.id, target);
    /* 没成功的写（访客 403）不清 */
    log.del.length = 0;
    assert.equal((await callWait('/api/quotes?id=' + target, { db, method: 'DELETE', role: 'visitor' })).status, 403);
    assert.deepEqual(log.del, []);
  });
});
