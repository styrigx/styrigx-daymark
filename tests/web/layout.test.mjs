// 页面模板（web/layouts）：沉浸式 app 顶栏、三页签、没有搜索 / 快捷面板 / 标签筛选、抽屉只有四个应用。
// 只读模板源码，不用构建；构建后的行为在手机 E2E（tests/web/e2e）。
// 运行：node --test tests/web/layout.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(REPO, p), 'utf8');
const base = read('web/layouts/_default/baseof.html');
const index = read('web/layouts/index.html');
const css = read('web/assets/css/input.css');

test('顶栏：九宫格 · 分段滑块（余响 · 拾录 · 百味，英文 Echo / Trove / Flavors）· 头像只展示', () => {
  const zh = [...base.matchAll(/"zh" "([^"]+)" "en" "([^"]+)" "hash"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(zh, [['余响', 'Echo'], ['拾录', 'Trove'], ['百味', 'Flavors']]);
  assert.match(base, /class="sgx-tb-nav"/);
  assert.match(base, /role="tablist"[^>]*data-dm-seg/);
  assert.match(base, /<span class="sgx-tb-me" aria-hidden="true">/);
  assert.doesNotMatch(base, /<a class="sgx-tb-me"/);
});

test('没有搜索、快捷面板、页名；也没有标签筛选条', () => {
  for (const s of [base, index]) {
    assert.doesNotMatch(s, /sgx-tb-search|sgx-tb-quick|sgx-qp|sgx-tb-title|bk-cap|type="search"|role="search"/);
  }
  assert.doesNotMatch(index, /id="dm-tags"/);
  assert.equal(existsSync(path.join(REPO, 'web/layouts/partials/sgx-qp.html')), false);
  assert.equal(existsSync(path.join(REPO, 'web/assets/js/sgx/shell/capsule-kb.js')), false);
  assert.doesNotMatch(css, /\.bk-cap|\.sgx-qp/);
});

test('抽屉：主站共享外壳的 nav.json（首页 / 书签 / 日刻 / 博客 + 分隔线 + 设置），模板不写死项', () => {
  const nav = JSON.parse(readFileSync(path.join(REPO, 'web/assets/sgx-shell/nav.json'), 'utf8'));
  assert.deepEqual(nav.items.map((i) => i.zh), ['首页', '书签', '日刻', '博客']);
  assert.deepEqual(nav.footer.map((i) => i.zh), ['设置']);
  const drawer = base.slice(base.indexOf('<dialog id="sgx-drawer"'), base.indexOf('</dialog>'));
  assert.match(drawer, /range \$shellNav\.items/);
  assert.match(drawer, /range \$shellNav\.footer/);
  assert.match(drawer, /<hr class="sgx-drawer-div">/);
  assert.doesNotMatch(drawer, /主页|书库/);
});

test('首页三块面板 + 记一句弹层的各个部件都在', () => {
  for (const id of ['dm-pane-echo', 'dm-pane-trove', 'dm-pane-flavors', 'dm-draw', 'dm-back-today', 'dm-share', 'dm-fab',
    'dm-cols', 'dm-authors', 'dm-fl-back', 'ed-preview', 'f-text', 'f-trans-toggle', 'f-author-ac', 'f-author-recent',
    'f-stype', 'f-source-ac', 'f-cols', 'f-col-new-row', 'f-tagbox', 'f-tag-sugg', 'f-note', 'f-public', 'edit-del']) {
    assert.match(index, new RegExp('id="' + id + '"'), id);
  }
  /* 百味只按作者自动分组：没有出处 / 标签分组 */
  assert.doesNotMatch(index, /dm-sources|dm-tags-sec|意境/);
});

test('外观和语言跟主站：baseof 在样式前内联 ui-inherit-run', () => {
  assert.ok(base.indexOf('ui-inherit-run.js') < base.indexOf('css/main.css'));
});
