// GET /api/today —— 今日一句（公开，不验会话）。
// 主站首页小组件跨站读（CORS 只放 https://styrigx.com），本站首页也用它。
// 只从公开句子里挑；按北京时间的日期挑（同一天大家看到同一句）。可带 ?d=YYYY-MM-DD 看某天的。
// 返回 {ok:true, day, quote|null}（quote 只带 id/text/trans/author/source/source_type/tags；随手一笔 note、可见性、百味归属一律不带）。
// Cache-Control: public, max-age=300。
import { json, methodNotAllowed } from './_lib.js';
import { ensureSchema, dayInShanghai, pickForDay, rowToQuote } from './_quotes.js';

const CORS_ORIGIN = 'https://styrigx.com';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function headers() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'public, max-age=300',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, OPTIONS');
  const q = new URL(request.url).searchParams.get('d') || '';
  const day = DAY_RE.test(q) ? q : dayInShanghai();
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(
    "SELECT id, text, trans, author, source, source_type, tags, visibility, created_at, updated_at FROM quotes WHERE visibility = 'public' ORDER BY id"
  ).all();
  const hit = pickForDay(results || [], day);
  let quote = null;
  if (hit) {
    const full = rowToQuote(hit);
    quote = { id: full.id, text: full.text, trans: full.trans, author: full.author, source: full.source, source_type: full.source_type, tags: full.tags };
  }
  return json({ ok: true, day, quote }, 200, headers());
}
