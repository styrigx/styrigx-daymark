// /api/collections —— 百味里的自建专题（主人建的句子合集）。
//
// GET    /api/collections            任何有效会话。按 sort、created_at 排好。
//                                    返回 {ok:true, owner, collections:[{id,name,intro,created_at,sort,quote_ids:[…按专题内顺序]}]}
//                                    访客：quote_ids 只含公开句子；一句公开句子都没有的专题不返回。
// POST   /api/collections            owner + 同源：新建。body {name, intro?}；排到最后
// PUT    /api/collections?id=<id>    owner + 同源：改 name / intro / sort；给 quote_ids 就按它重设专题里的句子和顺序
//                                    （排序、移出都走这里；不存在的句子 id 忽略）
// DELETE /api/collections?id=<id>    owner + 同源：删专题（句子本身不删）
// 写操作成功返回 {ok:true, collection}（删除返回 {ok:true}）。
// 错误：400 bad-json / bad-body / bad-name / bad-sort / bad-quote-ids / nothing / bad-id；403 origin / role；404 not-found；409 limit；413 too-large
import { json, err, methodNotAllowed } from './_lib.js';
import { verifySession } from './_auth.js';
import { readBody, guardWrite, idParam } from './_write.js';
import { ensureSchema, parseCollection, newId, LIMITS } from './_quotes.js';

const COLS = 'id, name, intro, created_at, sort';

function rowToCollection(r, quoteIds) {
  return { id: r.id, name: r.name, intro: r.intro || '', created_at: r.created_at || 0, sort: r.sort || 0, quote_ids: quoteIds };
}

/** 专题里的句子 id（按位置）；visitorOnly=true 时只要公开句子 */
async function members(db, visitorOnly) {
  const sql = visitorOnly
    ? "SELECT cq.collection_id AS c, cq.quote_id AS q FROM collection_quotes cq JOIN quotes q ON q.id = cq.quote_id WHERE q.visibility = 'public' ORDER BY cq.collection_id, cq.position, cq.quote_id"
    : 'SELECT cq.collection_id AS c, cq.quote_id AS q FROM collection_quotes cq JOIN quotes q ON q.id = cq.quote_id ORDER BY cq.collection_id, cq.position, cq.quote_id';
  const { results } = await db.prepare(sql).all();
  /** @type {Record<string, string[]>} */
  const by = {};
  for (const r of results || []) (by[r.c] = by[r.c] || []).push(r.q);
  return by;
}

async function one(db, id) {
  const row = await db.prepare(`SELECT ${COLS} FROM collections WHERE id = ?1`).bind(id).first();
  if (!row) return null;
  const by = await members(db, false);
  return rowToCollection(row, by[id] || []);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await verifySession(request, env);
  if (!role) return err('unauthorized', 401);
  await ensureSchema(env.D1_QUOTES);
  const owner = role === 'owner';
  const { results } = await env.D1_QUOTES.prepare(`SELECT ${COLS} FROM collections ORDER BY sort, created_at, id`).all();
  const by = await members(env.D1_QUOTES, !owner);
  let list = (results || []).map((r) => rowToCollection(r, by[r.id] || []));
  if (!owner) list = list.filter((c) => c.quote_ids.length > 0);
  return json({ ok: true, owner, collections: list });
}

export async function onRequestPost(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const r = await readBody(request);
  if (r.response) return r.response;
  const p = parseCollection(r.body, false);
  if ('error' in p) return err(p.error, 400);
  await ensureSchema(env.D1_QUOTES);
  const n = await env.D1_QUOTES.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS s FROM collections').first();
  if (n && n.n >= LIMITS.collections) return err('limit', 409);
  const id = newId();
  await env.D1_QUOTES.prepare('INSERT INTO collections (id, name, intro, created_at, sort) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, p.fields.name, p.fields.intro, Date.now(), (n ? Number(n.s) : -1) + 1).run();
  return json({ ok: true, collection: await one(env.D1_QUOTES, id) }, 201);
}

export async function onRequestPut(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const id = idParam(request);
  if (!id) return err('bad-id', 400);
  const r = await readBody(request);
  if (r.response) return r.response;
  const p = parseCollection(r.body, true);
  if ('error' in p) return err(p.error, 400);
  await ensureSchema(env.D1_QUOTES);
  const exists = await env.D1_QUOTES.prepare('SELECT id FROM collections WHERE id = ?1').bind(id).first();
  if (!exists) return err('not-found', 404);
  const entries = Object.entries(p.fields);
  if (entries.length) {
    const args = entries.map(([, v]) => v);
    const sets = entries.map(([k], i) => k + ' = ?' + (i + 1));
    args.push(id);
    await env.D1_QUOTES.prepare('UPDATE collections SET ' + sets.join(', ') + ' WHERE id = ?' + args.length).bind(...args).run();
  }
  if (p.quote_ids) {
    const { results } = await env.D1_QUOTES.prepare('SELECT id FROM quotes').all();
    const exist = new Set((results || []).map((x) => x.id));
    const ids = p.quote_ids.filter((q) => exist.has(q));
    const stmts = [env.D1_QUOTES.prepare('DELETE FROM collection_quotes WHERE collection_id = ?1').bind(id)];
    ids.forEach((q, i) => stmts.push(env.D1_QUOTES.prepare('INSERT INTO collection_quotes (collection_id, quote_id, position) VALUES (?1, ?2, ?3)').bind(id, q, i)));
    await env.D1_QUOTES.batch(stmts);
  }
  return json({ ok: true, collection: await one(env.D1_QUOTES, id) });
}

export async function onRequestDelete(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const id = idParam(request);
  if (!id) return err('bad-id', 400);
  await ensureSchema(env.D1_QUOTES);
  const res = await env.D1_QUOTES.prepare('DELETE FROM collections WHERE id = ?1').bind(id).run();
  if (!res.meta || !res.meta.changes) return err('not-found', 404);
  await env.D1_QUOTES.prepare('DELETE FROM collection_quotes WHERE collection_id = ?1').bind(id).run();
  return json({ ok: true });
}

export async function onRequest(context) {
  return methodNotAllowed('GET, POST, PUT, DELETE');
}
