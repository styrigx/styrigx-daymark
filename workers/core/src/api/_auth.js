// workers/core/src/api/_auth.js
// 接口鉴权：本 Worker 不持任何钥匙，把浏览器带来的 Cookie 头交给主站鉴权网关验
// （服务绑定 env.AUTH → styrigx-auth-gateway 的 RPC 入口 AuthVerifier，方法 lockSession(cookieHeader)）。
// 网关用自己的公钥验签锁屏会话（sgx-lock-session）、用 KV 的 epoch 核对，只回结论 {ok, role} / {ok:false, reason}。
// fail closed：回答格式不对一律当未通过。绑定缺失或网关出错直接抛错（调用方回 500），
// 不回 401——401 会让前端当成「已锁定」去刷新页面，网关临时故障不该把人踢去锁屏。
import { err } from './_lib.js';

function gateway(env) {
  const a = env && env.AUTH;
  return a && typeof a.lockSession === 'function' ? a : null;
}

/**
 * 会话角色：'admin' | 'visitor'；会话无效返回 null；绑定缺失或网关出错抛错。
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export async function verifySession(request, env) {
  const auth = gateway(env);
  if (!auth) {
    console.error('[daymark-auth] AUTH binding missing');
    throw new Error('auth-binding-missing');
  }
  const r = await auth.lockSession(request.headers.get('Cookie') || '');
  if (r && r.ok === true && (r.role === 'admin' || r.role === 'visitor')) return r.role;
  return null;
}

/**
 * 本次请求的会话角色：index.js 已经问过网关（结果放在 context.data.role）就直接用，不再问第二次；
 * 没有（单测直接调 handler 等）才自己问。返回值同 verifySession。
 * @param {{request: Request, env: Record<string, any>, data?: Record<string, any>}} context
 */
export async function sessionRole(context) {
  const r = context && context.data ? context.data.role : null;
  if (r === 'admin' || r === 'visitor') return r;
  return verifySession(context.request, context.env);
}

/** 要求 admin：未登录 401；visitor 403 */
export async function requireAdmin(context) {
  const role = await sessionRole(context);
  if (role === 'admin') return { response: null };
  if (role === 'visitor') return { response: err('role', 403) };
  return { response: err('unauthorized', 401) };
}
