// 主站共享外壳副本（scripts/sync-shell.mjs 写入）：没被手改，sgx-shell.lock.json 的指纹对得上；渲染逻辑稳定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readBlock, renderTargets, BEGIN, END } from '../../scripts/sync-shell.mjs';

const root = new URL('../../', import.meta.url);
const lock = JSON.parse(readFileSync(new URL('sgx-shell.lock.json', root), 'utf8'));
const sha = (s) => createHash('sha256').update(s).digest('hex');

test('副本和 lock 一致（改外壳请改主站，再跑 node scripts/sync-shell.mjs）', () => {
  for (const [p, h] of Object.entries(lock.vendored)) {
    const text = readFileSync(new URL(p, root), 'utf8');
    const body = p.endsWith('.json') ? text : readBlock(text);
    assert.ok(body !== null, p + ' 缺少 @sgx-shell 标记');
    assert.equal(sha(body), h, p);
  }
});

test('JSON 副本就是主站文件原样（sha 同 manifest）', () => {
  for (const [p] of Object.entries(lock.vendored)) {
    if (!p.endsWith('.json')) continue;
    const name = p.split('/').pop();
    assert.equal(sha(readFileSync(new URL(p, root), 'utf8')), lock.files[name], p);
  }
});

test('renderTargets：标记段带来源和版本，内容按 manifest 拼接', () => {
  const files = {
    'tokens.css': ':root{--sgx-primary:#000}\n',
    'shell.css': '.sgx-drawer{}\n',
    'palette-scheme.js': 'export const x = 1;\n',
    'search.js': 'export function mountSearch() {}\n',
    'share.js': 'export function mountShare() {}\n',
    'nav.json': '{"items":[]}\n',
    'palettes.json': '{"presets":[]}\n',
    'ui-cookie-read.js': '(function (g) { g.SgxUI = {}; })(this);\n',
    'ui-cookie-contract.json': '{"cases":[]}\n',
  };
  const { out } = renderTargets({ manifest: { version: 'abc', files: {} }, files }, 'main', () => `a\n${BEGIN} x */\nold\n${END}\nb\n`);
  for (const [p, text] of Object.entries(out)) {
    if (p.endsWith('.json')) continue;
    assert.ok(text.includes(BEGIN + ' styrigx/styrigx-space@main web/shared/shell vabc'), p);
    assert.ok(text.includes(END), p);
    assert.doesNotMatch(text, /\nold\n/, p);
  }
});

test('lock 锁定到主站的完整提交 SHA（--check 只和这个提交比，不跟主站 main 走）', () => {
  assert.match(lock.ref, /^[0-9a-f]{40}$/, 'sgx-shell.lock.json 的 ref 要是 40 位提交 SHA：运行 node scripts/sync-shell.mjs 重新同步');
});
