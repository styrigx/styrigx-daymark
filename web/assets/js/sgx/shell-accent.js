/**
 * @fileoverview 自定义主题色引擎加载器（ui-inherit-run.js 只在 cookie 是自定义色且本站没缓存时才加载本脚本）：
 * 用主站共享外壳的 palette-scheme.js 按 <html data-sgx-seed> 算整套色彩角色，插 <style id="sgx-accent-roles"> 并缓存。
 */
import { rolesCss } from './shell/palette-scheme.js';
import { SEED_CACHE, applySeed } from './lib/ui-inherit.js';
import palettes from '../../sgx-shell/palettes.json';

(() => {
  const seed = document.documentElement.getAttribute('data-sgx-seed');
  if (!seed) return;
  const text = palettes.schemeVersion + '|' + seed + '\n' + rolesCss(seed);
  try {
    localStorage.setItem(SEED_CACHE, text);
  } catch (e) {}
  applySeed(document, seed, palettes.schemeVersion, text);
})();
