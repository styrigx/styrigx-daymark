// 顶栏右胶囊的分享按钮（共享外壳 share.js，2026-10-24）：
// - 站长（<html data-sgx-role="owner">，线上由网关注入；这里测试里补上）：POST https://styrigx.com/api/share（跨源带 cookie）
//   { action:'create', reuse:true, name:页面标题, to:当前页（去 lock / why / return / share）, hours:24, session:43200 } → navigator.share 短链；
//   系统分享被拒 / 没有 → 复制 + toast「已复制分享链接」；用户取消不复制；生成中再点不理；接口失败只 toast，不分享原地址。
// - 访客：不调接口，直接分享当前页地址；同样的复制兜底。
// - 360 / 412 宽：胶囊放得下，长条不溢出，页面不横向滚动。
import { test, expect } from '@playwright/test';

const CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const SHORT = 'https://styrigx.com/s/' + CODE;
const PAGE = '/guestbook/';
const HOMES = ['/', '/en/'];

test.use({ viewport: { width: 412, height: 915 } });

/** share: 'ok' | 'none' | 'NotAllowedError' | 'AbortError' */
async function setup(page, { share = 'ok', api } = {}) {
  await page.addInitScript((mode) => {
    window.__shareLog = [];
    if (mode === 'none') Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    else {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d) => {
          window.__shareLog.push(['share', { title: d.title, url: d.url }]);
          if (mode !== 'ok') { const e = new Error('x'); e.name = mode; throw e; }
        },
      });
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t) => { window.__shareLog.push(['copy', t]); } },
    });
  }, share);
  const calls = [];
  await page.route('https://styrigx.com/api/share', async (route) => {
    const req = route.request();
    const origin = req.headers()['origin'] || '*';
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST', Vary: 'Origin' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    calls.push({ body: JSON.parse(req.postData() || '{}'), type: req.headers()['content-type'] });
    const r = api ? await api(calls.length) : [200, { ok: true, reused: false, link: { path: '/s/' + CODE } }];
    return route.fulfill({ status: r[0], headers: cors, contentType: 'application/json', body: JSON.stringify(r[1]) });
  });
  return calls;
}

async function go(page, path, role) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  if (role) await page.evaluate((r) => document.documentElement.setAttribute('data-sgx-role', r), role);
  await expect(page.locator('[data-sgx-share]')).toBeVisible();
}
const log = (page) => page.evaluate(() => window.__shareLog);

test.describe('顶栏分享按钮', () => {
  test('站长：生成带临时会话的短链（reuse、24 小时 / 12 小时、标题当名字、当前页去掉 lock/return）→ 系统分享短链', async ({ page }) => {
    const calls = await setup(page);
    await go(page, PAGE + '?lock=1&return=%2F&keep=1', 'owner');
    const url = await page.evaluate(() => location.origin + location.pathname + '?keep=1');
    const title = await page.title();
    await page.locator('[data-sgx-share]').click();
    await expect.poll(() => log(page)).toEqual([['share', { title, url: SHORT }]]);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toContain('application/json');
    expect(calls[0].body).toEqual({ action: 'create', reuse: true, name: Array.from(title.trim()).slice(0, 24).join(''), to: url, hours: 24, session: 43200 });
  });

  test('站长：生成中按钮 aria-busy、再点不理（只发一次请求）；完了恢复', async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const calls = await setup(page, { api: async () => { await gate; return [200, { ok: true, reused: true, link: { path: '/s/' + CODE } }]; } });
    await go(page, PAGE, 'owner');
    const btn = page.locator('[data-sgx-share]');
    await btn.click();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
    await expect(btn).toHaveClass(/\bis-busy\b/);
    await btn.click();
    await btn.click();
    release();
    await expect(btn).not.toHaveAttribute('aria-busy', 'true');
    await expect.poll(() => log(page)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test('站长：系统分享被拒（NotAllowedError）→ 复制短链 + toast「已复制分享链接」', async ({ page }) => {
    await setup(page, { share: 'NotAllowedError' });
    await go(page, PAGE, 'owner');
    await page.locator('[data-sgx-share]').click();
    await expect(page.locator('.sgx-share-toast')).toHaveText('已复制分享链接');
    await expect(page.locator('.sgx-share-toast')).toHaveClass(/\bshow\b/);
    expect((await log(page)).map((x) => x[0])).toEqual(['share', 'copy']);
    expect((await log(page))[1][1]).toBe(SHORT);
  });

  test('站长：没有 Web Share → 直接复制短链 + toast；用户取消（AbortError）→ 不复制不提示', async ({ page }) => {
    await setup(page, { share: 'none' });
    await go(page, PAGE, 'owner');
    await page.locator('[data-sgx-share]').click();
    await expect(page.locator('.sgx-share-toast')).toHaveText('已复制分享链接');
    expect(await log(page)).toEqual([['copy', SHORT]]);
  });

  test('站长：用户取消系统分享 → 不复制、不 toast', async ({ page }) => {
    await setup(page, { share: 'AbortError' });
    await go(page, PAGE, 'owner');
    await page.locator('[data-sgx-share]').click();
    await expect.poll(() => log(page)).toEqual([['share', { title: await page.title(), url: SHORT }]]);
    await page.waitForTimeout(300);
    await expect(page.locator('.sgx-share-toast')).toHaveCount(0);
  });

  test('站长：接口 401 → toast 提示重新登录，不分享也不复制原地址', async ({ page }) => {
    await setup(page, { api: async () => [401, { ok: false }] });
    await go(page, PAGE, 'owner');
    await page.locator('[data-sgx-share]').click();
    await expect(page.locator('.sgx-share-toast')).toContainText('重新登录');
    expect(await log(page)).toEqual([]);
    await expect(page.locator('[data-sgx-share]')).not.toHaveAttribute('aria-busy', 'true');
  });

  test('访客：不调接口，系统分享当前页地址（去掉 lock）；没有 Web Share → 复制 + toast', async ({ page }) => {
    const calls = await setup(page);
    await go(page, PAGE + '?lock=1', 'visitor');
    const url = await page.evaluate(() => location.origin + location.pathname);
    await page.locator('[data-sgx-share]').click();
    await expect.poll(() => log(page)).toEqual([['share', { title: await page.title(), url }]]);
    expect(calls).toHaveLength(0);
  });

  test('访客（没有 Web Share）：复制当前页地址 + toast；没有角色也当访客', async ({ page }) => {
    const calls = await setup(page, { share: 'none' });
    await go(page, PAGE, null);
    const url = await page.evaluate(() => location.origin + location.pathname);
    await page.locator('[data-sgx-share]').click();
    await expect(page.locator('.sgx-share-toast')).toHaveText('已复制分享链接');
    expect(await log(page)).toEqual([['copy', url]]);
    expect(calls).toHaveLength(0);
  });

  for (const w of [360, 412]) {
    test(`${w} 宽：右胶囊 86×52 贴右边，长条在两者之间不溢出，页面不横向滚动（站长 / 访客一样）`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 });
      for (const [home, role] of HOMES.flatMap((h) => [[h, 'owner'], [h, 'visitor']])) {
        await go(page, home, role);
        const r = await page.evaluate(() => {
          const b = (s) => document.querySelector(s).getBoundingClientRect();
          const bar = b('.sgx-topbar'), nav = b('.sgx-tb-nav'), pill = b('.sgx-tb-pill'), grp = b('.sgx-tb-end-group');
          const pillEl = document.querySelector('.sgx-tb-pill');
          const clipped = [...pillEl.querySelectorAll('button, .sgx-tb-title')].some((e) => e.scrollWidth > e.clientWidth + 1);
          return { grp: [Math.round(grp.width), Math.round(grp.height)], right: Math.round(bar.right - grp.right), gaps: [Math.round(pill.left - nav.right), Math.round(grp.left - pill.right)],
            pillW: Math.round(pill.width), clipped, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
        });
        expect(r.grp).toEqual([86, 52]);
        expect(r.right).toBe(0);
        expect(r.gaps).toEqual([8, 8]);
        expect(r.pillW).toBe(w - 32 - 52 - 86 - 16);
        expect(r.clipped, home + ' 长条里的字没被截断').toBe(false);
        expect(r.overflow).toBe(false);
      }
    });
  }
});
