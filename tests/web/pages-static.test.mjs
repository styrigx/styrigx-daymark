// Pages 只放静态文件：
// - web/static/_worker.js：pages.dev 等非正式域名一律 301 回 daymark.styrigx.com，正式域名原样交给静态文件
// - web/static/_headers：指纹化 /js/ /css/ 长期缓存
// - Pages 配置不带变量、钥匙、数据绑定；仓库里没有 Pages Functions
// 运行：node --test tests/web/pages-static.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  assert.doesNotMatch(src, /SGX_|sgx-verified|crypto\.subtle/);
});
