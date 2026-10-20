/**
 * 继承主站外观（sgx-ui cookie）。
 */
import assert from 'node:assert/strict';
import { readUiCookie, resolveAppearance } from '../../web/assets/js/sgx/lib/ui-inherit.js';

const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* 1. cookie 解码（含中文城市名） */
const ui = { v: 2, mode: 'dark', mat: 1000, pal: 'matcha', fs: 'large', rm: 1, city: { name: '洛杉矶' } };
const got = readUiCookie('a=1; sgx-ui=' + enc(ui) + '; b=2');
assert.equal(got.pal, 'matcha');
assert.equal(got.city.name, '洛杉矶');
assert.equal(readUiCookie('a=1'), null);
assert.equal(readUiCookie('sgx-ui=%%%'), null);

/* 2. 没有 cookie：保持本站原行为 */
assert.deepEqual(resolveAppearance(null, { mode: null, at: 0 }, true), { mode: 'system', dark: true, pal: 'lake', fs: 'standard', rm: false });
assert.equal(resolveAppearance(null, { mode: 'light', at: 5 }, true).dark, false);

/* 3. 有 cookie、本站没改过：跟主站 */
let a = resolveAppearance(got, { mode: null, at: 0 }, false);
assert.deepEqual(a, { mode: 'dark', dark: true, pal: 'matcha', fs: 'large', rm: true });

/* 4. 深浅色谁后改听谁的 */
assert.equal(resolveAppearance(got, { mode: 'light', at: 500 }, false).mode, 'dark'); /* 主站后改 */
assert.equal(resolveAppearance(got, { mode: 'light', at: 2000 }, false).mode, 'light'); /* 本站后改 */
/* 本站后改深浅色也不影响调色板 */
assert.equal(resolveAppearance(got, { mode: 'light', at: 2000 }, false).pal, 'matcha');

/* 5. 非法值兜底 */
a = resolveAppearance({ mode: 'neon', pal: '<x>', fs: 'huge', rm: '1' }, { mode: null, at: 0 }, false);
assert.deepEqual(a, { mode: 'system', dark: false, pal: 'lake', fs: 'standard', rm: false });

console.log('ui-inherit: ok');
