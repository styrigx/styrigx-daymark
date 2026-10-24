/* @sgx-shell:begin styrigx/styrigx-space@main web/shared/shell v1fba3fc24d1f（scripts/sync-shell.mjs 写入，勿手改） */
/* ---- share.js ---- */
/**
 * @fileoverview 子站顶栏的分享按钮（共享外壳组件，2026-10-24；gen-shell 原样复制成 web/shared/shell/share.js，三个子站 sync-shell 同步）。
 * 主站不用它（用户：主站不设计入口）。
 *
 * 顶栏右边是一个胶囊 .sgx-tb-end-group，里面两个按钮：[分享 .sgx-tb-gbtn[data-sgx-share]] [本站自己的按钮（子站 = 留言板）]。
 * 点分享：
 * - 站长（<html data-sgx-role="owner">，网关注入）：POST https://styrigx.com/api/share（credentials: include，跨源只许这一种请求）
 *   { action:'create', reuse:true, name: 页面标题（截 24 字）, to: 当前页（origin + pathname + search，去掉 lock / why / return / share），
 *     hours: 24, session: 43200 } → 带临时会话的短链（链接 24 小时、点开能看 12 小时）。
 *   服务端复用：同一页、同样档位、还剩 ≥ 12 小时的有效短链直接返回，不签新钥匙。
 *   拿到 https://styrigx.com/s/<码> → navigator.share({ title, url })；没有 Web Share 或被拒（不是用户取消 AbortError）→ 复制 + toast「已复制分享链接」。
 *   生成中：按钮 aria-busy + .is-busy（图标呼吸），再点不理。生成失败：toast 说原因；绝不把不带会话的原地址当成短链分享出去。
 * - 访客 / 没角色：直接分享当前页地址（不调接口），同样的复制兜底。
 *
 * 自成一体：不 import 任何东西；toast 自己建（.sgx-share-toast，样式在 shell.css topbar-frame 段，只用 --sgx-* 角色）。
 * 用法：import { mountShare } from '…/share.js'; mountShare();  // 每页一次；找不到 [data-sgx-share] 就什么也不做
 */

/** 生成短链的接口（分享短链 Worker styrigx-share；CORS 只认三个子站） */
export const SHARE_API = 'https://styrigx.com/api/share';
export const SHARE_ORIGIN = 'https://styrigx.com';
/** 站长一键分享的档位：链接 24 小时、点开后能看 12 小时（和账号页「新建分享短链」的默认一样） */
export const QUICK = Object.freeze({ hours: 24, session: 12 * 3600 });
/** 分享地址里去掉的查询参数（同服务端 STRIP_PARAMS） */
export const STRIP_PARAMS = Object.freeze(['lock', 'why', 'return', 'share']);
export const NAME_MAX = 24;

const STR = {
  zh: {
    share: '分享',
    copied: '已复制分享链接',
    copyFail: '复制失败，请稍后再试',
    busy: '正在生成分享链接…',
    login: '主站账号会话已失效，请回主站重新登录后再分享',
    full: '分享短链已满 20 条，先去主站作废几条',
    fail: '生成分享链接失败，请稍后再试',
  },
  en: {
    share: 'Share',
    copied: 'Share link copied',
    copyFail: 'Couldn’t copy. Please try again',
    busy: 'Creating share link…',
    login: 'Your account session on styrigx.com has expired. Sign in there again to share',
    full: 'You already have 20 share links. Revoke some on styrigx.com first',
    fail: 'Couldn’t create a share link. Please try again',
  },
};

/** 当前页 → 要分享的地址：origin + pathname + search（不带 #），去掉锁屏 / 回跳 / 分享参数 @param {{origin:string, pathname:string, search:string}} loc */
export function pageUrl(loc) {
  const sp = new URLSearchParams(loc.search || '');
  for (const k of STRIP_PARAMS) sp.delete(k);
  const q = sp.toString();
  return loc.origin + loc.pathname + (q ? '?' + q : '');
}

/** 页面标题 → 短链名字（去控制字符、首尾空格，最多 24 字） @param {string} t */
export function linkName(t) {
  const v = String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(v).slice(0, NAME_MAX).join('');
}

/** <html data-sgx-role> → 'owner' | 'visitor'（没有 / 别的 = visitor；admin 也算站长） @param {Document} doc */
export function roleOf(doc) {
  const r = (doc.documentElement.getAttribute('data-sgx-role') || '').toLowerCase();
  return r === 'owner' || r === 'admin' ? 'owner' : 'visitor';
}

/** 接口错误 → 文案键 @param {number} status @param {any} j */
export function errKey(status, j) {
  const e = j && j.error;
  if (status === 401 || e === 'session' || e === 'account') return 'login';
  if (status === 409 || e === 'full') return 'full';
  return 'fail';
}

/**
 * 请服务端生成（或复用）站长短链。
 * @param {{ url: string, title: string, fetch?: typeof fetch, api?: string }} p
 * @returns {Promise<{ok:true, url:string, reused:boolean}|{ok:false, key:string}>}
 */
export async function createLink(p) {
  const f = p.fetch || fetch;
  let res;
  try {
    res = await f(p.api || SHARE_API, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', reuse: true, name: linkName(p.title), to: p.url, hours: QUICK.hours, session: QUICK.session }),
    });
  } catch (e) {
    return { ok: false, key: 'fail' };
  }
  let j = null;
  try { j = await res.json(); } catch (e) {}
  const path = j && j.ok === true && j.link && typeof j.link.path === 'string' ? j.link.path : '';
  if (!res.ok || !/^\/s\/[A-Za-z0-9_-]{22}$/.test(path)) return { ok: false, key: errKey(res.status, j) };
  return { ok: true, url: SHARE_ORIGIN + path, reused: !!j.reused };
}

/** @param {string} text @param {Navigator} nav @param {Document} doc */
async function copyText(text, nav, doc) {
  try {
    if (nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) {
    return false;
  }
}

/**
 * 系统分享；没有 / 被拒（不是用户取消）就复制。
 * @param {{title:string, url:string}} data
 * @param {{ nav?: Navigator, doc?: Document, toast: (m:string)=>void, t: Record<string,string> }} o
 * @returns {Promise<'shared'|'aborted'|'copied'|'failed'>}
 */
export async function shareOrCopy(data, o) {
  const nav = o.nav || navigator;
  const doc = o.doc || document;
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: data.title, url: data.url });
      return 'shared';
    } catch (e) {
      if (e && /** @type {any} */ (e).name === 'AbortError') return 'aborted';
    }
  }
  if (await copyText(data.url, nav, doc)) {
    o.toast(o.t.copied);
    return 'copied';
  }
  o.toast(o.t.copyFail);
  return 'failed';
}

/** @param {Document} doc */
function makeToast(doc) {
  /** @type {HTMLElement|null} */
  let el = null;
  /** @type {any} */
  let timer = null;
  return function (/** @type {string} */ msg) {
    if (!msg) return;
    if (!el) {
      el = doc.createElement('div');
      el.className = 'sgx-share-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      doc.body.appendChild(el);
    }
    el.textContent = msg;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(function () { if (el) el.classList.remove('show'); }, 2400);
  };
}

/**
 * @typedef {Object} ShareConfig
 * @property {Element|null} [button] 分享按钮（默认 [data-sgx-share]）
 * @property {'zh'|'en'} [lang] 默认按 <html lang>
 * @property {(m:string)=>void} [toast] 自己的 toast（默认外壳的 .sgx-share-toast）
 * @property {() => string} [url] 要分享的地址（默认 pageUrl(location)）
 * @property {() => string} [title] 标题（默认 document.title）
 * @property {typeof fetch} [fetch]
 * @property {string} [api]
 * @property {Document} [doc]
 * @property {Navigator} [nav]
 */

/**
 * 绑定分享按钮。返回 { share() }（测试 / 键盘快捷键用；和点按钮一样）；没有按钮返回 null。
 * @param {ShareConfig} [cfg]
 */
export function mountShare(cfg) {
  const c = cfg || {};
  const doc = c.doc || document;
  const btn = c.button || doc.querySelector('[data-sgx-share]');
  if (!btn || /** @type {any} */ (btn).__sgxShare) return null;
  const lang = c.lang || (/^en/i.test(doc.documentElement.lang || '') ? 'en' : 'zh');
  const t = STR[lang] || STR.zh;
  const toast = c.toast || makeToast(doc);
  let busy = false;

  function setBusy(/** @type {boolean} */ v) {
    busy = v;
    btn.classList.toggle('is-busy', v);
    if (v) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  async function share() {
    if (busy) return 'busy';
    const url = c.url ? c.url() : pageUrl(location);
    const title = c.title ? c.title() : doc.title;
    if (roleOf(doc) !== 'owner') return shareOrCopy({ title, url }, { nav: c.nav, doc, toast, t });
    setBusy(true);
    try {
      const r = await createLink({ url, title, fetch: c.fetch, api: c.api });
      if (!r.ok) {
        toast(t[r.key] || t.fail);
        return 'error';
      }
      return await shareOrCopy({ title, url: r.url }, { nav: c.nav, doc, toast, t });
    } finally {
      setBusy(false);
    }
  }

  /** @type {any} */ (btn).__sgxShare = true;
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    share();
  });
  return { share };
}
/* @sgx-shell:end */
