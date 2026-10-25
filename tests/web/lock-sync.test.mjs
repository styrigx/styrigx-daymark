// 锁屏同步测试（#8 恢复 + #5 权限规则）
// 覆盖：web/assets/js/sgx-lock-sync.js — 401 处理规则（isLockSignal / checkSession / apiFetch），
//      网络错误不 reload（fail open）
// 服务端（/api/lock-session-check、页面 no-store、302 锁屏）在主站鉴权网关，测试在 styrigx-space 仓库；
// 接口鉴权见 tests/workers/worker.test.mjs。
// 运行：node tests/web/lock-sync.test.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

/* web/assets/js/sgx-lock-sync.js 是浏览器 IIFE（module.exports 分支只在 CJS 下生效）。
   package.json 为 "type": "module"，createRequire 会把它当 ESM 加载导致导出丢失，
   这里用 vm 在 CJS 沙箱里执行，保证测到的是 #8 的真实导出。 */
const sgxSrc = readFileSync(new URL('../../web/assets/js/sgx-lock-sync.js', import.meta.url), 'utf8');
const sgxSandbox = { module: { exports: {} }, console };
vm.createContext(sgxSandbox);
vm.runInContext(sgxSrc, sgxSandbox);
const sgx = sgxSandbox.module.exports;

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

/* ---------- 3. 前端 sgx-lock-sync.js：401 处理 ---------- */
console.log('sgx-lock-sync isLockSignal:');
await test('数据接口 401 → 视为已锁定', () => {
  assert.equal(sgx.isLockSignal('/api/quotes', 401), true);
  assert.equal(sgx.isLockSignal('/api/lock-session-check', 401), true);
  assert.equal(sgx.isLockSignal('https://daymark.styrigx.com/api/quotes', 401), true);
});
await test('非 401 状态 → 不 reload', () => {
  assert.equal(sgx.isLockSignal('/api/quotes', 200), false);
  assert.equal(sgx.isLockSignal('/api/quotes', 403), false);
  assert.equal(sgx.isLockSignal('/api/quotes', 500), false);
});

console.log('sgx-lock-sync checkSession:');
await test('401 → reload（返回 true）', async () => {
  let reloaded = 0;
  const wasLocked = await sgx.checkSession(async () => ({ status: 401 }), () => { reloaded++; });
  assert.equal(wasLocked, true);
  assert.equal(reloaded, 1);
});
await test('问的是主站网关的 /api/lock-session-check（同源、不走缓存）', async () => {
  assert.equal(sgx.CHECK_URL, '/api/lock-session-check');
  let seen;
  await sgx.checkSession(async (url, opts) => { seen = { url, opts }; return { status: 200 }; }, () => {});
  assert.equal(seen.url, '/api/lock-session-check');
  assert.equal(seen.opts.credentials, 'same-origin');
  assert.equal(seen.opts.cache, 'no-store');
});
await test('200 → 不 reload', async () => {
  let reloaded = 0;
  const wasLocked = await sgx.checkSession(async () => ({ status: 200 }), () => { reloaded++; });
  assert.equal(wasLocked, false);
  assert.equal(reloaded, 0);
});
await test('网络错误 → fail open，不 reload', async () => {
  let reloaded = 0;
  const wasLocked = await sgx.checkSession(async () => { throw new TypeError('fetch failed'); }, () => { reloaded++; });
  assert.equal(wasLocked, false);
  assert.equal(reloaded, 0);
});
await test('并发调用去重：一次 401 只 reload 一次', async () => {
  let reloaded = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const p1 = sgx.checkSession(() => gate.then(() => ({ status: 401 })), () => { reloaded++; });
  const p2 = sgx.checkSession(() => gate.then(() => ({ status: 401 })), () => { reloaded++; });
  release();
  await Promise.all([p1, p2]);
  assert.equal(reloaded, 1);
});

console.log('sgx-lock-sync apiFetch:');
await test('数据接口 401 → reload + 抛 sgxLocked（调用方直接 return，不展示错误 UI）', async () => {
  let reloaded = 0;
  await assert.rejects(
    sgx.apiFetch('/api/quotes', {}, async () => ({ status: 401 }), () => { reloaded++; }),
    (e) => e.sgxLocked === true
  );
  assert.equal(reloaded, 1);
});
await test('200 → 透传响应', async () => {
  const res = await sgx.apiFetch('/api/quotes', {}, async () => ({ status: 200 }));
  assert.equal(res.status, 200);
});
await test('网络错误 → 透出异常，不 reload', async () => {
  let reloaded = 0;
  await assert.rejects(
    sgx.apiFetch('/api/quotes', {}, async () => { throw new TypeError('fetch failed'); }, () => { reloaded++; }),
    (e) => e instanceof TypeError && !e.sgxLocked
  );
  assert.equal(reloaded, 0);
});

console.log(`\n${passed} passed`);
