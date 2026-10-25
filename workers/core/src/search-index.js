/**
 * @fileoverview 全站搜索索引：日刻自己把句子写进 KV styrigx-search-index 的 site:daymark。
 *
 * 值的格式（与 styrigx-space 仓库 workers/search-index/src/rank.js 一致）：
 *   { site: 'daymark', generated: ISO 时间, items: Item[] }
 *   Item = { id, type: 'quote', lang: 'zh'|'en', title, subtitle?, text?, url, private?: true }
 *
 * 每句出两条：中文条目（lang zh，链到 /）和英文条目（lang en，链到 /en/；有译文用译文当标题）。
 *   - title：句子（约 80 字截断）；subtitle：署名，和页面上一样（「作者 · 《出处》」/ "Author · Source"）
 *   - text：全文 + 译文 + 标签（≤2000 字，只参与匹配，搜索 Worker 不回给前端）
 *   - url：本站没有单句的深链；有作者 → 百味里这位作者的分组 #flavors/a/<作者>，没作者 → 拾录 #trove
 *   - private：访客看不到的句子（visibility = private）标 private:true，只给管理员搜到
 *   - 随手一笔（note）只给管理员看：只有私密句子的 text 里才带上；公开句子不带，免得访客靠搜索试出内容
 *
 * 什么时候写：
 *   - 每次写接口成功（增 / 改 / 删 / 以后的导入）后由 index.js 用 ctx.waitUntil 重建
 *   - Cron 每小时兜底重建一次（wrangler.toml [triggers]），首次部署后也靠它填上
 * 出错只打日志，不抛给调用方，绝不影响接口本身。
 */
import { ensureSchema, QUOTE_COLS, rowToQuote } from './api/_quotes.js';

export const SITE = 'daymark';
export const KEY = 'site:' + SITE;
export const ORIGIN = 'https://daymark.styrigx.com';
const TITLE_MAX = 80;
const TEXT_MAX = 2000;
/* KV 单值上限 25 MiB；留余量，超了就去掉 text（标题、署名还能搜） */
const VALUE_MAX = 24 * 1024 * 1024;

/** 截断到 n 个字（按码点，不切坏表情），超了加省略号；换行压成空格 */
export function clip(s, n) {
  const flat = String(s || '').replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : flat;
}

/** 署名，同 web/assets/js/daymark.js 的 attribution()：中文给诗词 / 书 / 电影 / 歌的出处加书名号 */
export function attribution(q, isEn) {
  const a = String((q && q.author) || '').trim();
  let s = String((q && q.source) || '').trim();
  if (s && !isEn) {
    const bare = s.replace(/^《/, '').replace(/》$/, '');
    const t = q.source_type || '';
    if (!/[《》]/.test(s) && (t === 'poetry' || t === 'book' || t === 'film' || t === 'song')) s = '《' + bare + '》';
  }
  return [a, s].filter(Boolean).join(' · ');
}

/** 能打开这句的页面：有作者 → 百味里的作者分组；没有 → 拾录 */
export function quoteUrl(q, isEn) {
  const base = ORIGIN + (isEn ? '/en/' : '/');
  const a = String((q && q.author) || '').trim();
  return a ? base + '#flavors/a/' + encodeURIComponent(a) : base + '#trove';
}

/**
 * 一句 → 两条索引（zh + en）。q 是 rowToQuote(row, true) 的结果（带 note）。
 * @param {Record<string, any>} q
 */
export function quoteItems(q) {
  const priv = q.visibility === 'private';
  const tags = (q.tags || []).map((t) => '#' + t).join(' ');
  const note = priv ? q.note || '' : '';
  const out = [];
  for (const isEn of [false, true]) {
    const head = isEn && q.trans ? q.trans : q.text;
    const other = isEn && q.trans ? q.text : q.trans;
    /** @type {Record<string, any>} */
    const it = {
      id: 'quote:' + q.id + (isEn ? ':en' : ''),
      type: 'quote',
      lang: isEn ? 'en' : 'zh',
      title: clip(head, TITLE_MAX),
    };
    const sub = attribution(q, isEn);
    if (sub) it.subtitle = sub;
    const text = [head, other, tags, note].filter(Boolean).join('\n').slice(0, TEXT_MAX);
    if (text) it.text = text;
    it.url = quoteUrl(q, isEn);
    if (priv) it.private = true;
    out.push(it);
  }
  return out;
}

/** 从 D1 读全部句子（新的在前），拼成索引值 */
export async function buildIndex(db, now = Date.now()) {
  await ensureSchema(db);
  const { results } = await db.prepare(`SELECT ${QUOTE_COLS} FROM quotes ORDER BY created_at DESC, id`).all();
  const items = [];
  for (const r of results || []) items.push(...quoteItems(rowToQuote(r, true)));
  return { site: SITE, generated: new Date(now).toISOString(), items };
}

/**
 * 重建并写入 KV。永不抛错：成功 {ok:true, count}，失败 {ok:false, error}（只打日志，不带句子内容）。
 * @param {Record<string, any>} env
 */
export async function rebuildSearchIndex(env, now = Date.now()) {
  try {
    const kv = env && env.KV_SEARCH_INDEX;
    if (!kv || typeof kv.put !== 'function') {
      console.error('[daymark-search] KV_SEARCH_INDEX binding missing');
      return { ok: false, error: 'kv-binding-missing' };
    }
    if (!env.D1_QUOTES) {
      console.error('[daymark-search] D1_QUOTES binding missing');
      return { ok: false, error: 'db-binding-missing' };
    }
    const value = await buildIndex(env.D1_QUOTES, now);
    let body = JSON.stringify(value);
    if (body.length > VALUE_MAX) {
      for (const it of value.items) delete it.text;
      body = JSON.stringify(value);
    }
    await kv.put(KEY, body);
    return { ok: true, count: value.items.length };
  } catch (e) {
    console.error('[daymark-search] rebuild failed: ' + (e && e.message ? e.message : 'error'));
    return { ok: false, error: 'rebuild-failed' };
  }
}

const MUTATING = ['POST', 'PUT', 'DELETE', 'PATCH'];

/** 这次请求成功改了数据吗（写方法 + 2xx） */
export function isMutation(method, status) {
  return MUTATING.includes(String(method || '').toUpperCase()) && status >= 200 && status < 300;
}
