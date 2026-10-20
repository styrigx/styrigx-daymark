/**
 * @fileoverview B2-7 书站继承主站外观：读主站写的 sgx-ui cookie（Domain=styrigx.com），
 * 首帧前应用深浅色、调色板、字体大小、减弱动效。主站 localStorage 是唯一来源，这里只读不写 cookie。
 *
 * 深浅色两边都能改：主站 cookie 带 mat（mode 最近修改时间），本站设置里改了记 sgx-theme-at，谁后改听谁的。
 * 调色板、字体大小、减弱动效只跟主站。没有 cookie（没开过主站）时保持书站原来的行为。
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
 * @returns {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean}}
 */
export function resolveAppearance(ui, local, prefersDark) {
  const okMode = (/** @type {any} */ m) => m === 'light' || m === 'dark' || m === 'system';
  let mode = okMode(local.mode) ? /** @type {string} */ (local.mode) : 'system';
  if (ui && okMode(ui.mode)) {
    const mat = typeof ui.mat === 'number' ? ui.mat : 0;
    if (!okMode(local.mode) || mat >= (local.at || 0)) mode = ui.mode;
  }
  const pal = ui && typeof ui.pal === 'string' && /^[a-z]{2,16}$/.test(ui.pal) ? ui.pal : 'lake';
  const fs = ui && (ui.fs === 'small' || ui.fs === 'large') ? ui.fs : 'standard';
  const rm = !!(ui && ui.rm === 1);
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  return { mode, dark, pal, fs, rm };
}

/**
 * 应用到 <html>。
 * @param {HTMLElement} d
 * @param {{mode: string, dark: boolean, pal: string, fs: string, rm: boolean}} a
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
