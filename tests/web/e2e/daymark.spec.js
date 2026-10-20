// 日刻首页（手机）：接口用 page.route 假数据，不碰线上。
// - 访客：看到今日一句和公开句子，没有「记一句」
// - 主人：「记一句」打开弹层，填写保存后新句子出现在列表最上面；点句子能编辑
// - 标签筛选、搜索胶囊过滤
const { test, expect } = require('@playwright/test');

const QUOTES = [
  { id: 'aaaaaaaaaaa1', text: '世上本没有路，走的人多了，也便成了路。', trans: '', author: '鲁迅', source: '故乡', tags: ['人生'], visibility: 'public', created_at: 2, updated_at: 2 },
  { id: 'aaaaaaaaaaa2', text: 'Stay hungry, stay foolish.', trans: '求知若饥，虚心若愚。', author: 'Steve Jobs', source: '', tags: ['English'], visibility: 'private', created_at: 1, updated_at: 1 },
];

async function mock(page, owner) {
  const list = owner ? QUOTES.slice() : QUOTES.filter((q) => q.visibility === 'public');
  await page.route('**/api/session-check', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/today**', (r) => r.fulfill({ json: { ok: true, day: '2026-10-20', quote: QUOTES[0] } }));
  await page.route('**/api/quotes**', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: { ok: true, owner, quotes: list } });
    const body = req.postDataJSON();
    if (req.method() === 'POST') {
      const q = { id: 'bbbbbbbbbbb1', trans: '', author: '', source: '', tags: [], visibility: 'public', created_at: 3, updated_at: 3, ...body };
      return r.fulfill({ status: 201, json: { ok: true, quote: q } });
    }
    if (req.method() === 'PUT') return r.fulfill({ json: { ok: true, quote: { ...QUOTES[0], ...body } } });
    return r.fulfill({ json: { ok: true } });
  });
}

test('访客：今日一句 + 公开句子，没有记一句', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('#dm-today-day')).toHaveText('10月20日 星期二');
  await expect(page.locator('#dm-today-body')).toContainText('— 鲁迅《故乡》');
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(1);
  await expect(page.locator('#dm-add')).toBeHidden();
});

test('主人：记一句 → 保存后出现在最上面；点句子进入编辑', async ({ page }) => {
  await mock(page, true);
  await page.goto('/');
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(2);
  await expect(page.locator('.dm-priv')).toHaveCount(1);
  await page.locator('#dm-add').click();
  await expect(page.locator('#edit-wrap')).toHaveClass(/open/);
  await expect(page.locator('#edit-title')).toHaveText('记一句');
  await page.locator('#edit-save').click();
  await expect(page.locator('#edit-err')).toBeVisible();
  await page.locator('#f-text').fill('今天也要好好吃饭。');
  await page.locator('#f-tags').fill('生活, #日常');
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/quotes') && r.method() === 'POST'),
    page.locator('#edit-save').click(),
  ]);
  expect(req.postDataJSON().tags).toEqual(['生活', '日常']);
  await expect(page.locator('#edit-wrap')).not.toHaveClass(/open/);
  await expect(page.locator('#dm-list .dm-card').first()).toContainText('今天也要好好吃饭。');
  await page.locator('#dm-list .dm-card').nth(1).click();
  await expect(page.locator('#edit-title')).toHaveText('编辑这一句');
  await expect(page.locator('#f-text')).toHaveValue(QUOTES[0].text);
  await expect(page.locator('#edit-del')).toBeVisible();
  await page.screenshot({ path: 'test-results/daymark-edit.png' });
});

test('标签筛选 + 搜索', async ({ page }) => {
  await mock(page, true);
  await page.goto('/');
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/daymark-home.png', fullPage: true });
  await page.locator('#dm-tags [data-tag="English"]').click();
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(1);
  await page.locator('#dm-tags [data-tag=""]').click();
  await page.evaluate(() => window.__bkCapSearchProvider('鲁迅'));
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(1);
  await page.evaluate(() => window.__bkCapSearchProvider('没有这句'));
  await expect(page.locator('#dm-no-results')).toBeVisible();
});
