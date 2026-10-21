/**
 * @fileoverview 日刻继承主站外观和语言：读主站写的 sgx-ui cookie（Domain=styrigx.com，契约同博客 docs/sgx-ui-cookie.md），
 * 首帧前应用深浅色（mode，别名 theme）、调色板（pal）、自定义主题色种子（accent）、字体大小（fs）、减弱动效（rm），
 * 语言（lang）和当前页不同就换到另一种语言的同一页。这里只读不写 cookie。
 *
 * 2026-10-21 起日刻和博客一样是沉浸式 app，没有自己的深浅色 / 语言开关（快捷面板已删），设置全在主站。
 * 颜色是主站共享外壳的色彩角色（input.css 的 @sgx-shell 段）：pal → data-palette；accent 是主站当前种子 #rrggbb，
 * 等于 pal 的预设种子就只用预设，不等就是自定义色（palette-scheme.js 算整套角色，缓存在本站 localStorage）。
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

/** 自定义主题色角色在本站 localStorage 的缓存键（首行「引擎版本|#种子」） */
export const SEED_CACHE = 'sgx-shell-accent-css';
export const SEED_STYLE_ID = 'sgx-accent-roles';
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * 算出要应用的外观。
 * @param {any|null} ui 解码后的 cookie
 * @param {{mode: string|null, at: number}} local 本站本地的深浅色选择和修改时间（日刻已没有开关，页面总是传空）
 * @param {boolean} prefersDark 系统是否深色
 * @param {Record<string,string>} seeds 预设 id → 种子（共享外壳 palettes.json）
 * @returns {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean, seed?: string}}
 *   seed：cookie 的 accent 是自定义色（#rrggbb 且不等于 pal 的预设种子）时才有
 */
export function resolveAppearance(ui, local, prefersDark, seeds) {
  const okMode = (/** @type {any} */ m) => m === 'light' || m === 'dark' || m === 'system';
  let mode = okMode(local.mode) ? /** @type {string} */ (local.mode) : 'system';
  const uiMode = ui && (okMode(ui.mode) ? ui.mode : okMode(ui.theme) ? ui.theme : null);
  if (uiMode) {
    const mat = typeof ui.mat === 'number' ? ui.mat : 0;
    if (!okMode(local.mode) || mat >= (local.at || 0)) mode = uiMode;
  }
  const pal = ui && typeof ui.pal === 'string' && Object.prototype.hasOwnProperty.call(seeds, ui.pal) ? ui.pal : 'lake';
  const fs = ui && (ui.fs === 'small' || ui.fs === 'large') ? ui.fs : 'standard';
  const rm = !!(ui && ui.rm === 1);
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  /** @type {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean, seed?: string}} */
  const out = { mode, dark, pal, fs, rm };
  const acc = ui && typeof ui.accent === 'string' && HEX.test(ui.accent) ? ui.accent.toLowerCase() : '';
  if (acc && acc !== seeds[pal]) out.seed = acc;
  return out;
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
 * 应用到 <html>：class="dark"、data-palette（lake 不写）、字号、减弱动效；自定义主题色见 applySeed。
 * @param {HTMLElement} d
 * @param {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean, seed?: string}} a
 */
export function applyAppearance(d, a) {
  d.classList.toggle('dark', a.dark);
  d.setAttribute('data-theme-mode', a.mode);
  if (a.pal && a.pal !== 'lake') d.setAttribute('data-palette', a.pal);
  else d.removeAttribute('data-palette');
  d.style.fontSize = a.fs === 'large' ? '112.5%' : a.fs === 'small' ? '87.5%' : '';
  d.setAttribute('data-font-size', a.fs);
  d.classList.toggle('reduced-motion', a.rm);
}

/**
 * 自定义主题色：有缓存（版本和种子都对）就插 <style id="sgx-accent-roles">，返回 true；
 * 没缓存返回 false（调用方去加载引擎算）。没有自定义色就删掉 style。
 * @param {Document} doc
 * @param {string} seed '' = 没有自定义色
 * @param {string} ver 共享外壳 palettes.json 的 schemeVersion
 * @param {string|null} cached localStorage 里的缓存
 */
export function applySeed(doc, seed, ver, cached) {
  const d = doc.documentElement;
  let el = doc.getElementById(SEED_STYLE_ID);
  if (!seed) {
    if (el) el.remove();
    d.removeAttribute('data-sgx-seed');
    return true;
  }
  d.setAttribute('data-sgx-seed', seed);
  const head = ver + '|' + seed + '\n';
  const c = cached || '';
  if (c.indexOf(head) !== 0) return false;
  if (!el) {
    el = doc.createElement('style');
    el.id = SEED_STYLE_ID;
    doc.head.appendChild(el);
  }
  const css = c.slice(head.length);
  if (el.textContent !== css) el.textContent = css;
  return true;
}
