// workers/core/src/api/_lib.js
// 共享工具：JSON 响应、同源检查。下划线开头：不是接口，只供其它接口 import（路由表见 src/routes.js）。

export const NO_STORE = 'private, no-store';

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE, ...extraHeaders },
  });
}

export function err(error, status = 400) {
  return json({ ok: false, error }, status);
}

export function methodNotAllowed(allowed) {
  return json({ ok: false, error: 'method' }, 405, { Allow: allowed });
}

/** 写操作必须同源：Origin 头的 host 等于请求 host（daymark.styrigx.com） */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch (e) {
    return false;
  }
}
