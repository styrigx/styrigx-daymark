/**
 * @fileoverview 双语文案：页面里的 <script type="application/json"> 块。
 * 形状：{"key": {"zh": "中文", "en": "English"}}（纯字符串也可直接写）。
 * 同一份 JS 按 document.documentElement.lang 取对应语言，中英文共用缓存。
 */
import { isEn } from './util.js';

/**
 * @typedef {Object} I18nDict
 * @property {(key: string) => string} t 取当前语言文案（缺失返回 ''）
 * @property {(key: string, vars?: Record<string, string|number>) => string} fmt 带 {name} 占位替换
 */

/**
 * 读取页面内指定 id 的 JSON 文案块。
 * @param {string} id script 块的 id（如 'sgx-i18n-core'）
 * @returns {I18nDict}
 */
export function loadI18n(id) {
  /** @type {Record<string, any>} */
  let dict = {};
  try {
    const el = document.getElementById(id);
    if (el && el.textContent) dict = JSON.parse(el.textContent) || {};
  } catch (e) {
    dict = {};
  }
  const en = isEn();
  /**
   * @param {string} key
   * @returns {string}
   */
  function t(key) {
    const o = dict[key];
    if (o == null) return '';
    if (typeof o === 'string') return o;
    const v = en ? o.en : o.zh;
    if (v != null) return String(v);
    const fb = en ? o.zh : o.en;
    return fb != null ? String(fb) : '';
  }
  /**
   * @param {string} key
   * @param {Record<string, string|number>} [vars]
   * @returns {string}
   */
  function fmt(key, vars) {
    let s = t(key);
    if (vars) {
      for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
    }
    return s;
  }
  return { t, fmt };
}
