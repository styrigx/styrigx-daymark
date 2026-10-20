// workers/core/src/api/_auth.js
// 接口鉴权：本 Worker 不持任何钥匙，把浏览器带来的 Cookie 头交给主站鉴权网关验
// （服务绑定 env.AUTH → styrigx-auth-gateway 的 RPC 入口 SessionVerifier）。
// 网关用自己的公钥验签、用 KV 的 epoch 核对，只回结论 {ok, role}。
// fail closed：回答格式不对一律当未通过。绑定缺失或网关出错直接抛错（调用方回 500），
// 不回 401——401 会让前端当成「已锁定」去刷新页面，网关临时故障不该把人踢去锁屏。
import { err } from './_lib.js';

function gateway(env) {
  const a = env && env.AUTH;
  return a && typeof a.session === 'function' ? a : null;
}

/**
 * 会话角色：'owner' | 'visitor'；会话无效返回 null；绑定缺失或网关出错抛错。
 * @param {Request} request
 * @param {Record<string, any>} env
 */
export async function verifySession(request, env) {
  const auth = gateway(env);
  if (!auth) {
    console.error('[daymark-auth] AUTH binding missing');
    throw new Error('auth-binding-missing');
  }
  const r = await auth.session(request.headers.get('Cookie') || '');
  if (r && r.ok === true && (r.role === 'owner' || r.role === 'visitor')) return r.role;
  return null;
}

/** 要求 owner：未登录 401；visitor 403 */
export async function requireOwner(context) {
  const role = await verifySession(context.request, context.env);
  if (role === 'owner') return { response: null };
  if (role === 'visitor') return { response: err('role', 403) };
  return { response: err('unauthorized', 401) };
}
