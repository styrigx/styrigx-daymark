// /api/quotes —— 句子的读和写。
//
// GET    /api/quotes             任何有效会话：admin 拿全部，visitor 只拿公开的。按添加时间倒序。
//                                返回 {ok:true, admin, quotes:[{id,text,trans,author,source,source_type,tags,visibility,created_at,updated_at}]}
//                                admin 的每句另带 note（随手一笔）和 collections（所在百味专题 id）；访客的响应里没有这两个键。
// POST   /api/quotes             admin + 同源：新增。body {text, trans?, author?, source?, source_type?, tags?, visibility?, note?, collections?}
// PUT    /api/quotes?id=<id>     admin + 同源：修改，只改给了的字段（collections 给了就按它重设归属：新加的排到专题末尾）
// DELETE /api/quotes?id=<id>     admin + 同源：删除（连同它在百味专题里的位置）
// 写操作成功返回 {ok:true, quote}（删除返回 {ok:true}）。
// 错误：400 bad-json / bad-body / bad-text / bad-visibility / bad-source-type / bad-collections / nothing / bad-id；
//       403 origin / role；404 not-found；409 limit；413 too-large
import { json, err, methodNotAllowed } from './_lib.js';
import { sessionRole } from './_auth.js';
import { readBody, guardWrite, idParam } from './_write.js';
import { ensureSchema, parseQuote, rowToQuote, newId, LIMITS, QUOTE_COLS } from './_quotes.js';

/** 一句所在的专题 id（按专题自己的顺序） */
async function collectionsOf(db, id) {
  const { results } = await db.prepare(
    'SELECT cq.collection_id AS c FROM collection_quotes cq JOIN collections c ON c.id = cq.collection_id WHERE cq.quote_id = ?1 ORDER BY c.sort, c.created_at, c.id'
  ).bind(id).all();
  return (results || []).map((r) => r.c);
}

/** 按给的专题 id 重设一句的归属：不存在的专题忽略；新加入的排到该专题末尾，原来就在的位置不变 */
async function setCollections(db, quoteId, ids) {
  const { results } = await db.prepare('SELECT id FROM collections').all();
  const exist = new Set((results || []).map((r) => r.id));
  const want = ids.filter((c) => exist.has(c));
  const have = await collectionsOf(db, quoteId);
  const stmts = [];
  for (const c of have) {
    if (!want.includes(c)) stmts.push(db.prepare('DELETE FROM collection_quotes WHERE collection_id = ?1 AND quote_id = ?2').bind(c, quoteId));
  }
  for (const c of want) {
    if (have.includes(c)) continue;
    stmts.push(db.prepare(
      'INSERT OR IGNORE INTO collection_quotes (collection_id, quote_id, position) VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM collection_quotes WHERE collection_id = ?1))'
    ).bind(c, quoteId));
  }
  if (stmts.length) await db.batch(stmts);
}

async function adminQuote(db, id) {
  const row = await db.prepare(`SELECT ${QUOTE_COLS} FROM quotes WHERE id = ?1`).bind(id).first();
  if (!row) return null;
  const q = rowToQuote(row, true);
  q.collections = await collectionsOf(db, id);
  return q;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await sessionRole(context);
  if (!role) return err('unauthorized', 401);
  await ensureSchema(env.D1_QUOTES);
  const admin = role === 'admin';
  const sql = admin
    ? `SELECT ${QUOTE_COLS} FROM quotes ORDER BY created_at DESC, id`
    : `SELECT ${QUOTE_COLS} FROM quotes WHERE visibility = 'public' ORDER BY created_at DESC, id`;
  const { results } = await env.D1_QUOTES.prepare(sql).all();
  const quotes = (results || []).map((r) => rowToQuote(r, admin));
  if (admin) {
    const m = await env.D1_QUOTES.prepare(
      'SELECT cq.quote_id AS q, cq.collection_id AS c FROM collection_quotes cq JOIN collections c ON c.id = cq.collection_id ORDER BY c.sort, c.created_at, c.id'
    ).all();
    /** @type {Record<string, string[]>} */
    const by = {};
    for (const r of m.results || []) (by[r.q] = by[r.q] || []).push(r.c);
    for (const q of quotes) q.collections = by[q.id] || [];
  }
  return json({ ok: true, admin, quotes });
}

export async function onRequestPost(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const r = await readBody(request);
  if (r.response) return r.response;
  const p = parseQuote(r.body, false);
  if ('error' in p) return err(p.error, 400);
  await ensureSchema(env.D1_QUOTES);
  const n = await env.D1_QUOTES.prepare('SELECT COUNT(*) AS n FROM quotes').first();
  if (n && n.n >= LIMITS.total) return err('limit', 409);
  const f = p.fields;
  const now = Date.now();
  const id = newId();
  await env.D1_QUOTES.prepare(
    'INSERT INTO quotes (id, text, trans, author, source, source_type, tags, visibility, note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)'
  ).bind(id, f.text, f.trans, f.author, f.source, f.source_type, JSON.stringify(f.tags), f.visibility, f.note, now).run();
  if (p.collections && p.collections.length) await setCollections(env.D1_QUOTES, id, p.collections);
  return json({ ok: true, quote: await adminQuote(env.D1_QUOTES, id) }, 201);
}

export async function onRequestPut(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const id = idParam(request);
  if (!id) return err('bad-id', 400);
  const r = await readBody(request);
  if (r.response) return r.response;
  const p = parseQuote(r.body, true);
  if ('error' in p) return err(p.error, 400);
  await ensureSchema(env.D1_QUOTES);
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(p.fields)) {
    args.push(k === 'tags' ? JSON.stringify(v) : v);
    sets.push(k + ' = ?' + args.length);
  }
  args.push(Date.now());
  sets.push('updated_at = ?' + args.length);
  args.push(id);
  const res = await env.D1_QUOTES.prepare('UPDATE quotes SET ' + sets.join(', ') + ' WHERE id = ?' + args.length).bind(...args).run();
  if (!res.meta || !res.meta.changes) return err('not-found', 404);
  if (p.collections) await setCollections(env.D1_QUOTES, id, p.collections);
  return json({ ok: true, quote: await adminQuote(env.D1_QUOTES, id) });
}

export async function onRequestDelete(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const id = idParam(request);
  if (!id) return err('bad-id', 400);
  await ensureSchema(env.D1_QUOTES);
  /* 句子和它的专题归属在同一个 batch（一个事务）里删，不会留下孤儿归属行 */
  const [res] = await env.D1_QUOTES.batch([
    env.D1_QUOTES.prepare('DELETE FROM quotes WHERE id = ?1').bind(id),
    env.D1_QUOTES.prepare('DELETE FROM collection_quotes WHERE quote_id = ?1').bind(id),
  ]);
  if (!res || !res.meta || !res.meta.changes) return err('not-found', 404);
  return json({ ok: true });
}

export async function onRequest(context) {
  return methodNotAllowed('GET, POST, PUT, DELETE');
}
