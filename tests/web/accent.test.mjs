// 强调色：input.css 里的 accent 块必须和色板一致（改了色板忘了重跑 scripts/gen-accent-css.mjs 会失败）。
// 运行：node --test tests/web/accent.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CSS_PATH, extractAccents, inject } from '../../scripts/gen-accent-css.mjs';

const css = readFileSync(CSS_PATH, 'utf8');

test('accent 块与色板同步', () => {
  assert.equal(inject(css), css);
});

test('每个色板都有浅色 / 深色两组强调色', () => {
  const acc = extractAccents(css);
  assert.ok(Object.keys(acc).length >= 13);
  for (const [id, v] of Object.entries(acc)) {
    assert.match(v.light.a, /^#[0-9a-f]{6}$/i, id);
    assert.match(v.dark.a, /^#[0-9a-f]{6}$/i, id);
    assert.match(css, new RegExp(`:root\\[data-accent="${id}"\\]`));
  }
});
