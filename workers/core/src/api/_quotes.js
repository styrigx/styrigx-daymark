// workers/core/src/api/_quotes.js
// 句子：表结构、校验、行映射、今日一句的挑选（锁定 / 改写见 _today.js）。下划线开头：不是接口。

// 兜底建表只管全新的库（测试、本地）。已有的库靠 migrations/ 加列：CI 先跑 D1 迁移再部署 core，
// 这里不做 ALTER TABLE（代码先加了列，迁移 0002 就会因列已存在而失败、卡住部署）。
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, text TEXT NOT NULL, trans TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', visibility TEXT NOT NULL DEFAULT 'public', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0, source_type TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS quotes_created ON quotes (created_at)',
  "CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT NOT NULL, intro TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)",
  'CREATE TABLE IF NOT EXISTS collection_quotes (collection_id TEXT NOT NULL, quote_id TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (collection_id, quote_id))',
  'CREATE INDEX IF NOT EXISTS collection_quotes_quote ON collection_quotes (quote_id)',
  "CREATE TABLE IF NOT EXISTS daily_pick (day TEXT PRIMARY KEY, quote_id TEXT NOT NULL, set_by TEXT NOT NULL DEFAULT 'auto', set_at INTEGER NOT NULL DEFAULT 0)",
];

/** 上限：正文、译文、随手一笔 500 字；作者 60；出处 120；标签最多 8 个、每个 20 字；总数 20000 条；
 *  百味专题：名字 30、简介 80、最多 200 个、每个最多 2000 句 */
export const LIMITS = {
  text: 500, trans: 500, note: 500, author: 60, source: 120, tags: 8, tag: 20, total: 20000,
  cname: 30, cintro: 80, collections: 200, members: 2000,
};

/** 出处类型：诗词 / 书 / 电影 / 歌 / 访谈 / 自己；空 = 没选 */
export const SOURCE_TYPES = ['poetry', 'book', 'film', 'song', 'interview', 'mine'];

/** 对外的句子字段（note 只给主人，见 rowToQuote） */
export const QUOTE_COLS = 'id, text, trans, author, source, source_type, tags, visibility, note, created_at, updated_at';

const done = new WeakSet();
/** 建表（幂等；同一个 Worker 实例里每个 db 对象只建一次） */
export async function ensureSchema(db) {
  if (done.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  done.add(db);
}

/** 去控制字符（保留换行）、去首尾空白、截断 */
export function cleanText(v, max, keepNewlines = false) {
  if (typeof v !== 'string') return '';
  let s = v.replace(/\r\n?/g, '\n');
  s = keepNewlines ? s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : s.replace(/[\u0000-\u001f\u007f]/g, ' ');
  return s.replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** 标签：数组或逗号/空格分隔的字符串；去重、去 #、截断 */
export function cleanTags(v) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,，、\s]+/) : [];
  const out = [];
  for (const t of raw) {
    const s = cleanText(String(t == null ? '' : t), LIMITS.tag).replace(/^#+/, '');
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

/**
 * 校验新增 / 修改的字段。partial=true（修改）时只处理给了的字段。
 * @returns {{error:string} | {fields: Record<string, any>, collections?: string[]}}
 */
export function parseQuote(b, partial = false) {
  if (!b || typeof b !== 'object') return { error: 'bad-body' };
  /** @type {Record<string, any>} */
  const f = {};
  if (!partial || b.text !== undefined) {
    f.text = cleanText(b.text, LIMITS.text, true);
    if (!f.text) return { error: 'bad-text' };
  }
  if (!partial || b.trans !== undefined) f.trans = cleanText(b.trans, LIMITS.trans, true);
  if (!partial || b.author !== undefined) f.author = cleanText(b.author, LIMITS.author);
  if (!partial || b.source !== undefined) f.source = cleanText(b.source, LIMITS.source);
  if (!partial || b.source_type !== undefined) {
    const t = b.source_type == null ? '' : b.source_type;
    if (t !== '' && !SOURCE_TYPES.includes(t)) return { error: 'bad-source-type' };
    f.source_type = t;
  }
  if (!partial || b.note !== undefined) f.note = cleanText(b.note, LIMITS.note, true);
  if (!partial || b.tags !== undefined) f.tags = cleanTags(b.tags);
  if (!partial || b.visibility !== undefined) {
    const v = b.visibility === undefined ? 'public' : b.visibility;
    if (v !== 'public' && v !== 'private') return { error: 'bad-visibility' };
    f.visibility = v;
  }
  /* 归入百味：专题 id 数组（可选；给了就按它重设这句的归属） */
  let collections;
  if (b.collections !== undefined) {
    if (!Array.isArray(b.collections) || b.collections.length > LIMITS.collections) return { error: 'bad-collections' };
    collections = [];
    for (const c of b.collections) {
      if (typeof c !== 'string' || !ID_RE.test(c)) return { error: 'bad-collections' };
      if (!collections.includes(c)) collections.push(c);
    }
  }
  if (partial && Object.keys(f).length === 0 && !collections) return { error: 'nothing' };
  return { fields: f, collections };
}

function parseTags(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  } catch (e) {
    return [];
  }
}

/**
 * D1 行 → 对外对象。随手一笔（note）只有 owner=true 才带上；访客的响应里连这个键都没有。
 * @param {Record<string, any>} r
 * @param {boolean} [owner]
 */
export function rowToQuote(r, owner = false) {
  /** @type {Record<string, any>} */
  const q = {
    id: r.id,
    text: r.text,
    trans: r.trans || '',
    author: r.author || '',
    source: r.source || '',
    source_type: SOURCE_TYPES.includes(r.source_type) ? r.source_type : '',
    tags: parseTags(r.tags),
    visibility: r.visibility === 'private' ? 'private' : 'public',
    created_at: r.created_at || 0,
    updated_at: r.updated_at || 0,
  };
  if (owner) q.note = r.note || '';
  return q;
}

/**
 * 百味专题的名字 / 简介。partial=true（修改）时只处理给了的字段。
 * @returns {{error:string} | {fields: Record<string, any>, quote_ids?: string[]}}
 */
export function parseCollection(b, partial = false) {
  if (!b || typeof b !== 'object') return { error: 'bad-body' };
  /** @type {Record<string, any>} */
  const f = {};
  if (!partial || b.name !== undefined) {
    f.name = cleanText(b.name, LIMITS.cname);
    if (!f.name) return { error: 'bad-name' };
  }
  if (!partial || b.intro !== undefined) f.intro = cleanText(b.intro, LIMITS.cintro);
  if (partial && b.sort !== undefined) {
    if (!Number.isInteger(b.sort) || b.sort < 0 || b.sort > 1e6) return { error: 'bad-sort' };
    f.sort = b.sort;
  }
  let quote_ids;
  if (partial && b.quote_ids !== undefined) {
    if (!Array.isArray(b.quote_ids) || b.quote_ids.length > LIMITS.members) return { error: 'bad-quote-ids' };
    quote_ids = [];
    for (const id of b.quote_ids) {
      if (typeof id !== 'string' || !ID_RE.test(id)) return { error: 'bad-quote-ids' };
      if (!quote_ids.includes(id)) quote_ids.push(id);
    }
  }
  if (partial && Object.keys(f).length === 0 && !quote_ids) return { error: 'nothing' };
  return { fields: f, quote_ids };
}

/** 新句子 id：12 位十六进制 */
export function newId() {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const ID_RE = /^[0-9a-f]{12}$/;

/** 北京时间的日期 YYYY-MM-DD（东八区没有夏令时） */
export function dayInShanghai(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** FNV-1a 32 位 */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 今日一句的初选：在公开句子里按日期挑一条。
 * 句子按 id 排好序传进来；空列表返回 null。挑中的结果由 _today.js 写进 daily_pick 锁住当天。
 * @param {{id:string}[]} sorted
 * @param {string} day
 */
export function pickForDay(sorted, day) {
  if (!sorted.length) return null;
  return sorted[hash32('daymark:' + day) % sorted.length];
}
