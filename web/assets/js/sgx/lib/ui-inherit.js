/**
 * @fileoverview 日刻跟主站语言：读主站写的 sgx-ui cookie（Domain=styrigx.com），语言（lang）和当前页不同就换到另一种语言的同一页。
 * 这里只读不写 cookie。
 *
 * 外观（深浅色、色板、自定义主题色、字号、减弱动效）不在这里：首帧前由主站共享外壳的读端 ui-cookie-read.js 落到 <html>
 * （baseof.html 原样内联，挂 window.SgxUI；ui-inherit-run.js 调 SgxUI.apply）。契约见主站 styrigx-space docs/ui-cookie-contract.md，
 * 夹具 tests/fixtures/ui-cookie-contract.json 由 tests/web/ui-cookie-contract.test.mjs 逐个跑。
 *
 * 语言也先过共享读端的校验（版本 v 不认识 / 乱码 = 没有 cookie，不跳）。主站写端现在还不写 lang，所以语言跟随暂时不会触发；
 * 主站以后加上 lang 时两种情况都兼容：SgxUI.read() 返回了 lang 就用它，没返回就从同一份 cookie 的原始 JSON 取。
 */

/**
 * cookie 里的语言。
 * @param {any} U 共享读端（window.SgxUI）
 * @param {string} cookieHeader document.cookie
 * @returns {'zh'|'en'|''}
 */
export function cookieLang(U, cookieHeader) {
  const ui = U && typeof U.read === 'function' ? U.read(String(cookieHeader || '')) : null;
  if (!ui) return '';
  let lang = ui.lang;
  if (lang === undefined) {
    const m = String(cookieHeader || '').match(/(?:^|;\s*)sgx-ui=([^;]*)/);
    const raw = m ? U.decode(m[1]) : null;
    lang = raw ? raw.lang : undefined;
  }
  return lang === 'zh' || lang === 'en' ? lang : '';
}

/**
 * 语言跟主站：want 和本页语言不同时，返回另一种语言的同一页（保留查询串和 #页签）；不用跳返回 ''。
 * 日刻每页都有中英两版：/xxx ↔ /en/xxx。
 * @param {'zh'|'en'|''} want cookieLang() 的结果
 * @param {{pathname: string, search?: string, hash?: string}} loc
 * @param {'zh'|'en'} pageLang
 */
export function langTarget(want, loc, pageLang) {
  if ((want !== 'zh' && want !== 'en') || want === pageLang) return '';
  const p = loc.pathname || '/';
  const to = want === 'en' ? '/en' + (p === '/' ? '/' : p) : p.replace(/^\/en(\/|$)/, '/') || '/';
  return to + (loc.search || '') + (loc.hash || '');
}
