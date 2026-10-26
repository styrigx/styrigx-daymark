// /api/today —— 今日一句。
//
// GET（公开，不验会话）：主站首页小组件和锁屏跨站读（CORS 只放 https://styrigx.com），本站余响也用它。
//   按北京时间的日期：当天第一次请求挑好一句写进 D1（daily_pick，见 _today.js），当天之后都读这一句——
//   新增句子不会让当天的句子变。只出公开句子；记下的那句被删了或改成私密了，就重挑并重新锁住。
//   只给今天的：不带 ?d=，或 ?d= 正好是北京时间的今天 → 200；?d= 是别的日期或格式不对 → 400 bad-day
//   （以前能带任意日期，陌生人可以绕开锁屏遍历全部公开句子，非今天的日期每次还全表扫一遍 D1；生产上没人用）。
//   返回 {ok:true, day, quote|null}（quote 只带 id/text/trans/author/source/source_type/tags；随手一笔 note、可见性、百味归属一律不带）。
//   缓存：Cache-Control: public, max-age=N, s-maxage=N，N = min(60, 离北京时间零点的秒数)，不会跨过换天；
//   边缘用 caches.default 存一份（键带当天日期，换天自然失效），锁屏 / 首页的匿名流量大多不碰 D1。
//   管理员改了今日（或增删改了句子）后，本机房的边缘缓存当场清掉；别的机房和浏览器最多一分钟跟上（和以前的 max-age=60 一样）。
// PUT（只管理员 + 同源，同其他写接口）：余响「设为今日」。body {id}，改写北京时间今天的那一句，返回同 GET 的形状。
//   错误：400 bad-json / bad-id；401 未登录；403 origin / role；404 not-found；409 private（私密句子不能设为今日）。
import { json, err } from './_lib.js';
import { ensureSchema, dayInShanghai, ID_RE } from './_quotes.js';
import { resolveDay, setPick, publicQuote } from './_today.js';
import { guardWrite, readBody } from './_write.js';

const CORS_ORIGIN = 'https://styrigx.com';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_AGE = 60;
const DAY_MS = 86400000;
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

/** 缓存秒数：最多 60 秒，而且不跨过北京时间零点（换天后第一时间拿到新的一句） */
export function cacheSeconds(now = Date.now()) {
  const left = DAY_MS - ((now + SHANGHAI_OFFSET_MS) % DAY_MS);
  return Math.max(0, Math.min(MAX_AGE, Math.floor(left / 1000)));
}

function headers(now = Date.now()) {
  const n = cacheSeconds(now);
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': n > 0 ? `public, max-age=${n}, s-maxage=${n}` : 'public, max-age=0, must-revalidate',
  };
}

/** 边缘缓存（Workers 的 caches.default；本地 / 测试没有就不用） */
function edgeCache() {
  return typeof caches !== 'undefined' && caches && caches.default ? caches.default : null;
}

/** 缓存键：同一主机 + 当天日期（查询串全部不进键，加参数也打不穿缓存；换天换键） */
function cacheKey(request, day) {
  return new Request(new URL('/api/today?day=' + day, request.url).toString(), { method: 'GET' });
}

/**
 * 清掉本机房今天这份边缘缓存（设为今日、增删改句子之后调；出错只吞掉，不影响响应）。
 * 没有边缘缓存（本地 / 测试）→ 返回 null，调用方不用排 waitUntil。
 * @returns {Promise<void> | null}
 */
export function purgeTodayCache(request, now = Date.now()) {
  const cache = edgeCache();
  if (!cache) return null;
  return Promise.resolve()
    .then(() => cache.delete(cacheKey(request, dayInShanghai(now))))
    .then(() => {}, () => console.error('[daymark-today] purge failed'));
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers() });
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ ok: false, error: 'method' }, 405, { Allow: 'GET, PUT, OPTIONS' });
  const now = Date.now();
  const today = dayInShanghai(now);
  const q = new URL(request.url).searchParams.get('d');
  if (q !== null && (!DAY_RE.test(q) || q !== today)) return err('bad-day', 400);
  /* 零点前最后一秒不读也不存边缘缓存 */
  const cache = cacheSeconds(now) > 0 ? edgeCache() : null;
  const key = cache ? cacheKey(request, today) : null;
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      /* 命中时按现在重算 Cache-Control：存进去时的 max-age 到现在可能会跨过零点 */
      const out = new Response(hit.body, hit);
      out.headers.set('Cache-Control', headers(now)['Cache-Control']);
      return out;
    }
  }
  return fresh(context, today, now, cache, key);
}

/** 读 D1 出今天这句；给了边缘缓存就存一份 */
async function fresh(context, today, now, cache, key) {
  const { env } = context;
  await ensureSchema(env.D1_QUOTES);
  const row = await resolveDay(env.D1_QUOTES, today, { persist: true, now });
  const res = json({ ok: true, day: today, quote: publicQuote(row) }, 200, headers(now));
  if (cache && key) {
    const put = cache.put(key, res.clone()).catch(() => console.error('[daymark-today] cache put failed'));
    if (typeof context.waitUntil === 'function') context.waitUntil(put);
  }
  return res;
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
  await purgeTodayCache(request, now);
  return json({ ok: true, day, quote: publicQuote(row) });
}
