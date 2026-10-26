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

test('顶栏：九宫格 · 长条（首页 = 分段滑块 余响 · 拾录 · 百味，英文 Echo / Trove / Flavors；其他页只有页名）· 右圆分享', () => {
  const zh = [...base.matchAll(/"zh" "([^"]+)" "en" "([^"]+)" "hash"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(zh, [['余响', 'Echo'], ['拾录', 'Trove'], ['百味', 'Flavors']]);
  assert.match(base, /class="sgx-tb-nav"/);
  assert.match(base, /role="tablist"[^>]*data-dm-seg/);
  assert.match(base, /\{\{ else \}\}\s*<span class="sgx-tb-title">\{\{ \$pageName \}\}<\/span>/);
  /* 2026-10-24：留言板撤了，右边只剩分享圆（共享外壳 .sgx-tb-end 样式，同九宫格圆；share.js，图标 nav.json share） */
  assert.match(base, /<\/div>\s*<button type="button" class="sgx-tb-end sgx-tb-share" data-sgx-share [^>]*>\{\{ index \(resources\.Get "sgx-shell\/nav\.json" \| transform\.Unmarshal\)\.icons "share" \| safeHTML \}\}<\/button>\s*<\/div>\s*<\/header>/);
  assert.doesNotMatch(base, /sgx-tb-end-group|sgx-tb-gbtn|guestbook/);
  assert.match(base, /resources\.Get "js\/sgx\/share-host\.js" \| js\.Build/);
  assert.doesNotMatch(base, /sgx-tb-me|sgx-tb-avatar|sgx-seg--none/);
});

test('没有搜索、快捷面板；首页长条不放页名（页名只在 404）；也没有标签筛选条', () => {
  for (const s of [base, index]) {
    assert.doesNotMatch(s, /sgx-tb-search|sgx-tb-quick|sgx-qp|bk-cap|type="search"|role="search"/);
  }
  assert.doesNotMatch(index, /sgx-tb-title/);
  /* 页名只在 if .IsHome（分段滑块）的 else 分支里 */
  assert.ok(base.lastIndexOf('class="sgx-tb-title"') > base.indexOf('data-dm-seg'));
  assert.doesNotMatch(index, /id="dm-tags"/);
  assert.equal(existsSync(path.join(REPO, 'web/layouts/partials/sgx-qp.html')), false);
  assert.equal(existsSync(path.join(REPO, 'web/assets/js/sgx/shell/capsule-kb.js')), false);
  assert.doesNotMatch(css, /\.bk-cap|\.sgx-qp/);
});

test('没有版权页脚（© / Powered by），样式也删干净', () => {
  assert.doesNotMatch(base, /<footer|©|Powered by/);
  assert.doesNotMatch(css.slice(css.indexOf('/* @sgx-shell:end */')), /(^|[\s,}])footer\b|sgx-powered|sgx-tb-me/);
});

test('留言板撤了（2026-10-24）：没有 /guestbook/ 页面、模板、脚本、Giscus 配置和样式', async () => {
  const { existsSync } = await import('node:fs');
  for (const f of ['web/layouts/_default/guestbook.html', 'web/content/guestbook.md', 'web/content/en/guestbook.md', 'web/assets/js/guestbook.js']) {
    assert.equal(existsSync(new URL('../../' + f, import.meta.url)), false, f);
  }
  assert.doesNotMatch(read('web/hugo.yaml'), /guestbook|giscus/i);
  assert.doesNotMatch(css.slice(css.indexOf('/* @sgx-shell:end */')), /dm-gb-|giscus|guestbook/);
});

test('抽屉：主站共享外壳的 nav.json（主站 / 奇趣 / 日刻 / 博客），模板不写死项；结构同主站', () => {
  const nav = JSON.parse(readFileSync(path.join(REPO, 'web/assets/sgx-shell/nav.json'), 'utf8'));
  assert.deepEqual(nav.items.map((i) => i.zh), ['主站', '奇趣', '日刻', '博客']);
  assert.deepEqual(nav.footer, []);
  assert.equal(nav.me.href, 'https://styrigx.com/account/');
  const drawer = base.slice(base.indexOf('<dialog id="sgx-drawer"'), base.indexOf('</dialog>'));
  assert.match(drawer, /range \$shellNav\.items/);
  assert.match(drawer, /with \$shellNav\.footer/);
  /* 和主站同一结构（2026-10-22）：头部字标 + 头像（链主站账号页），导航项下一条分隔线，底栏搜索框 */
  assert.match(drawer, /class="sgx-drawer-head"><span class="sgx-drawer-brand">\{\{ \$shellNav\.wordmark \| safeHTML \}\}/);
  assert.match(drawer, /<a class="sgx-drawer-me" href="\{\{ \$me \}\}"/);
  assert.match(drawer, /<hr class="sgx-drawer-sep" aria-hidden="true">/);
  assert.match(drawer, /<div class="sgx-drawer-foot"><a class="sgx-drawer-search"/);
  assert.match(drawer, /eq \.id "daymark"/);
  assert.doesNotMatch(drawer, /主页|书库/);
});

test('首页三块面板 + 记一句弹层的各个部件都在', () => {
  for (const id of ['dm-pane-echo', 'dm-pane-trove', 'dm-pane-flavors', 'dm-draw', 'dm-set-today', 'dm-back-today', 'dm-share', 'dm-fab',
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

test('robots.txt 用 static 里的 Disallow: /（Hugo 内置 robots 模板关掉，否则会盖成全部允许）', () => {
  assert.match(read('web/hugo.yaml'), /^enableRobotsTXT: false$/m);
  assert.match(read('web/static/robots.txt'), /^User-agent: \*\nDisallow: \/$/m);
});

test('head 内联脚本和自定义色引擎不打包整份 palettes.json（预设表在共享读端里，引擎版本用读端的 SCHEME_VER）', () => {
  for (const f of ['web/assets/js/sgx/ui-inherit-run.js', 'web/assets/js/sgx/shell-accent.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /^import .*palettes\.json/m, f);
    assert.doesNotMatch(src, /@params/, f);
  }
  assert.doesNotMatch(base, /sgx-shell\/palettes\.json/);
  assert.match(base, /<script>\{\{ \(resources\.Get "js\/sgx\/shell\/ui-cookie-read\.js" \| minify\)\.Content \| safeJS \}\}<\/script>/);
  assert.match(base, /js\/sgx\/ui-inherit-run\.js" \| js\.Build \(dict "format" "iife" "minify" true "target" "es2018"\)\)/);
});
