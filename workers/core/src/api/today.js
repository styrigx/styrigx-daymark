// /api/today —— 今日一句。
//
// GET（公开，不验会话）：主站首页小组件和锁屏跨站读（CORS 只放 https://styrigx.com），本站余响也用它。
//   按北京时间的日期：当天第一次请求挑好一句写进 D1（daily_pick，见 _today.js），当天之后都读这一句——
//   新增句子不会让当天的句子变。只出公开句子；记下的那句被删了或改成私密了，就重挑并重新锁住。
//   可带 ?d=YYYY-MM-DD 看某天的（有记录读记录，没有就按日期算，不写库）。
//   返回 {ok:true, day, quote|null}（quote 只带 id/text/trans/author/source/source_type/tags；随手一笔 note、可见性、百味归属一律不带）。
//   Cache-Control: public, max-age=60（主人改了今日之后，主站最多一分钟跟上）。
// PUT（只主人 + 同源，同其他写接口）：余响「设为今日」。body {id}，改写北京时间今天的那一句，返回同 GET 的形状。
//   错误：400 bad-json / bad-id；401 未登录；403 origin / role；404 not-found；409 private（私密句子不能设为今日）。
import { json, err } from './_lib.js';
import { ensureSchema, dayInShanghai, ID_RE } from './_quotes.js';
import { resolveDay, setPick, publicQuote } from './_today.js';
import { guardWrite, readBody } from './_write.js';

const CORS_ORIGIN = 'https://styrigx.com';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function headers() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=60',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'method' }, 405, { Allow: 'GET, PUT, OPTIONS' });
  const now = Date.now();
  const today = dayInShanghai(now);
  const q = new URL(request.url).searchParams.get('d') || '';
  const day = DAY_RE.test(q) ? q : today;
  await ensureSchema(env.D1_QUOTES);
  const row = await resolveDay(env.D1_QUOTES, day, { persist: day === today, now });
  return json({ ok: true, day, quote: publicQuote(row) }, 200, headers());
}

export async function onRequestPut(context) {
  const { request, env } = context;
  const denied = await guardWrite(context);
  if (denied) return denied;
  const { body, response } = await readBody(request);
  if (response) return response;
  const id = body && typeof body.id === 'string' ? body.id : '';
  if (!ID_RE.test(id)) return err('bad-id', 400);
  const db = env.D1_QUOTES;
  await ensureSchema(db);
  const row = await db.prepare('SELECT id, text, trans, author, source, source_type, tags, visibility, created_at, updated_at FROM quotes WHERE id = ?1').bind(id).first();
  if (!row) return err('not-found', 404);
  if (row.visibility === 'private') return err('private', 409);
  const now = Date.now();
  const day = dayInShanghai(now);
  await setPick(db, day, id, now);
  return json({ ok: true, day, quote: publicQuote(row) });
}
