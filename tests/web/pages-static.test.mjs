// Pages 只放静态文件：
// - web/static/_worker.js：pages.dev 等非正式域名一律 301 回 daymark.styrigx.com，正式域名原样交给静态文件
// - web/static/_headers：指纹化 /js/ /css/ 长期缓存
// - 图片一律要过会话（2026-10-29）：Pages 一张图片都不出（_worker.js 按后缀 / Content-Type 404），web/ 里也不许放图片文件
// - Pages 配置不带变量、钥匙、数据绑定；仓库里没有 Pages Functions
// 运行：node --test tests/web/pages-static.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(path.join(REPO, 'web/static/_worker.js'), 'utf8');
/* package.json 不是 "type": "module"，复制成 .mjs 再 import */
const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'dm-worker-')), '_worker.mjs');
writeFileSync(tmp, src);
const worker = (await import(pathToFileURL(tmp).href)).default;
const env = { ASSETS: { fetch: async (req) => new Response('static:' + new URL(req.url).pathname) } };

test('pages.dev 生产别名、哈希预览别名都 301 回正式域名，保留路径和查询串', async () => {
  for (const host of ['styrigx-daymark.pages.dev', 'abc123.styrigx-daymark.pages.dev']) {
    const res = await worker.fetch(new Request('https://' + host + '/en/?x=1'), env);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('Location'), 'https://daymark.styrigx.com/en/?x=1');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
});

test('正式域名交给静态文件', async () => {
  const res = await worker.fetch(new Request('https://daymark.styrigx.com/en/'), env);
  assert.equal(await res.text(), 'static:/en/');
});

test('_headers：指纹化资源长期缓存', () => {
  const h = readFileSync(path.join(REPO, 'web/static/_headers'), 'utf8');
  assert.match(h, /^\/js\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m);
  assert.match(h, /^\/css\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m);
});

test('Pages 零钥匙：没有 functions/，配置没有变量和绑定，_worker.js 不验签', () => {
  assert.equal(existsSync(path.join(REPO, 'functions')), false);
  assert.equal(existsSync(path.join(REPO, 'web/functions')), false);
  const toml = readFileSync(path.join(REPO, 'web/wrangler.toml'), 'utf8');
  assert.match(toml, /^name = "styrigx-daymark"$/m);
  assert.doesNotMatch(toml, /^\[|SGX_/m);
  assert.doesNotMatch(src, /SGX_|sgx-lock-session|crypto\.subtle/);
});

/* ---- 图片一律要过会话：Pages 不出图片 ---- */

/** 假的 ASSETS：按路径回不同的静态回答 */
function assetsWith(map) {
  return {
    fetch: async (req) => {
      const p = new URL(req.url).pathname;
      const hit = map[p];
      return hit ? hit() : new Response('<html>404</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    },
  };
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('图片后缀一律 404（不管文件在不在、大小写、带查询串），不带图片字节、no-store', async () => {
  const assets = assetsWith({
    '/a.png': () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }),
    '/img/b.SVG': () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } }),
  });
  for (const p of ['/a.png', '/img/b.SVG', '/a.png?v=1', '/x.jpg', '/x.jpeg', '/x.webp', '/x.avif', '/x.gif', '/x.ico', '/x.bmp', '/x.heic', '/x.jxl', '/x.svgz', '/fav/apple-touch-icon.png']) {
    const res = await worker.fetch(new Request('https://daymark.styrigx.com' + p), { ASSETS: assets });
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get('Cache-Control'), 'no-store', p);
    assert.doesNotMatch(res.headers.get('Content-Type') || '', /^image\//, p);
    assert.equal(await res.text(), 'not found', p);
  }
});

test('没有后缀但回答是 image/* 的也 404；非图片照常', async () => {
  const assets = assetsWith({
    '/blob': () => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }),
    '/fonts/inter-latin.woff2': () => new Response('font', { headers: { 'Content-Type': 'font/woff2' } }),
    '/robots.txt': () => new Response('User-agent: *', { headers: { 'Content-Type': 'text/plain' } }),
  });
  assert.equal((await worker.fetch(new Request('https://daymark.styrigx.com/blob'), { ASSETS: assets })).status, 404);
  const font = await worker.fetch(new Request('https://daymark.styrigx.com/fonts/inter-latin.woff2'), { ASSETS: assets });
  assert.equal(font.status, 200);
  assert.equal(await font.text(), 'font');
  assert.equal((await worker.fetch(new Request('https://daymark.styrigx.com/robots.txt'), { ASSETS: assets })).status, 200);
});

test('唯一例外：/favicon.ico 的 302（_redirects 跳主站头像）原样放行，不带图片字节', async () => {
  const assets = assetsWith({
    '/favicon.ico': () => new Response(null, { status: 302, headers: { Location: 'https://styrigx.com/avatar/32.webp' } }),
  });
  const res = await worker.fetch(new Request('https://daymark.styrigx.com/favicon.ico'), { ASSETS: assets });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), 'https://styrigx.com/avatar/32.webp');
  const r = readFileSync(path.join(REPO, 'web/static/_redirects'), 'utf8');
  /* _redirects 只许跳到主站（站外公开头像），不许指向本站任何图片 */
  for (const line of r.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))) {
    assert.match(line, /^\/favicon\.ico\s+https:\/\/styrigx\.com\/avatar\/\d+\.webp\s+302$/, line);
  }
});

test('web/ 里没有图片文件（Pages 不出图片；图片只能走接口 Worker 的 /api/*，先验会话）', () => {
  const IMG = /\.(png|apng|jpe?g|jfif|pjpeg|pjp|gif|webp|avif|svgz?|ico|cur|bmp|tiff?|heic|heif|jxl)$/i;
  const skip = new Set(['public', 'resources', 'node_modules']);
  const bad = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir, e.name), rel + e.name + '/'); }
      else if (IMG.test(e.name)) bad.push(rel + e.name);
    }
  };
  walk(path.join(REPO, 'web'), 'web/');
  assert.deepEqual(bad, []);
});
