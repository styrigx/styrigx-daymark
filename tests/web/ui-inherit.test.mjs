/**
 * 继承主站外观和语言（sgx-ui cookie）：外观交给共享读端（契约见 ui-cookie-contract.test.mjs），这里测语言跟随和页面接线。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cookieLang, langTarget } from '../../web/assets/js/sgx/lib/ui-inherit.js';
import { sandbox } from './ui-cookie-sandbox.mjs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const U = sandbox().U;

test('cookieLang：先过共享读端校验（v 不认识 / 乱码 / 没有 cookie → 不跟随）', () => {
  assert.equal(cookieLang(U, 'a=1; sgx-ui=' + enc({ v: 2, mode: 'dark', lang: 'en' }) + '; b=2'), 'en');
  assert.equal(cookieLang(U, 'sgx-ui=' + enc({ v: 1, lang: 'zh' })), 'zh');
  assert.equal(cookieLang(U, 'sgx-ui=' + enc({ v: 3, lang: 'en' })), '', '未知版本');
  assert.equal(cookieLang(U, 'sgx-ui=' + enc({ v: '2', lang: 'en' })), '', '版本是字符串');
  assert.equal(cookieLang(U, 'sgx-ui=' + enc({ lang: 'en' })), '', '没有 v');
  assert.equal(cookieLang(U, 'sgx-ui=' + enc({ v: 2, lang: 'fr' })), '');
  assert.equal(cookieLang(U, 'sgx-ui=' + enc({ v: 2 })), '', '主站写端现在不写 lang');
  assert.equal(cookieLang(U, 'sgx-ui=%%%'), '');
  assert.equal(cookieLang(U, ''), '');
  assert.equal(cookieLang(undefined, 'sgx-ui=' + enc({ v: 2, lang: 'en' })), '', '读端没加载就不跳');
});

test('cookieLang：主站以后让 SgxUI.read() 返回 lang 时直接用它', () => {
  const fake = { read: () => ({ v: 2, lang: 'en' }), decode: () => assert.fail('read 已给出 lang，不该再解原始值') };
  assert.equal(cookieLang(fake, 'sgx-ui=x'), 'en');
  const fake2 = { read: () => ({ v: 2, lang: '' }), decode: () => ({ lang: 'en' }) };
  assert.equal(cookieLang(fake2, 'sgx-ui=x'), '', '读端判为不合法就不跟随');
});

test('langTarget：只在不同的时候跳，保留查询串和 #页签', () => {
  assert.equal(langTarget('en', { pathname: '/', hash: '#trove' }, 'zh'), '/en/#trove');
  assert.equal(langTarget('zh', { pathname: '/en/', hash: '#flavors' }, 'en'), '/#flavors');
  assert.equal(langTarget('zh', { pathname: '/en/404.html' }, 'en'), '/404.html');
  assert.equal(langTarget('en', { pathname: '/', search: '?a=1' }, 'zh'), '/en/?a=1');
  assert.equal(langTarget('zh', { pathname: '/' }, 'zh'), '');
  assert.equal(langTarget('', { pathname: '/' }, 'zh'), '');
});

test('页面接线：baseof 先原样内联共享读端，再内联 ui-inherit-run.js（都在样式前）；外观只走 SgxUI.apply，不再自己解析 cookie', () => {
  const base = read('web/layouts/_default/baseof.html');
  const iReader = base.indexOf('resources.Get "js/sgx/shell/ui-cookie-read.js" | minify');
  const iRun = base.indexOf('resources.Get "js/sgx/ui-inherit-run.js"');
  assert.ok(iReader > 0 && iReader < iRun && iRun < base.indexOf('css/main.css'));
  const run = read('web/assets/js/sgx/ui-inherit-run.js');
  assert.match(run, /U\.apply\(document\.documentElement, \{ onMiss: loadEngine \}\)/);
  const lib = read('web/assets/js/sgx/lib/ui-inherit.js');
  for (const [f, src] of [['ui-inherit-run.js', run], ['ui-inherit.js', lib], ['shell-accent.js', read('web/assets/js/sgx/shell-accent.js')]]) {
    assert.doesNotMatch(src, /atob|data-sgx-seed|'lake'|ui\.theme/, f);
  }
  assert.match(read('web/assets/js/sgx/shell-accent.js'), /U\.setRoles\(seed, rolesCss\(seed\)\)/);
});
