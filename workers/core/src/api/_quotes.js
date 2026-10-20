// workers/core/src/api/_quotes.js
// 句子：表结构、校验、行映射、今日一句的挑选。下划线开头：不是接口。

export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, text TEXT NOT NULL, trans TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', visibility TEXT NOT NULL DEFAULT 'public', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)",
  'CREATE INDEX IF NOT EXISTS quotes_created ON quotes (created_at)',
];

/** 上限：正文、译文 500 字；作者 60；出处 120；标签最多 8 个、每个 20 字；总数 20000 条 */
export const LIMITS = { text: 500, trans: 500, author: 60, source: 120, tags: 8, tag: 20, total: 20000 };

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
 * @returns {{error:string} | {fields: Record<string, any>}}
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
  if (!partial || b.tags !== undefined) f.tags = cleanTags(b.tags);
  if (!partial || b.visibility !== undefined) {
    const v = b.visibility === undefined ? 'public' : b.visibility;
    if (v !== 'public' && v !== 'private') return { error: 'bad-visibility' };
    f.visibility = v;
  }
  if (partial && Object.keys(f).length === 0) return { error: 'nothing' };
  return { fields: f };
}

function parseTags(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [];
  } catch (e) {
    return [];
  }
}

/** D1 行 → 对外对象 */
export function rowToQuote(r) {
  return {
    id: r.id,
    text: r.text,
    trans: r.trans || '',
    author: r.author || '',
    source: r.source || '',
    tags: parseTags(r.tags),
    visibility: r.visibility === 'private' ? 'private' : 'public',
    created_at: r.created_at || 0,
    updated_at: r.updated_at || 0,
  };
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
 * 今日一句：在公开句子里按日期挑一条（同一天所有人看到同一句，换天才换）。
 * 句子按 id 排好序传进来；空列表返回 null。
 * @param {{id:string}[]} sorted
 * @param {string} day
 */
export function pickForDay(sorted, day) {
  if (!sorted.length) return null;
  return sorted[hash32('daymark:' + day) % sorted.length];
}
