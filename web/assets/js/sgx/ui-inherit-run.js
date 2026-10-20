/**
 * @fileoverview B2-7：baseof 内联执行（IIFE），渲染前应用继承自主站的外观。
 * 页面里的设置改深浅色后也调用 window.__sgxApplyUi() 重算。
 */
import { readUiCookie, resolveAppearance, applyAppearance } from './lib/ui-inherit.js';

function run() {
  try {
    let mode = null,
      at = 0;
    try {
      mode = localStorage.getItem('sgx-theme-mode');
      at = Number(localStorage.getItem('sgx-theme-at') || 0) || 0;
    } catch (e) {}
    const prefersDark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    applyAppearance(document.documentElement, resolveAppearance(readUiCookie(document.cookie), { mode, at }, prefersDark));
  } catch (e) {}
}
/** @type {any} */ (window).__sgxApplyUi = run;
run();
