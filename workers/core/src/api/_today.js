// workers/core/src/api/_today.js
// 今日一句的锁定与改写（表 daily_pick，迁移 0004）。下划线开头：不是接口。
//
// - 读（resolveDay）：当天已有记录且那句还在、还是公开的 → 就是它；
//   否则（没记录 / 那句被删了 / 改成私密了）按 pickForDay 在公开句子里重挑。
//   只有 persist=true（北京时间的今天）才把重挑的结果写回去锁住；看别的日期（?d=）只读不写。
// - 写（setPick）：管理员「设为今日」，覆盖当天那一行（set_by='admin'：手动设的；自动挑的是 'auto'。旧库里的 'owner' 由迁移 0005 改成 'admin'）。
// - 公开出口只有公开句子：私密句子不会被读出来，也不让设为今日（today.js 回 409 private）。
import { pickForDay, rowToQuote } from './_quotes.js';

const COLS = 'id, text, trans, author, source, source_type, tags, visibility, created_at, updated_at';

/** 对外字段（/api/today 的 quote）：不带 note、可见性、百味归属 */
export function publicQuote(row) {
  if (!row) return null;
  const q = rowToQuote(row);
  return { id: q.id, text: q.text, trans: q.trans, author: q.author, source: q.source, source_type: q.source_type, tags: q.tags };
}

/** 一句公开句子（不存在或私密 → null） */
export async function publicRow(db, id) {
  return db.prepare(`SELECT ${COLS} FROM quotes WHERE id = ?1 AND visibility = 'public'`).bind(id).first();
}

/** 这一天记下的句子 id（没有 → null） */
export async function storedPickId(db, day) {
  const r = await db.prepare('SELECT quote_id FROM daily_pick WHERE day = ?1').bind(day).first();
  return r ? r.quote_id : null;
}

/**
 * 某天的今日一句（D1 行或 null）。
 * @param {any} db
 * @param {string} day YYYY-MM-DD（北京时间）
 * @param {{persist?: boolean, now?: number}} [o] persist：没记录 / 记录失效时把重挑的结果写回
 */
export async function resolveDay(db, day, o = {}) {
  const stored = await storedPickId(db, day);
  if (stored) {
    const row = await publicRow(db, stored);
    if (row) return row;
  }
  const { results } = await db.prepare(`SELECT ${COLS} FROM quotes WHERE visibility = 'public' ORDER BY id`).all();
  const hit = pickForDay(results || [], day);
  if (!o.persist) return hit;
  /* 失效的记录先删掉（只删还是那一句的那行，别把同时写进来的新记录删了） */
  if (stored) await db.prepare('DELETE FROM daily_pick WHERE day = ?1 AND quote_id = ?2').bind(day, stored).run();
  if (!hit) return null;
  await db.prepare("INSERT OR IGNORE INTO daily_pick (day, quote_id, set_by, set_at) VALUES (?1, ?2, 'auto', ?3)")
    .bind(day, hit.id, o.now || Date.now()).run();
  /* 两个请求同时首挑：以先写进去的那行为准 */
  const won = await storedPickId(db, day);
  if (won && won !== hit.id) {
    const row = await publicRow(db, won);
    if (row) return row;
  }
  return hit;
}

/** 管理员设为今日：覆盖这一天的记录 */
export async function setPick(db, day, quoteId, now = Date.now()) {
  await db.prepare(
    "INSERT INTO daily_pick (day, quote_id, set_by, set_at) VALUES (?1, ?2, 'admin', ?3) " +
    "ON CONFLICT(day) DO UPDATE SET quote_id = excluded.quote_id, set_by = 'admin', set_at = excluded.set_at"
  ).bind(day, quoteId, now).run();
}
