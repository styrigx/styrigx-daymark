// 首页纯函数（web/assets/js/daymark.js）：标签输入、标签排序、筛选、署名、日期显示。
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

const QS = [
  { id: 'a', text: 'Stay hungry', trans: '求知若饥', author: 'Steve Jobs', source: '', tags: ['人生', 'English'] },
  { id: 'b', text: '世上本没有路', trans: '', author: '鲁迅', source: '故乡', tags: ['人生'] },
  { id: 'c', text: '无题', trans: '', author: '', source: '', tags: [] },
];

test('parseTagInput：逗号顿号空格都能分，去 #、去重、最多 8 个', () => {
  assert.deepEqual([...D.parseTagInput('#人生, 勇气、人生  诗')], ['人生', '勇气', '诗']);
  assert.equal(D.parseTagInput('1 2 3 4 5 6 7 8 9 10').length, 8);
  assert.deepEqual([...D.parseTagInput('')], []);
});

test('allTags：按出现次数排序', () => {
  assert.deepEqual([...D.allTags(QS)], ['人生', 'English']);
});

test('filterQuotes：标签 + 关键词（正文、译文、作者、出处，不分大小写）', () => {
  assert.deepEqual(D.filterQuotes(QS, '人生', '').map((q) => q.id), ['a', 'b']);
  assert.deepEqual(D.filterQuotes(QS, '', 'jobs').map((q) => q.id), ['a']);
  assert.deepEqual(D.filterQuotes(QS, '', '饥').map((q) => q.id), ['a']);
  assert.deepEqual(D.filterQuotes(QS, '', '故乡').map((q) => q.id), ['b']);
  assert.deepEqual(D.filterQuotes(QS, 'English', '路').map((q) => q.id), []);
});

test('attribution：中文书名号不重复，英文逗号', () => {
  assert.equal(D.attribution(QS[1], false), '— 鲁迅《故乡》');
  assert.equal(D.attribution({ author: '鲁迅', source: '《呐喊》' }, false), '— 鲁迅《呐喊》');
  assert.equal(D.attribution({ author: 'A', source: 'B' }, true), '— A, B');
  assert.equal(D.attribution(QS[2], false), '');
});

test('fmtDay', () => {
  assert.equal(D.fmtDay('2026-10-20', false), '10月20日 星期二');
  assert.equal(D.fmtDay('2026-10-20', true), 'Tuesday, Oct 20');
  assert.equal(D.fmtDay('bad', false), '');
});
