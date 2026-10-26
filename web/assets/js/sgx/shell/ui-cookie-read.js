/* @sgx-shell:begin styrigx/styrigx-space@4f29ef5db56095dd9231c3a848eda63701d14a32 web/shared/shell v23673824df0b（scripts/sync-shell.mjs 写入，勿手改） */
/* ---- ui-cookie-read.js ---- */
/**
 * @fileoverview sgx-ui cookie 只读解析器（2026-10-22）：子站（博客 / 日刻 / 珍格）首帧前读主站写的外观，<html> 落到和主站一样的状态。
 *
 * - 主站 lib/ui-cookie.js 写（localStorage 是唯一来源，cookie 只是镜像）；子站只读，永远不写 sgx-ui。
 *   写端也用这里的 NAME / V / MODES / FONT_SIZES / PRESETS / encode / decode，两边同一份字段表，不会各说各话。
 * - 经典脚本、ES5、无依赖：子站原样内联进 <head>（共享外壳 web/shared/shell/ui-cookie-read.js 就是本文件），
 *   也能被打包器当副作用模块 import。挂在 window.SgxUI 上。
 * - 校验严格：v 只认 1 / 2；mode ∈ system/light/dark；pal 必须是已知预设（旧撞色 x<id> 迁到 <id>）；accent 必须 ^#[0-9a-f]{6}$。
 *   cookie 缺失 / 乱码 / 版本不认识 → read() 返回 null，apply() 按默认（dustyblue + 跟随系统）渲染，绝不抛错、绝不跳转。
 * - apply(root) 落的状态 = 主站 baseof 内联脚本：class dark、data-theme-mode、data-dark、font-size、data-font-size、
 *   data-palette（默认 dustyblue 不写）、自定义色时 --sgx-seed + <style id="sgx-accent-roles">、class reduced-motion、data-reduced-motion。
 *
 * API：
 *   SgxUI.read([cookieString])          → 校验后的对象 {v, mode, pal, accent, fs, rm, mat, tz1, tz2, h12, clock, wx, unit, loc, city, precise} 或 null
 *   SgxUI.resolve(ui, prefersDark)      → {mode, dark, pal, fs, rm, seed}（seed：accent 是自定义色时为 #rrggbb，否则 ''）
 *   SgxUI.apply([root], [opts])         → 读 cookie + 落到 root（默认 <html>），返回 resolve 的结果；
 *       opts.rolesCss(seed)  同步可用的引擎（palette-scheme.js 的 rolesCss），缓存缺失时直接算；
 *       opts.onMiss(seed)    没缓存也没引擎时回调（子站去异步加载引擎，算好调 SgxUI.setRoles）；
 *       opts.watch === false 不挂系统深浅色监听（默认挂一次，跟随系统时系统一变就重落一遍）。
 *   SgxUI.setRoles(seed, css)           → 自定义色角色写进 <style id="sgx-accent-roles"> 并缓存到本站 localStorage（CACHE_KEY）
 *   SgxUI.encode(obj) / SgxUI.decode(str) → base64url(UTF-8 JSON) 编解码（写端共用）
 */
(function (g) {
  'use strict';
  /* @ui-cookie-presets:begin（scripts/gen-shell.mjs 按 web/data/palette-roles.json + palette-scheme.js 生成，勿手改） */
  var PRESETS = {"dustyblue":"#d4a72c","lake":"#f17f72","glacier":"#f17f72","indigo":"#f2559b","teal":"#d6334a","violet":"#d4628f","forest":"#f08a3c","matcha":"#c46a43","sage":"#cf9494","cherry":"#86ad3f","tangerine":"#168f9c","coral":"#168f9c","terra":"#94a982","amber":"#b54a88","mustard":"#7a95ab","champagne":"#536dfa","rose":"#f2a86b","berry":"#e3a93b","orchid":"#7a95ab","dustyrose":"#94a982","graphite":"#4f86b5","cream":"#168f9c"};
  var SCHEME_VER = 'c51e4304e54e';
  /* @ui-cookie-presets:end */

  var NAME = 'sgx-ui';
  /** 写端当前版本；读端认 VERSIONS 里的（v1 = 只有时钟 / 天气，v2 = B2-7 起加外观），别的一律当没有 cookie */
  var V = 2;
  var VERSIONS = [1, 2];
  var MODES = ['system', 'light', 'dark'];
  var FONT_SIZES = ['standard', 'small', 'large'];
  var DEFAULT_PAL = 'dustyblue';
  /* 2026-10-23 PR-G 七色调色板之前的预设种子（单色组；撞色 x<id> 和同名单色一样）：旧 cookie 里 accent = 旧种子时仍当预设，不当自定义色。不随引擎变，手写。 */
  var LEGACY_SEEDS = {"lake":"#2f5f86","forest":"#2f6b4f","terra":"#8a4b2d","violet":"#6750a4","rose":"#984061","cherry":"#ba1a20","tangerine":"#b02e00","amber":"#825500","matcha":"#3c6a00","teal":"#00696b","indigo":"#3d4fd3","orchid":"#a62092","dustyblue":"#78909c","mustard":"#d4a72c","sage":"#9caf88","dustyrose":"#d8a7a7","graphite":"#5e5e5e"};
  var HEX = /^#[0-9a-f]{6}$/;
  var TZ = /^[A-Za-z0-9_+\-\/]{1,64}$/;
  var CACHE_KEY = 'sgx-shell-accent-css';
  var STYLE_ID = 'sgx-accent-roles';
  var MQ = '(prefers-color-scheme: dark)';

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function inList(a, v) { for (var i = 0; i < a.length; i++) if (a[i] === v) return true; return false; }
  function isObj(v) { return !!v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]'; }

  /** base64url(UTF-8 JSON) → 对象；失败返回 null */
  function decode(s) {
    if (!s || typeof s !== 'string' || !/^[A-Za-z0-9_\-]+$/.test(s)) return null;
    try {
      var b = s.replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      return JSON.parse(decodeURIComponent(escape(atob(b))));
    } catch (e) {
      return null;
    }
  }

  /** 对象 → base64url(UTF-8 JSON)（中文城市名先转 UTF-8） */
  function encode(o) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** 从 cookie 串里取 sgx-ui 的原始值；没有返回 '' */
  function raw(cookie) {
    var m = String(cookie == null ? '' : cookie).match(/(?:^|;\s*)sgx-ui=([^;]*)/);
    return m ? m[1] : '';
  }

  /** 色板 id 归一：旧撞色 x<id> → <id>（2026-10-23 PR-G 合并）；不认识 → 默认 */
  function normPal(p) {
    if (typeof p !== 'string') return DEFAULT_PAL;
    if (!has(PRESETS, p) && /^x[a-z]+$/.test(p) && has(PRESETS, p.slice(1))) p = p.slice(1);
    return has(PRESETS, p) ? p : DEFAULT_PAL;
  }

  /** 解码后的对象 → 校验过的对象；不是对象 / 版本不认识返回 null。单个字段不合法就按默认值。 */
  function normalize(o) {
    if (!isObj(o) || typeof o.v !== 'number' || !inList(VERSIONS, o.v)) return null;
    var str = function (v, re, d) { return typeof v === 'string' && re.test(v) ? v : d; };
    return {
      v: o.v,
      mode: inList(MODES, o.mode) ? o.mode : 'system',
      pal: normPal(o.pal),
      accent: str(o.accent, HEX, ''),
      fs: inList(FONT_SIZES, o.fs) ? o.fs : 'standard',
      rm: o.rm === 1 ? 1 : 0,
      mat: typeof o.mat === 'number' && isFinite(o.mat) && o.mat >= 0 ? o.mat : 0,
      tz1: o.tz1 === 'auto' ? 'auto' : str(o.tz1, TZ, 'auto'),
      tz2: str(o.tz2, TZ, ''),
      h12: o.h12 === 1 ? 1 : 0,
      clock: o.clock === 'analog' ? 'analog' : 'digital',
      wx: o.wx === 0 ? 0 : 1,
      unit: o.unit === 'f' ? 'f' : 'c',
      loc: str(o.loc, /^[a-z]{1,16}$/, 'auto'),
      city: isObj(o.city) ? o.city : null,
      precise: isObj(o.precise) ? o.precise : null
    };
  }

  /** 读 sgx-ui（默认 document.cookie）→ 校验过的对象或 null */
  function read(cookie) {
    if (cookie === undefined) {
      try { cookie = g.document.cookie; } catch (e) { cookie = ''; }
    }
    return normalize(decode(raw(cookie)));
  }

  /** 校验过的对象（或 null）+ 系统是否深色 → 要落的外观 */
  function resolve(ui, prefersDark) {
    var mode = ui ? ui.mode : 'system';
    var pal = ui ? ui.pal : DEFAULT_PAL;
    var acc = ui ? ui.accent : '';
    return {
      mode: mode,
      dark: mode === 'dark' || (mode === 'system' && !!prefersDark),
      pal: pal,
      fs: ui ? ui.fs : 'standard',
      rm: !!(ui && ui.rm === 1),
      /* accent 等于该预设的种子 = 预设色板；不等 = 自定义主题色（主站 sgx-accent） */
      seed: acc && acc !== PRESETS[pal] && acc !== LEGACY_SEEDS[pal] ? acc : ''
    };
  }

  function sysDark() {
    try { return !!(g.matchMedia && g.matchMedia(MQ).matches); } catch (e) { return false; }
  }
  function lsGet(k) { try { return g.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { g.localStorage.setItem(k, v); } catch (e) {} }
  function cacheHead(seed) { return SCHEME_VER + '|' + seed + '\n'; }
  function toggle(el, c, on) {
    if (on) el.classList.add(c);
    else el.classList.remove(c);
  }

  function styleEl(doc, create) {
    var el = doc.getElementById(STYLE_ID);
    if (!el && create) {
      el = doc.createElement('style');
      el.id = STYLE_ID;
      (doc.head || doc.documentElement).appendChild(el);
    }
    return el;
  }

  /** 自定义色角色生效 + 缓存（引擎算好后调用） */
  function setRoles(seed, css) {
    if (!HEX.test(seed || '') || typeof css !== 'string') return false;
    var doc = g.document;
    var el = styleEl(doc, true);
    if (el.textContent !== css) el.textContent = css;
    lsSet(CACHE_KEY, cacheHead(seed) + css);
    return true;
  }

  var watching = false;
  var last = null;

  /** 读 cookie 落到 root；返回落下的外观 */
  function apply(root, opts) {
    opts = opts || {};
    var doc = g.document;
    var d = root || doc.documentElement;
    var a = resolve(read(), sysDark());
    try {
      toggle(d, 'dark', a.dark);
      d.setAttribute('data-theme-mode', a.mode);
      d.setAttribute('data-dark', a.dark ? '1' : '0');
      d.style.fontSize = a.fs === 'large' ? '112.5%' : a.fs === 'small' ? '87.5%' : '';
      d.setAttribute('data-font-size', a.fs);
      if (a.pal !== DEFAULT_PAL) d.setAttribute('data-palette', a.pal);
      else d.removeAttribute('data-palette');
      if (a.seed) {
        d.style.setProperty('--sgx-seed', a.seed);
        var c = lsGet(CACHE_KEY) || '';
        var h = cacheHead(a.seed);
        if (c.indexOf(h) === 0) {
          var el = styleEl(doc, true);
          if (el.textContent !== c.slice(h.length)) el.textContent = c.slice(h.length);
        } else if (typeof opts.rolesCss === 'function') {
          setRoles(a.seed, opts.rolesCss(a.seed));
        } else {
          /* 没缓存：先按预设角色渲染（和主站缓存缺失时一样），别处去算 */
          var old = styleEl(doc, false);
          if (old) old.parentNode.removeChild(old);
          if (typeof opts.onMiss === 'function') opts.onMiss(a.seed);
        }
      } else {
        d.style.removeProperty('--sgx-seed');
        var s = styleEl(doc, false);
        if (s) s.parentNode.removeChild(s);
      }
      toggle(d, 'reduced-motion', a.rm);
      d.setAttribute('data-reduced-motion', a.rm ? '1' : '0');
    } catch (e) {}
    last = { root: d, opts: opts };
    if (opts.watch !== false && !watching && g.matchMedia) {
      watching = true;
      try {
        var mq = g.matchMedia(MQ);
        var cb = function () { if (last) apply(last.root, last.opts); };
        if (mq.addEventListener) mq.addEventListener('change', cb);
        else if (mq.addListener) mq.addListener(cb);
      } catch (e) {}
    }
    return a;
  }

  g.SgxUI = {
    NAME: NAME,
    V: V,
    VERSIONS: VERSIONS,
    MODES: MODES,
    FONT_SIZES: FONT_SIZES,
    PRESETS: PRESETS,
    DEFAULT_PAL: DEFAULT_PAL,
    normPal: normPal,
    SCHEME_VER: SCHEME_VER,
    CACHE_KEY: CACHE_KEY,
    STYLE_ID: STYLE_ID,
    decode: decode,
    encode: encode,
    normalize: normalize,
    read: read,
    resolve: resolve,
    apply: apply,
    setRoles: setRoles
  };
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
/* @sgx-shell:end */
