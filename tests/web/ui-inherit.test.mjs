/**
 * 继承主站外观（sgx-ui cookie）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readUiCookie, resolveAppearance, langTarget, applySeed } from '../../web/assets/js/sgx/lib/ui-inherit.js';

/* 预设种子来自主站共享外壳 palettes.json（和 ui-inherit-run.js 同一份） */
const palettes = JSON.parse(readFileSync(new URL('../../web/assets/sgx-shell/palettes.json', import.meta.url), 'utf8'));
const SEEDS = Object.fromEntries(palettes.presets.map((p) => [p.id, p.seed]));
const R = (ui, local, dark) => resolveAppearance(ui, local, dark, SEEDS);

const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/* 1. cookie 解码（含中文城市名） */
const ui = { v: 2, mode: 'dark', mat: 1000, pal: 'matcha', fs: 'large', rm: 1, city: { name: '洛杉矶' } };
const got = readUiCookie('a=1; sgx-ui=' + enc(ui) + '; b=2');
assert.equal(got.pal, 'matcha');
assert.equal(got.city.name, '洛杉矶');
assert.equal(readUiCookie('a=1'), null);
assert.equal(readUiCookie('sgx-ui=%%%'), null);

/* 2. 没有 cookie：保持本站原行为 */
assert.deepEqual(R(null, { mode: null, at: 0 }, true), { mode: 'system', dark: true, pal: 'lake', fs: 'standard', rm: false });
assert.equal(R(null, { mode: 'light', at: 5 }, true).dark, false);

/* 3. 有 cookie、本站没改过：跟主站 */
let a = R(got, { mode: null, at: 0 }, false);
assert.deepEqual(a, { mode: 'dark', dark: true, pal: 'matcha', fs: 'large', rm: true });

/* 4. 深浅色谁后改听谁的 */
assert.equal(R(got, { mode: 'light', at: 500 }, false).mode, 'dark'); /* 主站后改 */
assert.equal(R(got, { mode: 'light', at: 2000 }, false).mode, 'light'); /* 本站后改 */
/* 本站后改深浅色也不影响调色板 */
assert.equal(R(got, { mode: 'light', at: 2000 }, false).pal, 'matcha');

/* 5. 非法值兜底 */
a = R({ mode: 'neon', pal: '<x>', fs: 'huge', rm: '1' }, { mode: null, at: 0 }, false);
assert.deepEqual(a, { mode: 'system', dark: false, pal: 'lake', fs: 'standard', rm: false });

/* 6. theme 是 mode 的别名；accent = 主站种子：等于 pal 的预设种子 → 不算自定义；其他 #rrggbb → seed；旧的色板 id / 非法值丢掉 */
assert.equal(R({ theme: 'dark' }, { mode: null, at: 0 }, false).dark, true);
assert.equal(R({ mode: 'light', theme: 'dark' }, { mode: null, at: 0 }, true).dark, false);
assert.equal(R({ pal: 'rose', accent: SEEDS.rose }, { mode: null, at: 0 }, false).seed, undefined);
assert.equal(R({ pal: 'rose', accent: '#AA3355' }, { mode: null, at: 0 }, false).seed, '#aa3355');
assert.equal(R({ accent: SEEDS.lake.toUpperCase() }, { mode: null, at: 0 }, false).seed, undefined);
assert.equal(R({ accent: 'rose' }, { mode: null, at: 0 }, false).seed, undefined);
assert.equal(R({ accent: 'url(x)' }, { mode: null, at: 0 }, false).seed, undefined);
assert.equal(R({ pal: 'nosuch' }, { mode: null, at: 0 }, false).pal, 'lake');
assert.equal(palettes.presets.length, 33);

/* 6b. applySeed：有缓存（版本 + 种子对）插 style；没缓存返回 false；没有自定义色删 style */
const fakeDoc = () => {
  const els = {};
  const attrs = {};
  const doc = {
    documentElement: { setAttribute: (k, v) => (attrs[k] = v), removeAttribute: (k) => delete attrs[k] },
    getElementById: (id) => els[id] || null,
    createElement: () => ({ id: '', textContent: '', remove() { delete els[this.id]; } }),
    head: { appendChild: (el) => (els[el.id] = el) },
  };
  return { doc, els, attrs };
};
let f = fakeDoc();
assert.equal(applySeed(f.doc, '#aa3355', 'v1', null), false);
assert.equal(f.attrs['data-sgx-seed'], '#aa3355');
assert.equal(f.els['sgx-accent-roles'], undefined);
f = fakeDoc();
assert.equal(applySeed(f.doc, '#aa3355', 'v1', 'v1|#aa3355\nhtml:root{--sgx-primary:#a35}'), true);
assert.equal(f.els['sgx-accent-roles'].textContent, 'html:root{--sgx-primary:#a35}');
assert.equal(applySeed(f.doc, '#aa3355', 'v2', 'v1|#aa3355\nx'), false, '引擎版本变了：缓存作废');
assert.equal(applySeed(f.doc, '', 'v1', null), true);
assert.equal(f.els['sgx-accent-roles'], undefined);
assert.equal(f.attrs['data-sgx-seed'], undefined);

/* 7. 语言跟主站：只在不同的时候跳，保留 #页签 */
assert.equal(langTarget({ lang: 'en' }, { pathname: '/', hash: '#trove' }, 'zh'), '/en/#trove');
assert.equal(langTarget({ lang: 'zh' }, { pathname: '/en/', hash: '#flavors' }, 'en'), '/#flavors');
assert.equal(langTarget({ lang: 'zh' }, { pathname: '/en/404.html' }, 'en'), '/404.html');
assert.equal(langTarget({ lang: 'zh' }, { pathname: '/' }, 'zh'), '');
assert.equal(langTarget({}, { pathname: '/' }, 'zh'), '');
assert.equal(langTarget(null, { pathname: '/en/' }, 'en'), '');

console.log('ui-inherit: ok');
