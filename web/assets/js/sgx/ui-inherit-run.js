/**
 * @fileoverview baseof 内联执行（IIFE），渲染前应用继承自主站的外观和语言（sgx-ui cookie），不闪屏。
 * - 语言：cookie 的 lang 和本页不同 → location.replace 到另一种语言的同一页（保留 #页签），爬虫不跳
 * - 日刻没有自己的深浅色开关了：清掉旧的 sgx-theme-mode / sgx-theme-at，免得盖过主站设置
 * - 自定义主题色：有缓存首帧直接插；没缓存先按预设渲染，再加载 <html data-sgx-accent-js> 指的引擎脚本（shell-accent.js）算好换上
 * - 跟系统：系统深浅色变化时 window.__sgxApplyUi() 重算
 * - 预设种子和引擎版本由 baseof.html 用 Hugo 从共享外壳 palettes.json 取出，经 js.Build params 传进来（@params：{v, seeds}）。
 *   不再 import 整份 palettes.json：它带 22 套 × 亮 / 暗全部 token，打进内联脚本会让每页 head 多约 170 KB（2026-10 审计 D1）。
 */
import { readUiCookie, resolveAppearance, applyAppearance, applySeed, langTarget, SEED_CACHE } from './lib/ui-inherit.js';
import * as params from '@params';

const BOT = /bot|crawl|spider|slurp|mediapartners|baidu|bingpreview|facebookexternalhit|twitterbot|linkedinbot|embedly|slackbot|discordbot|telegrambot|whatsapp|applebot|duckduckbot|yandex|sogou|semrush|ahrefs/i;
/** 预设 id → 种子 */
const SEEDS = /** @type {Record<string,string>} */ (params.seeds || {});
/** 共享外壳 palettes.json 的 schemeVersion（自定义主题色缓存的版本头） */
const VER = String(params.v || '');

function loadEngine() {
  const d = document.documentElement;
  const src = d.getAttribute('data-sgx-accent-js');
  if (!src || document.getElementById('sgx-accent-js')) return;
  const s = document.createElement('script');
  s.id = 'sgx-accent-js';
  s.src = src;
  s.async = true;
  document.head.appendChild(s);
}

function run(first) {
  try {
    const ui = readUiCookie(document.cookie);
    if (first) {
      try {
        localStorage.removeItem('sgx-theme-mode');
        localStorage.removeItem('sgx-theme-at');
      } catch (e) {}
      if (!BOT.test(navigator.userAgent || '')) {
        const lang = document.documentElement.lang === 'en' ? 'en' : 'zh';
        const go = langTarget(ui, location, lang);
        if (go) {
          location.replace(go);
          return;
        }
      }
    }
    const prefersDark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const a = resolveAppearance(ui, { mode: null, at: 0 }, prefersDark, SEEDS);
    applyAppearance(document.documentElement, a);
    let cached = null;
    try {
      cached = localStorage.getItem(SEED_CACHE);
    } catch (e) {}
    if (!applySeed(document, a.seed || '', VER, cached)) loadEngine();
  } catch (e) {}
}
/** @type {any} */ (window).__sgxApplyUi = () => run(false);
run(true);
try {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const on = () => run(false);
  if (mq.addEventListener) mq.addEventListener('change', on);
  else if (mq.addListener) mq.addListener(on);
} catch (e) {}
