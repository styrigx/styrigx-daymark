/**
 * @fileoverview styrigx-daymark-core：每日一句接口 Worker（路由 daymark.styrigx.com/api/*，见 wrangler.toml）。
 *
 * 数据接口都在这里，D1（DB）只绑在本 Worker 上；Pages 只放静态文件。
 * 本 Worker 不持任何钥匙：会话交给主站鉴权网关验（服务绑定 AUTH，见 src/api/_auth.js）。
 *
 * 请求顺序：
 *   1. /api/today：今日一句，主站首页跨站调用的公开只读接口（带 CORS），不验会话
 *   2. 其余 /api/*：先问网关会话（owner、visitor 都可）；无效 → 401 JSON（不 302，fetch 不跟跳转）
 *   3. 按路由表交给 src/api/<路径>.js；写操作自己再要求 owner + 同源
 * /api/session-check 由网关的更精确路由直接回答，到不了这里；万一到了，同样问网关。
 * 不在路由表里的路径 → 404；方法不支持 → 405。
 */
import { API_ROUTES } from './routes.js';
import { verifySession } from './api/_auth.js';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const NO_STORE = 'private, no-store';

/** /api/quotes/ 与 /api/quotes 等价（Pages 也这样匹配） */
export function routeKey(pathname) {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** 按 Pages 规则挑处理函数：onRequest<Method> 优先，其次 onRequest */
export function pickHandler(mod, method) {
  if (!mod) return null;
  const m = String(method || 'GET').toUpperCase();
  if (!METHODS.includes(m)) return null;
  const name = 'onRequest' + m.charAt(0) + m.slice(1).toLowerCase();
  if (typeof mod[name] === 'function') return mod[name];
  if (typeof mod.onRequest === 'function') return mod.onRequest;
  return null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  });
}

/** 公开接口（不验会话） */
export function isPublic(pathname) {
  return routeKey(pathname) === '/api/today';
}

/** 找处理模块：{ mod, params, functionPath } 或 null */
export function resolve(pathname) {
  const key = routeKey(pathname);
  const mod = API_ROUTES.get(key);
  return mod ? { mod, params: {}, functionPath: key } : null;
}

function makeContext(request, env, ctx, params, functionPath) {
  return {
    request,
    env,
    params,
    data: {},
    functionPath,
    waitUntil: (p) => { if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p); },
    passThroughOnException: () => {},
    next: async () => json(404, { ok: false, error: 'not-found' }),
  };
}

/** 响应打上 X-Daymark-Runtime: worker，部署后能从外部确认接口真的走了本 Worker（不含敏感信息） */
function tag(res) {
  const out = new Response(res.body, res);
  out.headers.set('X-Daymark-Runtime', 'worker');
  return out;
}

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return json(404, { ok: false, error: 'not-found' });

  if (routeKey(path) === '/api/session-check') {
    const role = await verifySession(request, env);
    return role ? json(200, { ok: true }) : json(401, { ok: false });
  }

  if (!isPublic(path)) {
    const role = await verifySession(request, env);
    if (!role) return json(401, { ok: false, error: 'unauthorized' });
  }

  const hit = resolve(path);
  if (!hit) return json(404, { ok: false, error: 'not-found' });
  const handler = pickHandler(hit.mod, request.method);
  if (!handler) return json(405, { ok: false, error: 'method' });
  return handler(makeContext(request, env, ctx, hit.params, hit.functionPath));
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, any>} env
   * @param {{ waitUntil(p: Promise<any>): void }} ctx
   */
  async fetch(request, env, ctx) {
    try {
      return tag(await handle(request, env, ctx));
    } catch (e) {
      console.error('[daymark-core] unhandled: ' + (e && e.name ? e.name : 'error'));
      return tag(json(500, { ok: false, error: 'internal' }));
    }
  },
};
