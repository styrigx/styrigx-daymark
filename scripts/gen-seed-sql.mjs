// 生成 D1 种子迁移 workers/core/migrations/0003_seed_quotes.sql：把一份句子 JSON 写成「只增不删、重复跑也安全」的 SQL。
//
// 用法：node scripts/gen-seed-sql.mjs <quotes.json> [输出路径]
// JSON：数组，每项 {text, translation, author, source, source_type, tags, public, collection}
//   source_type 可以是中文标签（诗词 / 书 / 电影 / 歌 / 访谈 / 自己）或接口里的 id（poetry / book / …）
//   collection：归入的自建专题名（专题简介见 INTROS；不在里面的专题简介为空）
// 生成的 SQL：
//   - 句子：INSERT … SELECT … WHERE NOT EXISTS（正文完全相同或 id 相同就跳过，不碰已有的行）
//   - 专题：同名专题已存在就不建，排到现有专题最后
//   - 归属：按 JSON 顺序追加到专题末尾（按正文找句子、按名字找专题；已经在里面就 INSERT OR IGNORE 跳过）
//   - 没有 DELETE / UPDATE / DROP
// id 由正文 / 专题名的 SHA-1 前 12 位得出（重新生成结果不变）；JSON 第一句最新（拾录里排最前）。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const INTROS = {
  '尼采': '尼采原著摘句，英文为公版译本',
  '了不起的盖茨比': '菲茨杰拉德原文摘句',
};
const TYPES = { '诗词': 'poetry', '书': 'book', '电影': 'film', '歌': 'song', '访谈': 'interview', '自己': 'mine' };
const IDS = ['poetry', 'book', 'film', 'song', 'interview', 'mine'];
/** 2026-10-21 00:00 北京时间；第 i 句的 created_at = BASE + (n - i) 秒 */
const BASE = Date.UTC(2026, 9, 20, 16, 0, 0);

const sql = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const id12 = (s) => createHash('sha1').update(s, 'utf8').digest('hex').slice(0, 12);

export function seedSql(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('seed: empty list');
  const n = list.length;
  const out = [
    '-- 种子句子（scripts/gen-seed-sql.mjs 生成，勿手改）：' + n + ' 句 + 自建专题 ' + [...new Set(list.map((q) => q.collection).filter(Boolean))].join(' / ') + '。',
    '-- 只增不删：正文已存在的句子跳过、同名专题不重建、已在专题里的不重复加；没有 DELETE / UPDATE。重复执行结果不变。',
    '',
  ];
  const texts = new Set();
  list.forEach((q, i) => {
    const text = String(q.text || '').trim();
    if (!text) throw new Error('seed: empty text at ' + i);
    if (texts.has(text)) throw new Error('seed: duplicate text at ' + i);
    texts.add(text);
    const st = TYPES[q.source_type] || (IDS.includes(q.source_type) ? q.source_type : '');
    const tags = JSON.stringify(Array.isArray(q.tags) ? q.tags.slice(0, 8) : []);
    const id = id12('daymark-seed:' + text);
    const at = BASE + (n - i) * 1000;
    const vis = q.public === false ? 'private' : 'public';
    out.push(
      'INSERT INTO quotes (id, text, trans, author, source, source_type, tags, visibility, note, created_at, updated_at) SELECT ' +
      [sql(id), sql(text), sql(q.translation || ''), sql(q.author || ''), sql(q.source || ''), sql(st), sql(tags), sql(vis), "''", at, at].join(', ') +
      ' WHERE NOT EXISTS (SELECT 1 FROM quotes WHERE text = ' + sql(text) + ' OR id = ' + sql(id) + ');'
    );
  });
  out.push('');
  const cols = [...new Set(list.map((q) => q.collection).filter(Boolean))];
  cols.forEach((name, k) => {
    const id = id12('daymark-seed-collection:' + name);
    out.push(
      'INSERT INTO collections (id, name, intro, created_at, sort) SELECT ' +
      [sql(id), sql(name), sql(INTROS[name] || ''), BASE + k * 1000].join(', ') +
      ', (SELECT COALESCE(MAX(sort), -1) + 1 FROM collections) WHERE NOT EXISTS (SELECT 1 FROM collections WHERE name = ' + sql(name) + ' OR id = ' + sql(id) + ');'
    );
  });
  out.push('');
  for (const q of list) {
    if (!q.collection) continue;
    const c = '(SELECT id FROM collections WHERE name = ' + sql(q.collection) + ' ORDER BY created_at, id LIMIT 1)';
    const t = '(SELECT id FROM quotes WHERE text = ' + sql(String(q.text).trim()) + ' ORDER BY created_at, id LIMIT 1)';
    out.push(
      'INSERT OR IGNORE INTO collection_quotes (collection_id, quote_id, position) SELECT ' + c + ', ' + t +
      ', (SELECT COALESCE(MAX(position), -1) + 1 FROM collection_quotes WHERE collection_id = ' + c + ') WHERE ' + c + ' IS NOT NULL AND ' + t + ' IS NOT NULL;'
    );
  }
  return out.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.argv[2];
  if (!src) { console.error('usage: node scripts/gen-seed-sql.mjs <quotes.json> [out.sql]'); process.exit(2); }
  const dest = process.argv[3] || new URL('../workers/core/migrations/0003_seed_quotes.sql', import.meta.url);
  writeFileSync(dest, seedSql(JSON.parse(readFileSync(src, 'utf8'))));
  console.log('wrote ' + dest);
}
