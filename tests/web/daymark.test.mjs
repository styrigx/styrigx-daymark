// 首页纯函数（web/assets/js/daymark.js）：页签路由、标签块、百味分组、自动补全、再抽一句、排序、署名、日期显示。
// 运行：node --test tests/web/daymark.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../../web/assets/js/daymark.js', import.meta.url), 'utf8');
const box = { module: { exports: {} }, console };
vm.createContext(box);
vm.runInContext(src, box);
const D = box.module.exports;
const plain = (v) => JSON.parse(JSON.stringify(v));

const QS = [
  { id: 'a', text: 'Stay hungry', trans: '求知若饥', author: 'Steve Jobs', source: '', tags: ['人生', 'English'], created_at: 5 },
  { id: 'b', text: '世上本没有路', trans: '', author: '鲁迅', source: '故乡', source_type: 'book', tags: ['人生'], created_at: 4 },
  { id: 'c', text: '无题', trans: '', author: '', source: '', tags: [], created_at: 3 },
  { id: 'd', text: '人生如逆旅', trans: '', author: '苏轼', source: '临江仙', source_type: 'poetry', tags: [], created_at: 2 },
  { id: 'e', text: '也无风雨也无晴', trans: '', author: '苏轼', source: '定风波', source_type: 'poetry', tags: [], created_at: 1 },
];

test('页签顺序固定：余响 · 拾录 · 百味', () => {
  assert.deepEqual(plain(D.TABS), ['echo', 'trove', 'flavors']);
});

test('parseHash / routeHash：默认余响，#trove，#flavors，百味分组', () => {
  assert.deepEqual(plain(D.parseHash('')), { tab: 'echo' });
  assert.deepEqual(plain(D.parseHash('#trove')), { tab: 'trove' });
  assert.deepEqual(plain(D.parseHash('#flavors')), { tab: 'flavors' });
  assert.deepEqual(plain(D.parseHash('#flavors/c/abcdef012345')), { tab: 'flavors', group: { kind: 'c', key: 'abcdef012345' } });
  assert.deepEqual(plain(D.parseHash('#flavors/a/' + encodeURIComponent('安迪·杜佛兰'))), { tab: 'flavors', group: { kind: 'a', key: '安迪·杜佛兰' } });
  assert.deepEqual(plain(D.parseHash('#flavors/x/1')), { tab: 'flavors' });
  assert.equal(D.parseHash('#nope'), null);
  assert.equal(D.parseHash('#search'), null);
  for (const r of [{ tab: 'echo' }, { tab: 'trove' }, { tab: 'flavors' }, { tab: 'flavors', group: { kind: 'a', key: 'A/B 作者' } }]) {
    assert.deepEqual(plain(D.parseHash(D.routeHash(r))), r);
  }
  assert.equal(D.routeHash({ tab: 'echo' }), '');
});

test('标签块：回车 / 逗号成块，去 #、去重、最多 8 个', () => {
  assert.deepEqual(plain(D.parseTagInput('#人生, 勇气、人生  诗')), ['人生', '勇气', '诗']);
  assert.equal(D.parseTagInput('1 2 3 4 5 6 7 8 9 10').length, 8);
  assert.deepEqual(plain(D.addTags(['人生'], '人生，旅行')), ['人生', '旅行']);
  assert.equal(D.addTags(['1', '2', '3', '4', '5', '6', '7'], 'x y z').length, 8);
  assert.deepEqual(plain(D.allTags(QS)), ['人生', 'English']);
});

test('百味 · 人物：每位作者一组，多的在前，没写作者的不分组', () => {
  assert.deepEqual(plain(D.authorGroups(QS)), [{ name: '苏轼', count: 2 }, { name: 'Steve Jobs', count: 1 }, { name: '鲁迅', count: 1 }]);
});

test('groupQuotes：自建专题按专题顺序、丢掉看不到的句子；人物按原顺序', () => {
  const cols = [{ id: 'c1', quote_ids: ['e', 'zz', 'a'] }];
  assert.deepEqual(D.groupQuotes(QS, cols, { kind: 'c', key: 'c1' }).map((q) => q.id), ['e', 'a']);
  assert.deepEqual(D.groupQuotes(QS, cols, { kind: 'a', key: '苏轼' }).map((q) => q.id), ['d', 'e']);
  assert.deepEqual(plain(D.groupQuotes(QS, cols, { kind: 'c', key: 'gone' })), []);
});

test('自动补全：开头匹配在前，不分大小写，和输入一样的不出；最近作者去重', () => {
  assert.deepEqual(plain(D.suggest(['苏轼', '苏东坡', '老苏', 'Steve Jobs'], '苏')), ['苏轼', '苏东坡', '老苏']);
  assert.deepEqual(plain(D.suggest(['Steve Jobs'], 'jobs')), ['Steve Jobs']);
  assert.deepEqual(plain(D.suggest(['苏轼'], '苏轼')), []);
  assert.deepEqual(plain(D.suggest(['苏轼'], '')), []);
  assert.deepEqual(plain(D.recentAuthors(QS, 2)), ['Steve Jobs', '鲁迅']);
  assert.deepEqual(plain(D.knownSources(QS, 'poetry')), ['临江仙', '定风波']);
  assert.deepEqual(plain(D.knownSources(QS, '')), ['临江仙', '定风波', '故乡']);
});

test('再抽一句：不和现在这句重复；只有一句就还是它；空列表 null', () => {
  for (let i = 0; i < 20; i++) assert.notEqual(D.pickRandom(QS, 'a', () => i / 20).id, 'a');
  assert.equal(D.pickRandom([QS[0]], 'a').id, 'a');
  assert.equal(D.pickRandom([], 'a'), null);
  assert.equal(D.pickRandom(QS, null, () => 0.9999).id, 'e');
});

test('设为今日：只管理员、抽过、公开、不是今天这句才显示', () => {
  const pub = { id: 'x1', visibility: 'public' };
  const pri = { id: 'x2', visibility: 'private' };
  const today = { id: 't0' };
  assert.equal(D.canSetToday(true, true, pub, today), true);
  assert.equal(D.canSetToday(true, true, { id: 'x3' }, null), true, '今天还没有句子也能设');
  assert.equal(D.canSetToday(false, true, pub, today), false, '访客没有');
  assert.equal(D.canSetToday(true, false, pub, today), false, '没抽过（今日状态）没有');
  assert.equal(D.canSetToday(true, true, pri, today), false, '私密句子不能设');
  assert.equal(D.canSetToday(true, true, { id: 't0', visibility: 'public' }, today), false, '抽到的就是今天这句');
  assert.equal(D.canSetToday(true, true, null, today), false);
});

test('moveItem：上移 / 下移，越界不动', () => {
  assert.deepEqual(plain(D.moveItem(['a', 'b', 'c'], 2, -1)), ['a', 'c', 'b']);
  assert.deepEqual(plain(D.moveItem(['a', 'b', 'c'], 0, 1)), ['b', 'a', 'c']);
  assert.deepEqual(plain(D.moveItem(['a', 'b', 'c'], 0, -1)), ['a', 'b', 'c']);
  assert.deepEqual(plain(D.moveItem(['a', 'b', 'c'], 2, 1)), ['a', 'b', 'c']);
});

test('署名「作者 · 出处」：诗词书影歌加书名号且不重复，访谈不加，英文不加', () => {
  assert.equal(D.attribution(QS[1], false), '鲁迅 · 《故乡》');
  assert.equal(D.attribution({ author: '鲁迅', source: '《呐喊》' }, false), '鲁迅 · 《呐喊》');
  assert.equal(D.attribution({ author: '乔布斯', source: '斯坦福演讲', source_type: 'interview' }, false), '乔布斯 · 斯坦福演讲');
  assert.equal(D.attribution({ author: 'A', source: 'B', source_type: 'book' }, true), 'A · B');
  assert.equal(D.attribution({ author: '', source: '定风波', source_type: 'poetry' }, false), '《定风波》');
  assert.equal(D.attribution(QS[2], false), '');
  assert.equal(D.attribution({ author: '尼采', source: '《查拉图斯特拉如是说》·序言 3', source_type: 'book' }, false), '尼采 · 《查拉图斯特拉如是说》·序言 3');
});

test('日期行：今日 / 抽到的那句记于哪天（北京时间）', () => {
  assert.equal(D.fmtDay('2026-10-20', false), '10月20日 星期二');
  assert.equal(D.fmtDay('2026-10-20', true), 'Tuesday, Oct 20');
  assert.equal(D.fmtDay('bad', false), '');
  /* 2026-10-20 16:30 UTC = 10-21 00:30 北京 */
  assert.equal(D.fmtKept(Date.UTC(2026, 9, 20, 16, 30), false), '拾于 2026年10月21日');
  assert.equal(D.fmtKept(Date.UTC(2026, 9, 20, 12), true), 'Kept Oct 20, 2026');
});

test('分享文本：正文、译文、署名各一行', () => {
  assert.equal(D.shareText(QS[0], false), 'Stay hungry\n求知若饥\n—— Steve Jobs');
  assert.equal(D.shareText(QS[2], false), '无题');
});
