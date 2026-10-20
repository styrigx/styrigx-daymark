/**
 * @fileoverview 日刻继承主站外观和语言：读主站写的 sgx-ui cookie（Domain=styrigx.com，契约同博客 docs/sgx-ui-cookie.md），
 * 首帧前应用深浅色（mode，别名 theme）、调色板（pal）、强调色（accent）、字体大小（fs）、减弱动效（rm），
 * 语言（lang）和当前页不同就换到另一种语言的同一页。这里只读不写 cookie。
 *
 * 2026-10-21 起日刻和博客一样是沉浸式 app，没有自己的深浅色 / 语言开关（快捷面板已删），设置全在主站。
 * resolveAppearance 仍接受本地选择（local）以兼容旧数据，但页面传入的永远是空（ui-inherit-run.js 会清掉旧的
 * sgx-theme-mode / sgx-theme-at）。没有 cookie 时跟系统。
 */

/**
 * 解码 sgx-ui cookie。
 * @param {string} cookieHeader document.cookie
 * @returns {any|null}
 */
export function readUiCookie(cookieHeader) {
  const m = String(cookieHeader || '').match(/(?:^|;\s*)sgx-ui=([^;]*)/);
  if (!m || !m[1]) return null;
  try {
    let b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    const v = JSON.parse(decodeURIComponent(escape(atob(b))));
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    return null;
  }
}

/**
 * 算出要应用的外观。
 * @param {any|null} ui 解码后的 cookie
 * @param {{mode: string|null, at: number}} local 书站本地的深浅色选择和修改时间
 * @param {boolean} prefersDark 系统是否深色
 * @returns {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean, accent?: string}}
 */
export function resolveAppearance(ui, local, prefersDark) {
  const okMode = (/** @type {any} */ m) => m === 'light' || m === 'dark' || m === 'system';
  let mode = okMode(local.mode) ? /** @type {string} */ (local.mode) : 'system';
  const uiMode = ui && (okMode(ui.mode) ? ui.mode : okMode(ui.theme) ? ui.theme : null);
  if (uiMode) {
    const mat = typeof ui.mat === 'number' ? ui.mat : 0;
    if (!okMode(local.mode) || mat >= (local.at || 0)) mode = uiMode;
  }
  const pal = ui && typeof ui.pal === 'string' && /^[a-z]{2,16}$/.test(ui.pal) ? ui.pal : 'lake';
  const fs = ui && (ui.fs === 'small' || ui.fs === 'large') ? ui.fs : 'standard';
  const rm = !!(ui && ui.rm === 1);
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  /** @type {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean, accent?: string}} */
  const out = { mode, dark, pal, fs, rm };
  const acc = ui && typeof ui.accent === 'string' ? ui.accent : '';
  if (/^[a-z]{2,16}$/.test(acc) || /^#[0-9a-f]{6}$/i.test(acc)) out.accent = acc.toLowerCase();
  return out;
}

/** #rrggbb 强调色上的文字色：按相对亮度选白字或深字（同博客 SgxInherit） */
export function onColor(hex) {
  const n = (/** @type {number} */ i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * n(1) + 0.7152 * n(3) + 0.0722 * n(5);
  return L > 0.4 ? '#161b20' : '#ffffff';
}

/**
 * 语言跟主站：cookie 的 lang 和本页语言不同时，返回另一种语言的同一页（保留查询串和 #页签）；不用跳返回 ''。
 * 日刻每页都有中英两版：/xxx ↔ /en/xxx。
 * @param {any|null} ui
 * @param {{pathname: string, search?: string, hash?: string}} loc
 * @param {'zh'|'en'} pageLang
 */
export function langTarget(ui, loc, pageLang) {
  const want = ui && (ui.lang === 'zh' || ui.lang === 'en') ? ui.lang : '';
  if (!want || want === pageLang) return '';
  const p = loc.pathname || '/';
  const to = want === 'en' ? '/en' + (p === '/' ? '/' : p) : p.replace(/^\/en(\/|$)/, '/') || '/';
  return to + (loc.search || '') + (loc.hash || '');
}

/**
 * 应用到 <html>。强调色：色板 id → data-accent（input.css 里由 scripts/gen-accent-css.mjs 生成的规则），
 * #rrggbb → 内联 --sgx-accent / --sgx-on-accent；没给就跟调色板（--m-primary）。
 * @param {HTMLElement} d
 * @param {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean, accent?: string}} a
 */
export function applyAppearance(d, a) {
  d.classList.toggle('dark', a.dark);
  d.setAttribute('data-theme-mode', a.mode);
  if (a.pal && a.pal !== 'lake') d.setAttribute('data-palette', a.pal);
  else d.removeAttribute('data-palette');
  d.style.fontSize = a.fs === 'large' ? '112.5%' : a.fs === 'small' ? '87.5%' : '';
  d.setAttribute('data-font-size', a.fs);
  d.classList.toggle('reduced-motion', a.rm);
  d.style.removeProperty('--sgx-accent');
  d.style.removeProperty('--sgx-on-accent');
  const acc = a.accent || '';
  if (/^[a-z]{2,16}$/.test(acc)) d.setAttribute('data-accent', acc);
  else {
    d.removeAttribute('data-accent');
    if (/^#[0-9a-f]{6}$/.test(acc)) {
      d.style.setProperty('--sgx-accent', acc);
      d.style.setProperty('--sgx-on-accent', onColor(acc));
    }
  }
}
