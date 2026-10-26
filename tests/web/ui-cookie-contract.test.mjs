/**
 * sgx-ui cookie 契约：主站写端（styrigx-space lib/ui-cookie.js）↔ 本站读端（共享外壳 ui-cookie-read.js，sync-shell 原样同步，baseof.html 内联）。
 * 夹具 tests/fixtures/ui-cookie-contract.json = 主站写端真实写出的 cookie + 读端期望（sync-shell 原样同步，勿手改）；
 * 这里对每个用例断言：本站内联的读端 read / resolve / apply 得到夹具里的期望（系统浅色、深色各一遍），且读端从不写 cookie。
 * 主站改了契约 → 跑 node scripts/sync-shell.mjs 同步读端和夹具，再跑本测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sandbox } from './ui-cookie-sandbox.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const fx = JSON.parse(read('tests/fixtures/ui-cookie-contract.json'));
const palettes = JSON.parse(read('web/assets/sgx-shell/palettes.json'));

/** <html> 状态，和夹具 root 同形 */
function rootState(html) {
  return {
    dark: html.classList.contains('dark'),
    'data-theme-mode': html.getAttribute('data-theme-mode'),
    'data-dark': html.getAttribute('data-dark'),
    'data-font-size': html.getAttribute('data-font-size'),
    fontSize: html.style.fontSize,
    'data-palette': html.getAttribute('data-palette'),
    '--sgx-seed': html.style.getPropertyValue('--sgx-seed'),
    'reduced-motion': html.classList.contains('reduced-motion'),
    'data-reduced-motion': html.getAttribute('data-reduced-motion'),
  };
}
const plain = (o) => JSON.parse(JSON.stringify(o));

test('夹具来自主站写端：31 个用例，覆盖默认 dustyblue、lake、旧撞色、自定义色、旧 v1 / v2、旧种子、theme 别名、大写 accent、未知版本、乱码', () => {
  assert.match(fx._generated, /styrigx-space scripts\/gen-ui-cookie-contract\.mjs/);
  assert.equal(fx.cases.length, 31);
  const names = fx.cases.map((c) => c.name).join('|');
  for (const k of ['默认 dustyblue 亮色', '湖蓝 lake', '旧撞色 xforest', '自定义主题色', '旧 v1', '旧 v2', '旧种子', 'theme 别名', 'accent 大写', '未知版本', '版本是字符串', '没有 v', '乱码']) {
    assert.match(names, new RegExp(k), k);
  }
});

for (const c of fx.cases) {
  test(`契约：${c.name}`, () => {
    for (const sys of ['light', 'dark']) {
      const s = sandbox({ cookie: 'sgx-lock-session=x; sgx-ui=' + c.cookie + '; other=1', dark: sys === 'dark' });
      assert.deepEqual(plain(s.U.read()), c.read, 'read');
      assert.deepEqual(plain(s.U.read('sgx-ui=' + c.cookie)), c.read, 'read(串)');
      assert.deepEqual(plain(s.U.resolve(s.U.read(), sys === 'dark')), c[sys].resolve, sys + ' resolve');
      const a = s.U.apply(s.html, { onMiss() {} });
      assert.deepEqual(plain(a), c[sys].resolve, sys + ' apply 返回');
      assert.deepEqual(rootState(s.html), c[sys].root, sys + ' <html>');
      assert.equal(s.cookieWrites, 0, '读端不许写 cookie');
    }
  });
}

test('读端预设表 / 引擎版本 / 默认色板 = 共享外壳 palettes.json（默认 dustyblue，不是 lake）', () => {
  const s = sandbox();
  assert.deepEqual(plain(s.U.PRESETS), Object.fromEntries(palettes.presets.map((p) => [p.id, p.seed])));
  assert.equal(Object.keys(s.U.PRESETS).length, 22);
  assert.equal(s.U.SCHEME_VER, palettes.schemeVersion);
  assert.equal(s.U.DEFAULT_PAL, palettes.default);
  assert.equal(s.U.DEFAULT_PAL, 'dustyblue');
  assert.deepEqual(plain(s.U.VERSIONS), [1, 2]);
});

const cookieOf = (name) => 'sgx-ui=' + fx.cases.find((c) => c.name.startsWith(name)).cookie;

test('自定义色：没缓存回调 onMiss（本站去加载 shell-accent.js），setRoles 写 <style> + 本站缓存；有缓存首帧直接插；换回预设撤掉', () => {
  const s1 = sandbox({ cookie: cookieOf('自定义主题色（默认色板上）') });
  let missed = '';
  s1.U.apply(s1.html, { onMiss: (seed) => { missed = seed; } });
  assert.equal(missed, '#1f8a70');
  assert.equal(s1.html.style.getPropertyValue('--sgx-seed'), '#1f8a70');
  assert.equal(s1.html.getAttribute('data-sgx-seed'), null, '不再用 data-sgx-seed');
  assert.equal(s1.U.setRoles('#1f8a70', ':root{--sgx-primary:#1f8a70}'), true);
  assert.equal(s1.ls.get('sgx-shell-accent-css'), palettes.schemeVersion + '|#1f8a70\n:root{--sgx-primary:#1f8a70}');

  const s2 = sandbox({ cookie: cookieOf('自定义主题色（默认色板上）'), store: { 'sgx-shell-accent-css': palettes.schemeVersion + '|#1f8a70\nCSS' } });
  s2.U.apply(s2.html, { onMiss: () => assert.fail('有缓存不该回调') });
  assert.equal(s2.ctx.document.getElementById('sgx-accent-roles').textContent, 'CSS');
  s2.setCookie(cookieOf('湖蓝 lake'));
  s2.U.apply(s2.html);
  assert.equal(s2.ctx.document.getElementById('sgx-accent-roles'), null);
  assert.equal(s2.html.style.getPropertyValue('--sgx-seed'), '');
  assert.equal(s2.html.getAttribute('data-palette'), 'lake');
});

test('跟随系统：系统深浅色一变就重落（读端自己挂一次监听）', () => {
  const s = sandbox({ cookie: cookieOf('跟随系统'), dark: false });
  s.U.apply(s.html);
  s.U.apply(s.html);
  assert.equal(s.listeners.length, 1);
  s.flip(true);
  assert.equal(s.html.classList.contains('dark'), true);
  assert.equal(s.html.getAttribute('data-dark'), '1');
});
