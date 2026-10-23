// 日刻首页（手机）：接口用 page.route 假数据，不碰线上。
// - 顶栏：九宫格 · 余响/拾录/百味 分段滑块 · 留言板圆；没有搜索栏、快捷面板、页脚；抽屉只有四个应用（主站 / 奇趣（书签+星）/ 日刻 / 博客）
// - 留言板 /guestbook/：长条只有页名，卡片里是共用的 Giscus 讨论串（giscus.app 用 page.route 拦掉）
// - 页签：默认余响，#trove / #flavors 直达，点页签改 hash；英文页 Echo / Trove / Flavors
// - 余响：今日一句；再抽一句 → 回到今日；长按复制
// - 拾录：全部句子新的在前；访客没有「记一句」；主人有，私密句子带锁
// - 百味：自建专题在前（主人有「＋ 新建」），再是人物（每位作者一组）；点进分组、页内返回；主人上移 / 移出
// - 记一句：预览、加译文、作者补全 + 最近作者、出处类型 + 名字补全、归入百味（含就地新建）、标签块、随手一笔、公开；
//   保存 → 已拾录；编辑时删除要确认
const { test, expect } = require('@playwright/test');

const QUOTES = [
  { id: 'aaaaaaaaaaa1', text: '世上本没有路，走的人多了，也便成了路。', trans: '', author: '鲁迅', source: '故乡', source_type: 'book', tags: ['人生'], visibility: 'public', created_at: 4, updated_at: 4 },
  { id: 'aaaaaaaaaaa2', text: 'Stay hungry, stay foolish.', trans: '求知若饥，虚心若愚。', author: 'Steve Jobs', source: '', source_type: '', tags: ['English'], visibility: 'private', created_at: 3, updated_at: 3 },
  { id: 'aaaaaaaaaaa3', text: '人生如逆旅，我亦是行人。', trans: '', author: '苏轼', source: '临江仙', source_type: 'poetry', tags: ['人生'], visibility: 'public', created_at: 2, updated_at: 2 },
  { id: 'aaaaaaaaaaa4', text: '回首向来萧瑟处，也无风雨也无晴。', trans: '', author: '苏轼', source: '定风波', source_type: 'poetry', tags: [], visibility: 'public', created_at: 1, updated_at: 1 },
];
const COLS = [{ id: 'cccccccccc01', name: '晨读', intro: '早上读一遍', created_at: 1, sort: 0, quote_ids: ['aaaaaaaaaaa3', 'aaaaaaaaaaa1', 'aaaaaaaaaaa2'] }];

async function mock(page, owner) {
  const list = owner
    ? QUOTES.map((q) => ({ ...q, note: '', collections: COLS[0].quote_ids.includes(q.id) ? ['cccccccccc01'] : [] }))
    : QUOTES.filter((q) => q.visibility === 'public');
  let cols = owner ? COLS.map((c) => ({ ...c, quote_ids: c.quote_ids.slice() })) : COLS.map((c) => ({ ...c, quote_ids: c.quote_ids.filter((id) => list.some((q) => q.id === id)) }));
  const calls = [];
  await page.route('**/avatar/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' }));
  await page.route('**/api/session-check', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/today**', (r) => r.fulfill({ json: { ok: true, day: '2026-10-20', quote: { ...QUOTES[0] } } }));
  await page.route('**/api/collections**', async (r) => {
    const req = r.request();
    calls.push({ method: req.method(), url: req.url(), body: req.postDataJSON ? req.postDataJSON() : null });
    if (req.method() === 'GET') return r.fulfill({ json: { ok: true, owner, collections: cols } });
    if (req.method() === 'POST') {
      const c = { id: 'cccccccccc09', name: req.postDataJSON().name, intro: req.postDataJSON().intro || '', created_at: 9, sort: 9, quote_ids: [] };
      cols = cols.concat(c);
      return r.fulfill({ status: 201, json: { ok: true, collection: c } });
    }
    if (req.method() === 'PUT') {
      const id = new URL(req.url()).searchParams.get('id');
      cols = cols.map((c) => (c.id === id ? { ...c, ...req.postDataJSON() } : c));
      return r.fulfill({ json: { ok: true, collection: cols.find((c) => c.id === id) } });
    }
    return r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/quotes**', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: { ok: true, owner, quotes: list } });
    const body = req.postDataJSON();
    calls.push({ method: req.method(), url: req.url(), body });
    if (req.method() === 'POST') {
      const q = { id: 'bbbbbbbbbbb1', trans: '', author: '', source: '', source_type: '', tags: [], visibility: 'public', note: '', collections: [], created_at: 9, updated_at: 9, ...body };
      return r.fulfill({ status: 201, json: { ok: true, quote: q } });
    }
    if (req.method() === 'PUT') return r.fulfill({ json: { ok: true, quote: { ...list[0], ...body } } });
    return r.fulfill({ json: { ok: true } });
  });
  return calls;
}

test('访客：顶栏三页签、没有搜索栏和快捷面板（搜索层平时藏着）；抽屉同主站（四个应用 + 设置）；余响今日一句', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('[data-dm-tab]')).toHaveText(['余响', '拾录', '百味']);
  await expect(page.locator('#dm-tab-echo')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#bk-cap, #sgx-qp, .sgx-tb-search, .sgx-tb-quick, input[type="search"]:visible, [role="search"]:visible')).toHaveCount(0);
  await expect(page.locator('#dm-echo-day')).toHaveText('10月20日 星期二');
  await expect(page.locator('#dm-echo-body')).toContainText('鲁迅 · 《故乡》');
  await expect(page.locator('#dm-share')).toBeVisible();
  /* 右圆 = 留言板（本站 /guestbook/）；没有顶栏头像、没有版权页脚 */
  await expect(page.locator('.sgx-topbar > *')).toHaveCount(3);
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('href', '/guestbook/');
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('aria-label', '留言板');
  await expect(page.locator('.sgx-tb-me, footer')).toHaveCount(0);
  await expect(page.getByText('Powered by')).toHaveCount(0);
  await page.locator('.sgx-tb-nav').click();
  await expect(page.locator('#sgx-drawer .sgx-drawer-item')).toHaveText(['主站', '奇趣', '日刻', '博客']);
  await expect(page.locator('#sgx-drawer [data-nav="home"]')).toHaveAttribute('href', 'https://styrigx.com/');
  /* 奇趣图标 = 书签 + 星（同主站 #180） */
  await expect(page.locator('#sgx-drawer [data-nav="curio"] path').first()).toHaveAttribute('d', /^M6 4\.5A1\.5/);
  await expect(page.locator('#sgx-drawer [data-nav="daymark"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#sgx-drawer [data-nav="daymark"]')).toHaveAttribute('href', '/');
  /* 同主站：头部头像去主站账号页，导航项下一条分隔线，底栏搜索框原地开搜索层（href 只是没 JS 时的退路） */
  await expect(page.locator('#sgx-drawer .sgx-drawer-me')).toHaveAttribute('href', 'https://styrigx.com/account/');
  await expect(page.locator('#sgx-drawer hr.sgx-drawer-sep')).toHaveCount(1);
  await expect(page.locator('#sgx-drawer .sgx-drawer-search')).toHaveAttribute('href', 'https://styrigx.com/search/');
  /* 主站同款：毛玻璃面板、tonal 当前项、宽度 = 412 − 16 − 78 − 8 − 20 = 290（视口 412 时） */
  const st = await page.evaluate(() => {
    const probe = (v) => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; };
    const cur = getComputedStyle(document.querySelector('#sgx-drawer [aria-current="page"]'));
    const sh = document.querySelector('.sgx-drawer-sheet');
    return { bg: cur.backgroundColor, tonal: probe('--sgx-nav-selected'), filter: getComputedStyle(sh).backdropFilter, w: sh.getBoundingClientRect().width, vw: innerWidth };
  });
  expect(st.bg).toBe(st.tonal);
  expect(st.filter).toContain('blur(24px)');
  expect(Math.round(st.w)).toBe(Math.round(st.vw - 16 - 78 - 8 - 20));
});

test('抽屉底栏搜索：原地打开搜索层（不跳站、不刷新），底栏带星图标、自动聚焦，结果走本站 /api/search；返回只关搜索层', async ({ page }) => {
  await mock(page, false);
  const asked = [];
  await page.route('**/api/search**', (r) => {
    asked.push(new URL(r.request().url()).host);
    return r.fulfill({ json: { hits: [{ title: 'GitHub', subtitle: '开发与云', url: '/#trove', type: 'quote' }] } });
  });
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  await page.evaluate(() => { window.__noReload = 1; });
  const histLen = await page.evaluate(() => history.length);
  await page.locator('.sgx-tb-nav').click();
  await page.locator('#sgx-drawer .sgx-drawer-search').click();
  await expect(page.locator('.sgx-srch-bar')).toBeVisible();
  await expect(page.locator('#sgx-srch-input')).toBeFocused();
  await expect(page.locator('#sgx-drawer')).not.toHaveAttribute('open', '');
  expect(new URL(page.url()).origin).toBe(origin);
  expect(await page.evaluate(() => window.__noReload)).toBe(1);
  /* 底栏和空白页的放大镜 = 抽屉同款带星图标 */
  await expect(page.locator('.sgx-srch-bar .sgx-srch-ic path').first()).toHaveAttribute('d', /^M14\.9 9\.6/);
  await expect(page.locator('.sgx-srch-empty .sgx-srch-empty-ic path').first()).toHaveAttribute('d', /^M14\.9 9\.6/);
  await page.locator('#sgx-srch-input').fill('git');
  await expect(page.locator('#sgx-srch-list [data-srch-u]').first()).toContainText('GitHub');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((h) => h === new URL(origin).host)).toBe(true);
  /* 抽屉的历史哨兵让给搜索层：只多一条；系统返回只关搜索层，停在本页 */
  expect(await page.evaluate(() => history.length)).toBe(histLen + 1);
  await page.goBack();
  await expect(page.locator('.sgx-srch-bar')).toBeHidden();
  expect(new URL(page.url()).origin).toBe(origin);
  expect(await page.evaluate(() => window.__noReload)).toBe(1);
});

test('页签：点了改 hash，#trove / #flavors 直达；英文页 Echo / Trove / Flavors', async ({ page }) => {
  await mock(page, false);
  await page.goto('/');
  await page.locator('#dm-tab-trove').click();
  await expect(page).toHaveURL(/#trove$/);
  await expect(page.locator('#dm-pane-trove')).toBeVisible();
  await expect(page.locator('#dm-pane-echo')).toBeHidden();
  await page.locator('#dm-tab-flavors').click();
  await expect(page).toHaveURL(/#flavors$/);
  await page.locator('#dm-tab-echo').click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/#flavors');
  await expect(page.locator('#dm-tab-flavors')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#dm-pane-flavors')).toBeVisible();
  await page.goto('/en/#trove');
  await expect(page.locator('[data-dm-tab]')).toHaveText(['Echo', 'Trove', 'Flavors']);
  await expect(page.locator('#dm-tab-trove')).toHaveAttribute('aria-selected', 'true');
});

test('余响：再抽一句 → 出现回到今日；回到今日恢复今日一句；长按复制', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mock(page, false);
  await page.goto('/');
  await expect(page.locator('#dm-echo-body')).toContainText('世上本没有路');
  await expect(page.locator('#dm-back-today')).toBeHidden();
  await page.locator('#dm-draw').click();
  await expect(page.locator('#dm-back-today')).toBeVisible();
  await expect(page.locator('#dm-echo-body')).not.toContainText('世上本没有路');
  await expect(page.locator('#dm-echo-day')).toContainText('拾于');
  await page.locator('#dm-back-today').click();
  await expect(page.locator('#dm-echo-body')).toContainText('世上本没有路');
  await expect(page.locator('#dm-back-today')).toBeHidden();
  const box = await page.locator('#dm-echo .dm-text').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.locator('#bk-toast')).toHaveText('已复制');
});

test('拾录 · 访客：只有公开句子、没有记一句和锁', async ({ page }) => {
  await mock(page, false);
  await page.goto('/#trove');
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(3);
  await expect(page.locator('#dm-fab')).toBeHidden();
  await expect(page.locator('.dm-lock')).toHaveCount(0);
});

test('拾录 · 主人：新的在前、私密带锁、右下角记一句；点句子进入编辑，删除要确认', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/#trove');
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(4);
  await expect(page.locator('#dm-list .dm-card').first()).toContainText('世上本没有路');
  await expect(page.locator('#dm-list .dm-lock')).toHaveCount(1);
  await expect(page.locator('#dm-fab')).toBeVisible();
  await page.locator('#dm-tab-echo').click();
  await expect(page.locator('#dm-fab')).toBeHidden();
  await page.locator('#dm-tab-trove').click();
  await page.locator('#dm-list .dm-card').first().click();
  await expect(page.locator('#edit-title')).toHaveText('编辑这一句');
  await expect(page.locator('#f-text')).toHaveValue(QUOTES[0].text);
  await expect(page.locator('#f-stype [data-st="book"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#f-cols [data-col="cccccccccc01"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#f-tagchips .dm-tagchip')).toHaveText(['#人生×']);
  await page.locator('#edit-del').click();
  await expect(page.locator('#confirm-wrap')).toHaveClass(/open/);
  await page.locator('#confirm-cancel').click();
  await expect(page.locator('#edit-wrap')).toHaveClass(/open/);
  await page.locator('#edit-del').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('#edit-wrap')).not.toHaveClass(/open/);
  await expect(page.locator('#dm-list .dm-card')).toHaveCount(3);
  expect(calls.some((c) => c.method === 'DELETE' && c.url.includes('id=aaaaaaaaaaa1'))).toBe(true);
});

test('记一句：预览、加译文、作者补全 + 最近作者、出处类型、归入百味（含新建）、标签块、随手一笔 → 已拾录', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/#trove');
  await page.locator('#dm-fab').click();
  await expect(page.locator('#edit-wrap')).toHaveClass(/open/);
  await expect(page.locator('#edit-title')).toHaveText('记一句');
  await expect(page.locator('#edit-del')).toBeHidden();
  await page.locator('#edit-save').click();
  await expect(page.locator('#edit-err')).toBeVisible();

  await page.locator('#f-text').fill('人生如逆旅，我亦是行人。');
  await expect(page.locator('#ed-preview .dm-text')).toHaveText('人生如逆旅，我亦是行人。');
  await expect(page.locator('#f-trans-wrap')).toBeHidden();
  await page.locator('#f-trans-toggle').click();
  await page.locator('#f-trans').fill('Life is a journey.');
  await expect(page.locator('#ed-preview .dm-trans')).toHaveText('Life is a journey.');

  await expect(page.locator('#f-author-recent [data-author]').first()).toHaveText('鲁迅');
  await page.locator('#f-author').fill('苏');
  await expect(page.locator('#f-author-ac .dm-ac-item')).toHaveText(['苏轼']);
  await page.locator('#f-author-ac .dm-ac-item').click();
  await expect(page.locator('#f-author')).toHaveValue('苏轼');

  await page.locator('#f-stype [data-st="poetry"]').click();
  await expect(page.locator('#f-stype [data-st="poetry"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#f-source').fill('临');
  await expect(page.locator('#f-source-ac .dm-ac-item')).toHaveText(['临江仙']);
  await page.locator('#f-source-ac .dm-ac-item').click();
  await expect(page.locator('#ed-preview .dm-attr')).toHaveText('苏轼 · 《临江仙》');

  await page.locator('#f-cols [data-col="cccccccccc01"]').click();
  await page.locator('#f-col-new').click();
  await page.locator('#f-col-name').fill('夜读');
  await page.locator('#f-col-add').click();
  await expect(page.locator('#f-cols [data-col="cccccccccc09"]')).toHaveAttribute('aria-pressed', 'true');
  expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/api/collections') && c.body.name === '夜读')).toBe(true);

  await page.locator('#f-tag-input').fill('旅行');
  await page.locator('#f-tag-input').press('Enter');
  await page.locator('#f-tag-input').fill('#宋词,');
  await expect(page.locator('#f-tagchips .dm-tagchip')).toHaveCount(2);
  await page.locator('#f-tag-sugg [data-addtag="人生"]').click();
  await expect(page.locator('#f-tagchips .dm-tagchip')).toHaveCount(3);
  await page.locator('#f-tagchips [data-untag="1"]').click();
  await expect(page.locator('#f-tagchips .dm-tagchip')).toHaveCount(2);

  await page.locator('#f-note').fill('在旧书店读到');
  await page.locator('#f-public').evaluate((el) => { el.checked = false; });
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith('/api/quotes') && r.method() === 'POST'),
    page.locator('#edit-save').click(),
  ]);
  const b = req.postDataJSON();
  expect(b).toMatchObject({ text: '人生如逆旅，我亦是行人。', trans: 'Life is a journey.', author: '苏轼', source: '临江仙', source_type: 'poetry', note: '在旧书店读到', visibility: 'private' });
  expect(b.tags).toEqual(['旅行', '人生']);
  expect(b.collections).toEqual(['cccccccccc01', 'cccccccccc09']);
  await expect(page.locator('#bk-toast')).toHaveText('已拾录');
  await expect(page.locator('#edit-wrap')).not.toHaveClass(/open/);
  await expect(page.locator('#dm-list .dm-card').first()).toContainText('人生如逆旅');
});

test('百味 · 主人：专题在前带新建、人物每位作者一组；进分组页内返回；上移和移出走 PUT', async ({ page }) => {
  const calls = await mock(page, true);
  await page.goto('/#flavors');
  await expect(page.locator('#dm-cols .dm-fcard')).toHaveCount(2);
  await expect(page.locator('#dm-cols .dm-fcard').first()).toContainText('晨读');
  await expect(page.locator('#dm-cols .dm-fcard').first()).toContainText('3 句');
  await expect(page.locator('#dm-col-new')).toBeVisible();
  await expect(page.locator('#dm-authors .dm-fcard')).toHaveCount(3);
  await expect(page.locator('#dm-authors .dm-fcard').first()).toContainText('苏轼');
  await expect(page.locator('#dm-authors .dm-fcard').first()).toContainText('2 句');
  await expect(page.locator('#dm-pane-flavors')).not.toContainText('出处');
  await expect(page.locator('#dm-pane-flavors')).not.toContainText('标签');

  await page.locator('#dm-cols [data-key="cccccccccc01"]').click();
  await expect(page).toHaveURL(/#flavors\/c\/cccccccccc01$/);
  await expect(page.locator('#dm-g-title')).toHaveText('晨读');
  await expect(page.locator('#dm-g-list .dm-card')).toHaveCount(3);
  await expect(page.locator('#dm-g-list .dm-card').first()).toContainText('人生如逆旅');
  await page.locator('#dm-g-edit').click();
  await page.locator('#dm-g-list [data-move="-1"][data-i="1"]').click();
  await expect(page.locator('#dm-g-list .dm-card').first()).toContainText('世上本没有路');
  let put = calls.filter((c) => c.method === 'PUT' && c.url.includes('/api/collections')).pop();
  expect(put.body.quote_ids).toEqual(['aaaaaaaaaaa1', 'aaaaaaaaaaa3', 'aaaaaaaaaaa2']);
  await page.locator('#dm-g-list [data-remove="2"]').click();
  await expect(page.locator('#dm-g-list .dm-card')).toHaveCount(2);
  put = calls.filter((c) => c.method === 'PUT' && c.url.includes('/api/collections')).pop();
  expect(put.body.quote_ids).toEqual(['aaaaaaaaaaa1', 'aaaaaaaaaaa3']);
  await page.locator('#dm-fl-back').click();
  await expect(page).toHaveURL(/#flavors$/);
  await expect(page.locator('#dm-fl-home')).toBeVisible();

  await page.locator('#dm-authors [data-key="苏轼"]').click();
  await expect(page.locator('#dm-g-title')).toHaveText('苏轼');
  await expect(page.locator('#dm-g-list .dm-card')).toHaveCount(2);
  await expect(page.locator('#dm-g-tools')).toBeHidden();

  await page.locator('#dm-fl-back').click();
  await page.locator('#dm-col-new').click();
  await page.locator('#c-name').fill('电影台词');
  await page.locator('#c-intro').fill('看片时记下的');
  await page.locator('#col-save').click();
  await expect(page.locator('#dm-g-title')).toHaveText('电影台词');
  await expect(page.locator('#dm-g-intro')).toHaveText('看片时记下的');
});

test('百味 · 访客：没有新建；专题里只显示看得到的句子', async ({ page }) => {
  await mock(page, false);
  await page.goto('/#flavors/c/cccccccccc01');
  await expect(page.locator('#dm-g-title')).toHaveText('晨读');
  await expect(page.locator('#dm-g-list .dm-card')).toHaveCount(2);
  await expect(page.locator('#dm-g-tools')).toBeHidden();
  await page.locator('#dm-fl-back').click();
  await expect(page.locator('#dm-col-new')).toHaveCount(0);
});

test('主题跟主站 sgx-ui cookie：pal 换预设；accent 是自定义种子 → 按需加载共享外壳引擎算整套角色，第二次首帧直接用缓存', async ({ page, context, baseURL }) => {
  await mock(page, false);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const set = (ui) => context.addCookies([{ name: 'sgx-ui', value: enc(ui), url: baseURL }]);
  const ind = () => page.evaluate(() => getComputedStyle(document.querySelector('.sgx-seg-ind')).backgroundColor);
  await page.goto('/');
  const lake = await ind();
  const matchaSeed = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', '..', 'web/assets/sgx-shell/palettes.json'), 'utf8')).presets.find((p) => p.id === 'matcha').seed;
  await set({ v: 2, mode: 'dark', pal: 'matcha', accent: matchaSeed });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'matcha');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('#sgx-accent-roles')).toHaveCount(0);
  expect(await ind()).not.toBe(lake);
  await set({ v: 2, mode: 'light', pal: 'lake', accent: '#ff8800' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-sgx-seed', '#ff8800');
  await expect(page.locator('#sgx-accent-roles')).toHaveCount(1);
  const custom = await ind();
  expect(custom).not.toBe(lake);
  /* 第二次：缓存命中，不再加载引擎脚本 */
  await page.reload();
  await expect(page.locator('#sgx-accent-roles')).toHaveCount(1);
  await expect(page.locator('#sgx-accent-js')).toHaveCount(0);
  expect(await ind()).toBe(custom);
});

test('留言板：右圆进 /guestbook/，长条只有页名，卡片里插入共用 Giscus（specific term=guestbook、输入框在上、跟浅色）；英文页 lang=en', async ({ page }) => {
  await mock(page, false);
  const giscus = [];
  await page.route('https://giscus.app/**', (r) => { giscus.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
  await page.goto('/');
  await page.locator('.sgx-topbar .sgx-tb-end').click();
  await expect(page).toHaveURL(/\/guestbook\/$/);
  await expect(page.locator('.sgx-tb-pill .sgx-tb-title')).toHaveText('留言板');
  await expect(page.locator('.sgx-tb-pill .sgx-seg')).toHaveCount(0);
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.dm-gb-card')).toBeVisible();
  const s = page.locator('[data-giscus] script[src="https://giscus.app/client.js"]');
  await expect(s).toHaveCount(1);
  for (const [k, v] of [['data-repo', 'styrigx/styrigx'], ['data-repo-id', 'R_kgDOVDhNiA'], ['data-category', 'Announcements'], ['data-category-id', 'DIC_kwDOVDhNiM4DJVrs'],
    ['data-mapping', 'specific'], ['data-term', 'guestbook'], ['data-strict', '0'], ['data-reactions-enabled', '1'], ['data-input-position', 'top'], ['data-lang', 'zh-CN'], ['data-theme', 'light']]) {
    await expect(s, k).toHaveAttribute(k, v);
  }
  expect(giscus.length).toBeGreaterThan(0);
  await expect(page.locator('footer')).toHaveCount(0);
  /* 卡片不超出屏幕 */
  const box = await page.locator('.dm-gb-card').boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);
  await page.goto('/en/guestbook/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.sgx-tb-pill .sgx-tb-title')).toHaveText('Guestbook');
  await expect(page.locator('.sgx-topbar .sgx-tb-end')).toHaveAttribute('href', '/en/guestbook/');
  await expect(page.locator('[data-giscus] script')).toHaveAttribute('data-lang', 'en');
});
