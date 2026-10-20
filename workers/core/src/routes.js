/**
 * @fileoverview 接口路由表：/api/<路径> → src/api/<路径>.js。
 * src/api/ 新增或删除接口文件时这里要同步，tests/workers/core/worker.test.mjs 会检查两边一致。
 * 下划线开头的文件不是接口（_auth、_lib、_quotes）。
 */
import * as quotes from './api/quotes.js';
import * as today from './api/today.js';

/** @type {Map<string, Record<string, Function>>} */
export const API_ROUTES = new Map([
  ['/api/quotes', quotes],
  ['/api/today', today],
]);
