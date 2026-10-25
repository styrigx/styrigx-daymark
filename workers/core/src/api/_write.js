// workers/core/src/api/_write.js
// 写接口共用：读 JSON body（限大小）、写操作门槛（同源 + admin）、?id= 参数。下划线开头：不是接口。
import { err, isSameOrigin } from './_lib.js';
import { requireAdmin } from './_auth.js';
import { ID_RE } from './_quotes.js';

const MAX_BODY = 65536; // 专题排序一次带全部句子 id（最多 2000 × 15 字节）

/** @returns {Promise<{response: Response} | {body: any, response?: undefined}>} */
export async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { response: err('too-large', 413) };
  try {
    return { body: JSON.parse(raw) };
  } catch (e) {
    return { response: err('bad-json', 400) };
  }
}

/** 写操作：先看同源（非同源 403 origin），再要 admin（未登录 401、访客 403 role）；通过返回 null */
export async function guardWrite(context) {
  if (!isSameOrigin(context.request)) return err('origin', 403);
  const { response } = await requireAdmin(context);
  return response;
}

/** ?id=<12 位十六进制>；不合法返回 '' */
export function idParam(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  return ID_RE.test(id) ? id : '';
}
