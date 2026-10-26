/**
 * 测试辅助：在 vm 里跑本站内联的共享读端（web/assets/js/sgx/shell/ui-cookie-read.js），配最小 DOM 桩
 * （<html> 的 class / attribute / style、<head> 里的 <style>、localStorage、matchMedia）。
 * 同 styrigx-space tests/web/ui/ui-cookie-contract.test.mjs 的桩。
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const READER = readFileSync(new URL('../../web/assets/js/sgx/shell/ui-cookie-read.js', import.meta.url), 'utf8');

function makeEl(tag) {
  const attrs = new Map();
  const classes = new Set();
  const props = new Map();
  const el = {
    tagName: tag, id: '', textContent: '', children: [], parentNode: null,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    removeAttribute: (k) => attrs.delete(k),
    style: { fontSize: '', setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '' },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { el.children.splice(el.children.indexOf(c), 1); c.parentNode = null; return c; },
  };
  return el;
}

export function sandbox({ cookie = '', dark = false, store = {} } = {}) {
  const html = makeEl('html');
  const head = html.appendChild(makeEl('head'));
  const ls = new Map(Object.entries(store));
  const listeners = [];
  let cookieWrites = 0;
  const mq = { get matches() { return ctx.__dark; }, addEventListener: (_t, cb) => listeners.push(cb) };
  const ctx = {
    __dark: dark,
    atob: (s) => Buffer.from(s, 'base64').toString('latin1'),
    btoa: (s) => Buffer.from(s, 'latin1').toString('base64'),
    escape, unescape,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    matchMedia: () => mq,
    document: {
      documentElement: html, head,
      get cookie() { return cookie; },
      set cookie(_v) { cookieWrites++; },
      createElement: (t) => makeEl(t),
      getElementById: (id) => head.children.find((c) => c.id === id) || null,
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(READER, ctx, { filename: 'ui-cookie-read.js' });
  return {
    U: ctx.SgxUI, html, ls, ctx,
    setCookie: (c) => { cookie = c; },
    flip: (d) => { ctx.__dark = d; for (const cb of listeners) cb(); },
    get cookieWrites() { return cookieWrites; },
    listeners,
  };
}
