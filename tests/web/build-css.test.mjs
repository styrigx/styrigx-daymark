// 构建产物守卫：毛玻璃的 -webkit-backdrop-filter 和标准 backdrop-filter 两行都要活过 Tailwind --minify。
// 压缩器会把同一规则里同值（var()）的两行合并成一行，Chromium（含三星浏览器）或旧 Safari 就没了毛玻璃；
// 共享外壳把标准属性单独放进 @supports。web/assets/css/main.css 是提交进仓库的构建产物，CI 先 npm run build:css 再跑本测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../web/assets/css/main.css', import.meta.url), 'utf8');

/** 选择器 → { std, webkit }：同一选择器在任何规则（含 @supports 里）写过哪一种 */
function backdropBySelector(src) {
  const out = new Map();
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const std = /(?<![-\w])backdrop-filter\s*:/.test(m[2]);
    const webkit = /-webkit-backdrop-filter\s*:/.test(m[2]);
    if (!std && !webkit) continue;
    const e = out.get(sel) || { std: false, webkit: false };
    out.set(sel, { std: e.std || std, webkit: e.webkit || webkit });
  }
  return out;
}

test('main.css 里每个毛玻璃选择器都同时有 -webkit-backdrop-filter 和 backdrop-filter', () => {
  const map = backdropBySelector(css);
  const bad = [...map].filter(([, v]) => !(v.std && v.webkit)).map(([s, v]) => `${s} → ${v.std ? '只有标准' : '只有 -webkit-'}`);
  assert.deepEqual(bad, []);
  const sels = [...map.keys()];
  for (const want of [/\.sgx-tb-pill/, /\.sgx-tb-nav/, /\.sgx-drawer-sheet/]) {
    assert.ok(sels.some((s) => want.test(s)), `${want} 的毛玻璃不在 main.css 里`);
  }
});
