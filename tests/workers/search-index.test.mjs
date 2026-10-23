// styrigx-daymark-core · 全站搜索索引（workers/core/src/search-index.js）：
// - 每句出 zh + en 两条：标题截断、署名同页面、text 全文 ≤2000、链到作者分组或拾录
// - 私密句子 private:true；随手一笔只进私密句子的 text，公开句子的索引里搜不到
// - 写接口成功后 waitUntil 重建并 put site:daymark；读接口、失败的写不触发
// - Cron scheduled 重建；KV / D1 出错只打日志，接口照常返回
// - wrangler.toml：KV_SEARCH_INDEX 绑定 + 每小时 Cron
// SQL 用 node:sqlite 真跑（CI 用 Node 22）。
// 运行：node --test tests/workers/search-index.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const W = REPO + '/workers/core';
const worker = (await import(W + '/src/index.js')).default;
const S = await import(W + '/src/search-index.js');

/** node:sqlite 包成 D1 的样子（同 core.test.mjs） */
function makeD1(db = new DatabaseSync(':memory:')) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
    _exec: () => db.prepare(sql).run(...args),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s._exec()) };
}
function makeKV({ fail = false } = {}) {
  const puts = [];
  return {
    puts,
    async put(key, value) {
      if (fail) throw new Error('kv down');
      puts.push({ key, value: JSON.parse(value) });
    },
    last() { return puts[puts.length - 1]; },
  };
}
function makeCtx() {
  const pending = [];
  return { pending, waitUntil(p) { pending.push(p); }, flush: () => Promise.all(pending) };
}
const auth = (role) => ({ async session() { return role ? { ok: true, role } : { ok: false }; } });
const ORIGIN = 'https://daymark.styrigx.com';
async function call(p, { role = 'owner', db, kv = makeKV(), ctx = makeCtx(), method = 'GET', body } = {}) {
  const headers = { Cookie: 'x', Origin: ORIGIN };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(ORIGIN + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const env = { AUTH: auth(role), D1_QUOTES: db };
  if (kv) env.KV_SEARCH_INDEX = kv;
  const res = await worker.fetch(req, env, ctx);
  await ctx.flush();
  return res;
}
/** 静音 console.error，收集日志行 */
async function quiet(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.join(' '));
  try { await fn(); } finally { console.error = orig; }
  return logs;
}

test('一句 → zh + en 两条：标题、署名、全文、链接', () => {
  const items = S.quoteItems({
    id: 'aaaaaaaaaaaa', text: '人是一根绳索，系在野兽与超人之间。', trans: 'Man is a rope.', author: '尼采',
    source: '查拉图斯特拉如是说', source_type: 'book', tags: ['超越'], visibility: 'public', note: '',
  });
  assert.deepEqual(items, [
    {
      id: 'quote:aaaaaaaaaaaa', type: 'quote', lang: 'zh', title: '人是一根绳索，系在野兽与超人之间。',
      subtitle: '尼采 · 《查拉图斯特拉如是说》', text: '人是一根绳索，系在野兽与超人之间。\nMan is a rope.\n#超越',
      url: 'https://daymark.styrigx.com/#flavors/a/%E5%B0%BC%E9%87%87',
    },
    {
      id: 'quote:aaaaaaaaaaaa:en', type: 'quote', lang: 'en', title: 'Man is a rope.',
      subtitle: '尼采 · 查拉图斯特拉如是说', text: 'Man is a rope.\n人是一根绳索，系在野兽与超人之间。\n#超越',
      url: 'https://daymark.styrigx.com/en/#flavors/a/%E5%B0%BC%E9%87%87',
    },
  ]);
});

test('没作者 → 链到拾录；没译文 → 英文条目用原文；长句标题截到 80 字，text ≤2000', () => {
  const long = '字'.repeat(500);
  const [zh, en] = S.quoteItems({ id: 'bbbbbbbbbbbb', text: long, trans: '', author: '', source: '', source_type: '', tags: [], visibility: 'public' });
  assert.equal(zh.url, 'https://daymark.styrigx.com/#trove');
  assert.equal(en.url, 'https://daymark.styrigx.com/en/#trove');
  assert.equal([...zh.title].length, 80);
  assert.ok(zh.title.endsWith('…'));
  assert.equal(en.title, zh.title);
  assert.ok(!('subtitle' in zh));
  assert.ok(zh.text.length <= 2000);
  assert.ok(!('private' in zh));
  const big = S.quoteItems({ id: 'cccccccccccc', text: 'a'.repeat(1500), trans: 'b'.repeat(1500), tags: [], visibility: 'public' });
  assert.equal(big[0].text.length, 2000);
});

test('私密：private:true；随手一笔只进私密句子的 text', () => {
  const pub = S.quoteItems({ id: 'dddddddddddd', text: '公开', trans: '', tags: [], visibility: 'public', note: '悄悄话甲' });
  const pri = S.quoteItems({ id: 'eeeeeeeeeeee', text: '私密', trans: '', tags: [], visibility: 'private', note: '悄悄话乙' });
  assert.ok(pub.every((i) => !('private' in i) && !JSON.stringify(i).includes('悄悄话')));
  assert.ok(pri.every((i) => i.private === true && i.text.includes('悄悄话乙')));
});

test('buildIndex：从 D1 读全部句子，格式 { site, generated, items }', async () => {
  const db = makeD1();
  const ctx = makeCtx();
  await call('/api/quotes', { db, method: 'POST', body: { text: '公开的一句', author: '甲' }, ctx });
  await call('/api/quotes', { db, method: 'POST', body: { text: '私密的一句', visibility: 'private', note: '笔记' }, ctx });
  const ix = await S.buildIndex(db, Date.parse('2026-10-22T10:00:00Z'));
  assert.equal(ix.site, 'daymark');
  assert.equal(ix.generated, '2026-10-22T10:00:00.000Z');
  assert.equal(ix.items.length, 4);
  const byTitle = (t) => ix.items.filter((i) => i.title === t);
  assert.ok(byTitle('公开的一句').every((i) => !i.private));
  assert.ok(byTitle('私密的一句').every((i) => i.private === true));
  assert.deepEqual(ix.items.map((i) => i.lang), ['zh', 'en', 'zh', 'en']);
  /* 空库也能建 */
  assert.deepEqual((await S.buildIndex(makeD1())).items, []);
});

test('写接口成功后重建并 put site:daymark；读接口、失败的写不触发', async () => {
  const db = makeD1();
  const kv = makeKV();
  const r = await call('/api/quotes', { db, kv, method: 'POST', body: { text: '第一句', author: '鲁迅' } });
  assert.equal(r.status, 201);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.last().key, 'site:daymark');
  assert.equal(kv.last().value.site, 'daymark');
  assert.deepEqual(kv.last().value.items.map((i) => i.title), ['第一句', '第一句']);
  const id = (await r.json()).quote.id;
  /* 改 → 重建（私密） */
  await call('/api/quotes?id=' + id, { db, kv, method: 'PUT', body: { visibility: 'private' } });
  assert.equal(kv.puts.length, 2);
  assert.ok(kv.last().value.items.every((i) => i.private === true));
  /* 读、失败的写、访客的写不触发 */
  await call('/api/quotes', { db, kv });
  await call('/api/quotes', { db, kv, method: 'POST', body: { text: ' ' } });
  await call('/api/quotes', { db, kv, role: 'visitor', method: 'POST', body: { text: 'x' } });
  await call('/api/today', { db, kv });
  assert.equal(kv.puts.length, 2);
  /* 专题改动也重建 */
  await call('/api/collections', { db, kv, method: 'POST', body: { name: '晨读' } });
  assert.equal(kv.puts.length, 3);
  /* 删 → 重建后没了 */
  await call('/api/quotes?id=' + id, { db, kv, method: 'DELETE' });
  assert.equal(kv.puts.length, 4);
  assert.deepEqual(kv.last().value.items, []);
});

test('重建在 waitUntil 里：响应不等它', async () => {
  const db = makeD1();
  const ctx = makeCtx();
  const kv = makeKV();
  const env = { AUTH: auth('owner'), D1_QUOTES: db, KV_SEARCH_INDEX: kv };
  const req = new Request(ORIGIN + '/api/quotes', { method: 'POST', headers: { Cookie: 'x', Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
  const res = await worker.fetch(req, env, ctx);
  assert.equal(res.status, 201);
  assert.equal(ctx.pending.length, 1);
  await ctx.flush();
  assert.equal(kv.puts.length, 1);
});

test('Cron scheduled：重建并写入', async () => {
  const db = makeD1();
  await call('/api/quotes', { db, method: 'POST', body: { text: '兜底' } });
  const kv = makeKV();
  const ctx = makeCtx();
  await worker.scheduled({ cron: '17 * * * *', scheduledTime: Date.now() }, { D1_QUOTES: db, KV_SEARCH_INDEX: kv }, ctx);
  await ctx.flush();
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.last().key, 'site:daymark');
  assert.deepEqual(kv.last().value.items.map((i) => i.lang), ['zh', 'en']);
});

test('出错不影响接口：KV 抛错、没绑 KV、D1 读失败都只打日志', async () => {
  const db = makeD1();
  let r;
  let logs = await quiet(async () => { r = await call('/api/quotes', { db, kv: makeKV({ fail: true }), method: 'POST', body: { text: 'a' } }); });
  assert.equal(r.status, 201);
  assert.ok(logs.some((l) => l.includes('[daymark-search] rebuild failed')));
  logs = await quiet(async () => { r = await call('/api/quotes', { db, kv: null, method: 'POST', body: { text: 'b' } }); });
  assert.equal(r.status, 201);
  assert.ok(logs.some((l) => l.includes('KV_SEARCH_INDEX binding missing')));
  const badDb = { prepare() { throw new Error('d1 down'); }, batch: async () => { throw new Error('d1 down'); } };
  let out;
  await quiet(async () => { out = await S.rebuildSearchIndex({ D1_QUOTES: badDb, KV_SEARCH_INDEX: makeKV() }); });
  assert.deepEqual(out, { ok: false, error: 'rebuild-failed' });
  /* scheduled 同样不抛 */
  logs = await quiet(async () => { await worker.scheduled({}, { D1_QUOTES: badDb, KV_SEARCH_INDEX: makeKV() }, makeCtx()); });
  assert.ok(logs.some((l) => l.includes('[daymark-search] rebuild failed')));
});

test('wrangler.toml：KV_SEARCH_INDEX 绑 styrigx-search-index，每小时 Cron', () => {
  const t = readFileSync(W + '/wrangler.toml', 'utf8');
  assert.match(t, /\[\[kv_namespaces\]\]\nbinding = "KV_SEARCH_INDEX"\nid = "bd1babcc3fe74d58994e254c74d34ced"/);
  assert.match(t, /\[triggers\]\ncrons = \["17 \* \* \* \*"\]/);
});
