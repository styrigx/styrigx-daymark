/**
 * @fileoverview 自定义主题色引擎加载器（共享读端 SgxUI.apply 在 cookie 是自定义色且本站没缓存时经 onMiss 加载本脚本）：
 * 用主站共享外壳的 palette-scheme.js 按 <html> 内联的 --sgx-seed 算整套色彩角色，交给 SgxUI.setRoles
 * 插 <style id="sgx-accent-roles"> 并缓存（缓存版本头用读端的 SCHEME_VER，和 palette-scheme.js 来自同一个主站提交）。
 */
import { rolesCss } from './shell/palette-scheme.js';

(() => {
  const U = /** @type {any} */ (window).SgxUI;
  const seed = document.documentElement.style.getPropertyValue('--sgx-seed').trim();
  if (!U || !/^#[0-9a-f]{6}$/.test(seed)) return;
  U.setRoles(seed, rolesCss(seed));
})();
