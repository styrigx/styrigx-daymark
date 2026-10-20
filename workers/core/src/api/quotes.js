// /api/quotes —— 句子的读和写。
//
// GET    /api/quotes             任何有效会话：owner 拿全部，visitor 只拿公开的。按添加时间倒序。
//                                返回 {ok:true, owner, quotes:[{id,text,trans,author,source,tags,visibility,created_at,updated_at}]}
// POST   /api/quotes             owner + 同源：新增。body {text, trans?, author?, source?, tags?, visibility?}
// PUT    /api/quotes?id=<id>     owner + 同源：修改，只改给了的字段
// DELETE /api/quotes?id=<id>     owner + 同源：删除
// 写操作成功返回 {ok:true, quote}（删除返回 {ok:true}）。
// 错误：400 bad-json / bad-body / bad-text / bad-visibility / nothing / bad-id；403 origin / role；404 not-found；409 limit；413 too-large
import { json, err, methodNotAllowed, isSameOrigin } from './_lib.js';
import { verifySession, requireOwner } from './_auth.js';
import { ensureSchema, parseQuote, rowToQuote, newId, ID_RE, LIMITS } from './_quotes.js';

const MAX_BODY = 8192;
const COLS = 'id, text, trans, author, source, tags, visibility, created_at, updated_at';

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { response: err('too-large', 413) };
  try {
    return { body: JSON.parse(raw) };
  } catch (e) {
    return { response: err('bad-json', 400) };
  }
}

async function guardWrite(context) {
  if (!isSameOrigin(context.request)) return err('origin', 403);
  const { response } = await requireOwner(context);
  return response;
}

function idParam(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  return ID_RE.test(id) ? id : '';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const role = await verifySession(request, env);
  if (!role) return err('unauthorized', 401);
  await ensureSchema(env.DB);
  const sql = role === 'owner'
    ? `SELECT ${COLS} FROM quotes ORDER BY created_at DESC, id`
    : `SELECT ${COLS} FROM quotes WHERE visibility = 'public' ORDER BY created_at DESC, id`;
  const { results } = await env.DB.prepare(sql).all();
  return json({ ok: true, owner: role === 'owner', quotes: (results || []).map(rowToQuote) });
}

export async function onRequestPost(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const r = await readBody(request);
  if (r.response) return r.response;
  const p = parseQuote(r.body, false);
  if ('error' in p) return err(p.error, 400);
  await ensureSchema(env.DB);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM quotes').first();
  if (n && n.n >= LIMITS.total) return err('limit', 409);
  const f = p.fields;
  const now = Date.now();
  const id = newId();
  await env.DB.prepare(
    'INSERT INTO quotes (id, text, trans, author, source, tags, visibility, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)'
  ).bind(id, f.text, f.trans, f.author, f.source, JSON.stringify(f.tags), f.visibility, now).run();
  const row = await env.DB.prepare(`SELECT ${COLS} FROM quotes WHERE id = ?1`).bind(id).first();
  return json({ ok: true, quote: rowToQuote(row) }, 201);
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
  await ensureSchema(env.DB);
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(p.fields)) {
    args.push(k === 'tags' ? JSON.stringify(v) : v);
    sets.push(k + ' = ?' + args.length);
  }
  args.push(Date.now());
  sets.push('updated_at = ?' + args.length);
  args.push(id);
  const res = await env.DB.prepare('UPDATE quotes SET ' + sets.join(', ') + ' WHERE id = ?' + args.length).bind(...args).run();
  if (!res.meta || !res.meta.changes) return err('not-found', 404);
  const row = await env.DB.prepare(`SELECT ${COLS} FROM quotes WHERE id = ?1`).bind(id).first();
  return json({ ok: true, quote: rowToQuote(row) });
}

export async function onRequestDelete(context) {
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { request, env } = context;
  const id = idParam(request);
  if (!id) return err('bad-id', 400);
  await ensureSchema(env.DB);
  const res = await env.DB.prepare('DELETE FROM quotes WHERE id = ?1').bind(id).run();
  if (!res.meta || !res.meta.changes) return err('not-found', 404);
  return json({ ok: true });
}

export async function onRequest(context) {
  return methodNotAllowed('GET, POST, PUT, DELETE');
}
