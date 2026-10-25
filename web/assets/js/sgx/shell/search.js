/* @sgx-shell:begin styrigx/styrigx-space@main web/shared/shell v23673824df0b（scripts/sync-shell.mjs 写入，勿手改） */
/* ---- search.js ---- */
/**
 * @fileoverview 原地搜索层（共享外壳组件，2026-10-22；主站和三个子站同一份，子站原样复制）。
 *
 * 取代原来的全网搜索页 /search/：点导航抽屉底栏的搜索框长条，抽屉原地淡掉，那条长条在原地变成屏幕底部的
 * 搜索栏（长条药丸「搜索」+ 右边单独的 ✕ 圆，和以前 /search/ 页底栏一样），贴着键盘；
 * 上方是盖在当前页上的磨砂结果层（空输入 = 中间一个搜索图标 +「聚合搜索」；有输入 = 站内结果 / 「用 <引擎> 搜索」），当前页和顶栏原样不动。
 * 2026-10-22：最近搜索删掉（用户：不需要），输入框占位文字统一叫「搜索」；旧的 sgx-browser-history 由 baseof 清掉。
 * ✕ / 系统返回 / Esc 关掉，回到原来的页面。
 *
 * 自成一体：不 import 任何东西，DOM 自己建，样式在 shell.css 的 search 段（只用 --sgx-* 角色）。
 * 页面用法（详见 web/shared/shell/README.md「搜索层」）：
 *   const s = mountSearch({ lang: 'zh', index: '/files-index.json' });
 *   // 必须在点击事件里同步调用（安卓只有在用户手势里同步 focus 才弹键盘）：
 *   s.open({ from: 抽屉里的搜索框元素, ghost: 抽屉 <dialog>, handoff: () => 关抽屉并返回「是否把抽屉的历史哨兵留给我」 });
 *
 * 历史：打开最多占一条同 URL 的历史（state.sgxSearch=1）。handoff() 返回 true 时直接把抽屉的哨兵改成自己的
 * （replaceState，不新增），否则 pushState 一条。系统返回 = 哨兵出栈 → 只关搜索层；✕ = 关层并退掉哨兵。
 * 永远不会叠出多条。
 */

/** @typedef {{ t: string, d: string, u: string, type: string }} Hit */
/**
 * @typedef {Object} SearchConfig
 * @property {'zh'|'en'} [lang] 文案语言（默认按 <html lang>）
 * @property {string|null} [index] 站内索引地址（files-index.json 格式：{ items: [{ type, lang, title, subtitle, url }] }）；null = 只有引擎搜索
 * @property {string|null} [api] 全站搜索接口（/api/search，网关验会话后转 styrigx-search）；有就优先用它的结果，失败退回 index
 * @property {Array<{type: string, zh: string, en: string}>} [types] 索引里要列出的类型和分组名（按这个顺序）
 * @property {string} [engineKey] 搜索引擎设置的 localStorage 键（默认 sgx-search-engine；没有值 = Google）
 * @property {() => string} [engine] 自己给当前引擎 id（google / bing / duckduckgo / yahoo / ecosia），优先于 engineKey
 * @property {(url: string) => void} [navigate] 打开同源结果（默认 location.href = url）
 * @property {Record<string, string>} [strings] 覆盖文案（键见 STR）
 * @property {HTMLElement} [root] 挂到哪里（默认 document.body）
 */
/**
 * @typedef {Object} OpenOptions
 * @property {Element} [from] 从哪个元素变形出来（抽屉底栏的搜索框）；没有 = 底栏从下面升起
 * @property {Element} [ghost] 正在关掉的抽屉 <dialog>（里面的 .sgx-drawer-sheet 复制一份原地淡出，顶栏一直在）
 * @property {() => boolean} [handoff] 同步关掉打开它的弹层；返回 true = 那层的历史哨兵留给搜索层（不再新增历史）
 * @property {string} [q] 预填
 * @property {boolean} [focus] 默认 true
 */

const STR = {
  zh: {
    ph: '搜索', label: '搜索', close: '关闭搜索', clear: '清空', empty: '聚合搜索',
    searchWith: '用 {n} 搜索', results: '搜索结果',
  },
  en: {
    ph: 'Search', label: 'Search', close: 'Close search', clear: 'Clear', empty: 'Unified search',
    searchWith: 'Search with {n}', results: 'Search results',
  },
};

/* 与主站 shell/engines.js 同一张表（单测核对） */
/** @type {Record<string, {n: string, u: string}>} */
export const ENGINES = {
  google: { n: 'Google', u: 'https://www.google.com/search?q=%s' },
  bing: { n: 'Bing', u: 'https://www.bing.com/search?q=%s' },
  duckduckgo: { n: 'DuckDuckGo', u: 'https://duckduckgo.com/?q=%s' },
  yahoo: { n: 'Yahoo', u: 'https://search.yahoo.com/search?p=%s' },
  ecosia: { n: 'Ecosia', u: 'https://www.ecosia.org/search?q=%s' },
};

/* 回车规则（与原 /search/ 页相同）：像网址（有点、没有空格、没有中日韩字）→ 新标签打开 https://… */
export const URL_RE = /^[^\s]+\.[^\s]{2,}$/;
const HAS_CJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;
/** @param {string} q */
export function looksLikeUrl(q) {
  return URL_RE.test(q) && !HAS_CJK.test(q);
}

/** 变形 / 淡入淡出时长（ms） */
export const MORPH_MS = 180;
const FADE_MS = 160;

/** @param {string} s */
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return /** @type {Record<string,string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}
/** @param {string} k @returns {string|null} */
function lsGet(k) {
  try {
    return localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function reduced() {
  return (
    document.documentElement.classList.contains('reduced-motion') ||
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/* 和抽屉底栏搜索框同一个图标（nav.json 的 ai-search：放大镜 + 右上角四角星），2026-10-22 用户要求统一 */
const IC_SEARCH = '<svg class="sgx-srch-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.9 9.6A6 6 0 1 1 11.6 7.2"/><path d="M14.3 17.3L19.5 22.5"/><path d="M18.5 1.8c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z" fill="currentColor" stroke-width="1.2"/></svg>';
const IC_CLEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="var(--sgx-surface)" stroke-width="2" stroke-linecap="round"/></svg>';
const IC_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const IC_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6"/></svg>';

/**
 * 建一个搜索层（每页一次）。
 * @param {SearchConfig} [cfg]
 */
export function mountSearch(cfg) {
  cfg = cfg || {};
  const lang = cfg.lang || (document.documentElement.lang === 'en' ? 'en' : 'zh');
  /** @type {Record<string,string>} */
  const T = Object.assign({}, STR[lang] || STR.zh, cfg.strings || {});
  const EKEY = cfg.engineKey || 'sgx-search-engine';
  const TYPES = cfg.types || [];
  const navigate = cfg.navigate || function (/** @type {string} */ u) { location.href = u; };
  const root = cfg.root || document.body;

  /* ============ DOM ============ */
  const layer = document.createElement('div');
  layer.className = 'sgx-srch';
  layer.hidden = true;
  layer.setAttribute('role', 'region');
  layer.setAttribute('aria-label', T.results);
  /* 空输入时的背景：和底栏同一个放大镜 +「聚合搜索」，在顶栏和底栏（含键盘）之间居中（三星信息的搜索页那样） */
  layer.innerHTML = '<div class="sgx-srch-empty" aria-hidden="true">' + IC_SEARCH.replace('sgx-srch-ic', 'sgx-srch-empty-ic') + '<span class="sgx-srch-empty-tx">' + esc(T.empty) + '</span></div>' +
    '<div class="sgx-srch-scroll"><div class="sgx-srch-page" id="sgx-srch-list" role="listbox" aria-label="' + esc(T.results) + '"></div></div>';
  const emptyEl = /** @type {HTMLElement} */ (layer.firstElementChild);
  const scroller = /** @type {HTMLElement} */ (emptyEl.nextElementSibling);
  const list = /** @type {HTMLElement} */ (scroller.firstElementChild);

  const bar = document.createElement('div');
  bar.className = 'sgx-srch-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'search');
  bar.innerHTML =
    '<div class="sgx-srch-bar-in">' +
    '<div class="sgx-srch-pill">' + IC_SEARCH +
    '<input id="sgx-srch-input" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="' + esc(T.ph) + '" aria-label="' + esc(T.ph) + '"' +
    ' role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="sgx-srch-list">' +
    '<button type="button" class="sgx-srch-clear" data-srch-clear-input aria-label="' + esc(T.clear) + '" hidden>' + IC_CLEAR + '</button>' +
    '</div>' +
    '<button type="button" class="sgx-srch-close" data-srch-close aria-label="' + esc(T.close) + '">' + IC_CLOSE + '</button>' +
    '</div>';
  const barIn = /** @type {HTMLElement} */ (bar.firstElementChild);
  const pill = /** @type {HTMLElement} */ (barIn.querySelector('.sgx-srch-pill'));
  const input = /** @type {HTMLInputElement} */ (bar.querySelector('input'));
  const clearBtn = /** @type {HTMLElement} */ (bar.querySelector('[data-srch-clear-input]'));
  const closeBtn = /** @type {HTMLElement} */ (bar.querySelector('[data-srch-close]'));
  root.appendChild(layer);
  root.appendChild(bar);

  /* ============ 引擎 ============ */
  function engineId() {
    let id = '';
    try {
      id = cfg && cfg.engine ? cfg.engine() : lsGet(EKEY) || '';
    } catch (e) {}
    return ENGINES[id] ? id : 'google';
  }
  /** @param {string} q */
  function engineUrl(q) {
    return ENGINES[engineId()].u.replace('%s', encodeURIComponent(q));
  }

  /* ============ 站内索引（第一次打开时才取） ============ */
  /** @type {Hit[]} */
  let INDEX = [];
  let indexAsked = false;
  function loadIndex() {
    if (indexAsked || !cfg || !cfg.index) return;
    indexAsked = true;
    const wanted = TYPES.map(function (x) { return x.type; });
    fetch(cfg.index, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('bad status ' + r.status);
        return r.json();
      })
      .then(function (j) {
        INDEX = ((j && j.items) || [])
          .filter(function (/** @type {any} */ x) {
            return x && wanted.indexOf(x.type) !== -1 && (x.lang || 'zh') === lang;
          })
          .map(function (/** @type {any} */ x) {
            return { t: x.title || '', d: x.subtitle || '', u: x.url || '', type: x.type };
          });
        if (isOpen() && input.value.trim()) render();
      })
      .catch(function () { indexAsked = false; /* 拿不到索引：只剩引擎搜索，下次打开再试 */ });
  }

  /* ============ 全站搜索接口（有 cfg.api 时；打一个字防抖 150ms，旧回答作废） ============ */
  /** @type {{q: string, hits: Hit[]}|null} */
  let apiRes = null;
  let apiDown = false;
  let apiTimer = 0;
  let apiSeq = 0;
  /** @param {string} q */
  function askApi(q) {
    if (!cfg || !cfg.api || apiDown) return;
    window.clearTimeout(apiTimer);
    if (!q) return;
    const seq = ++apiSeq;
    apiTimer = window.setTimeout(function () {
      fetch(cfg.api + '?q=' + encodeURIComponent(q) + '&lang=' + lang + '&limit=30', { credentials: 'same-origin' })
        .then(function (r) {
          if (r.status === 401 || r.status === 404) apiDown = true; /* 没会话 / 没这个接口：这次打开只用本地索引 */
          if (!r.ok) throw new Error('bad status ' + r.status);
          return r.json();
        })
        .then(function (j) {
          if (seq !== apiSeq) return;
          apiRes = {
            q: q,
            hits: ((j && j.hits) || []).map(function (/** @type {any} */ x) {
              return { t: String(x.title || ''), d: String(x.subtitle || ''), u: String(x.url || ''), type: String(x.type || '') };
            }),
          };
          if (isOpen() && input.value.trim() === q) render();
        })
        .catch(function () {});
    }, 150);
  }

  /* ============ 渲染 ============ */
  /** @param {string} text @param {string} q */
  function hl(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark class="sgx-srch-hl">' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  /** 当前可用方向键选的行 */
  let active = -1;
  /** @returns {HTMLElement[]} */
  function rows() {
    return /** @type {HTMLElement[]} */ (Array.prototype.slice.call(list.querySelectorAll('[data-srch-u], [data-srch-engine]')));
  }
  /** @param {number} i */
  function setActive(i) {
    const rs = rows();
    if (!rs.length) i = -1;
    else if (i >= rs.length) i = 0;
    else if (i < -1) i = rs.length - 1;
    active = i;
    rs.forEach(function (r, k) {
      r.classList.toggle('is-active', k === i);
      r.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', rs[i].id);
      try { rs[i].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    } else input.removeAttribute('aria-activedescendant');
  }

  function renderEmpty() {
    list.innerHTML = '';
    emptyEl.hidden = false;
  }
  /** @type {Hit[]} */
  let hits = [];
  function render() {
    const q = input.value.trim();
    clearBtn.hidden = input.value.length === 0;
    hits = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    if (!q) {
      renderEmpty();
      return;
    }
    emptyEl.hidden = true;
    const ql = q.toLowerCase();
    /* 接口对这句话的回答到了就用它（已按相关度排好），否则先用本地索引顶着 */
    const fromApi = apiRes && apiRes.q === q ? apiRes.hits : null;
    if (!fromApi) askApi(q);
    let h = '';
    let n = 0;
    TYPES.forEach(function (c) {
      const hs = (fromApi
        ? fromApi.filter(function (x) { return x.type === c.type; })
        : INDEX.filter(function (x) {
          return x.type === c.type && (x.t + ' ' + (x.d || '')).toLowerCase().indexOf(ql) !== -1;
        })).slice(0, 5);
      if (!hs.length) return;
      h += '<div class="sgx-srch-card" role="group" aria-label="' + esc(lang === 'en' ? c.en : c.zh) + '"><div class="sgx-srch-card-head">' + esc(lang === 'en' ? c.en : c.zh) + '</div>';
      hs.forEach(function (x) {
        hits.push(x);
        h +=
          '<button type="button" class="sgx-srch-item" role="option" aria-selected="false" id="sgx-srch-o' + n++ + '" data-srch-u="' + esc(x.u) + '">' +
          '<span class="sgx-srch-item-tx"><span class="sgx-srch-item-t">' + hl(x.t, ql) + '</span>' +
          (x.d ? '<span class="sgx-srch-item-d">' + hl(x.d, ql) + '</span>' : '') +
          '</span>' + IC_CHEV + '</button>';
      });
      h += '</div>';
    });
    h +=
      '<div class="sgx-srch-card"><button type="button" class="sgx-srch-item" role="option" aria-selected="false" id="sgx-srch-o' + n + '" data-srch-engine>' +
      '<span class="sgx-srch-item-tx"><span class="sgx-srch-item-t">' + esc(T.searchWith.replace('{n}', ENGINES[engineId()].n)) + ' “' + esc(q) + '”</span></span>' + IC_CHEV + '</button></div>';
    list.innerHTML = h;
  }

  /* ============ 打开结果 / 搜索 ============ */
  /** @param {string} u */
  function openUrl(u) {
    if (!u) return;
    let same = true;
    let sibling = false;
    try {
      const t = new URL(u, location.href);
      same = t.origin === location.origin;
      /* 全站搜索的结果可能在兄弟站（blog / daymark / curio）：同一个人的站，当前标签页跳过去 */
      sibling = !same && t.protocol === 'https:' && /(^|\.)styrigx\.com$/.test(t.hostname);
    } catch (e) {}
    if (sibling) {
      close(function () { location.href = u; });
      return;
    }
    if (!same) {
      window.open(u, '_blank', 'noopener');
      return;
    }
    /* 站内：先关层、退掉哨兵，出栈后再跳（目标页的返回不多一步） */
    close(function () { navigate(u); });
  }
  /** 像网址 → 新标签打开；否则用当前引擎搜（新标签）。@param {string} q */
  function doSearch(q) {
    q = (q || '').trim();
    if (!q) return;
    window.open(looksLikeUrl(q) ? (/^https?:\/\//i.test(q) ? q : 'https://' + q) : engineUrl(q), '_blank', 'noopener');
  }
  /* 回车：方向键选中的行 → 打开它；标题和输入完全一样的站内结果 → 直接打开；否则按网址 / 引擎搜索 */
  function onEnter() {
    const q = input.value.trim();
    if (!q) return;
    const rs = rows();
    if (active >= 0 && rs[active]) {
      rs[active].click();
      return;
    }
    const ql = q.toLowerCase();
    const pool = apiRes && apiRes.q === q ? apiRes.hits.concat(INDEX) : INDEX;
    const exact = pool.find(function (x) { return x.t.toLowerCase() === ql; });
    if (exact) {
      openUrl(exact.u);
      return;
    }
    doSearch(q);
    try { input.blur(); } catch (e) {} /* 收键盘，底栏落回底部 */
    render();
  }

  input.addEventListener('input', render);
  input.addEventListener('keydown', function (e) {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!rows().length) return;
      e.preventDefault();
      setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  /* 触屏点输入框：自己聚焦并禁止浏览器把页面滚上去（页面全程不动） */
  input.addEventListener('touchstart', function (e) {
    if (document.activeElement === input) return;
    try { e.preventDefault(); } catch (err) {}
    focusInput();
  }, { passive: false });
  /* 点工具按钮 / 结果不抢输入框焦点（键盘不收） */
  [clearBtn, closeBtn].forEach(function (b) {
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  });
  layer.addEventListener('pointerdown', function (e) {
    const t = /** @type {Element|null} */ (e.target);
    if (t && t.closest && t.closest('button')) e.preventDefault();
  });
  clearBtn.addEventListener('click', function () {
    input.value = '';
    render();
    focusInput();
  });
  closeBtn.addEventListener('click', function () { close(); });
  list.addEventListener('click', function (e) {
    const t = /** @type {Element|null} */ (e.target);
    if (!t || !t.closest) return;
    if (t.closest('[data-srch-engine]')) {
      doSearch(input.value);
      render();
      return;
    }
    const it = t.closest('[data-srch-u]');
    if (it) {
      openUrl(it.getAttribute('data-srch-u') || '');
    }
  });
  window.addEventListener('sgx-settings-changed', function () { if (isOpen()) render(); });
  window.addEventListener('storage', function (e) { if (isOpen() && e.key === EKEY) render(); });

  function focusInput() {
    try {
      input.focus({ preventScroll: true });
    } catch (e) {
      try { input.focus(); } catch (_) {}
    }
  }

  /* ============ 键盘：底栏贴着键盘（VirtualKeyboard API 或 visualViewport） ============ */
  /** @type {Array<() => void>} */
  let kbOff = [];
  let kbMax = 0;
  /** @param {number} h */
  function setKb(h) {
    h = Math.max(0, Math.round(h || 0));
    if (h > kbMax) kbMax = h;
    bar.style.setProperty('--sgx-srch-kb', h + 'px');
    layer.style.setProperty('--sgx-srch-kb', h + 'px');
    /* 键盘被收起（返回手势 / 键盘上的收起键）：输入框跟着失焦，底栏落回底部，搜索层留着 */
    if (kbMax > 0 && h <= 2 && document.activeElement === input) {
      kbMax = 0;
      try { input.blur(); } catch (e) {}
    }
  }
  function kbStart() {
    kbStop();
    kbMax = 0;
    const vk = /** @type {any} */ (navigator).virtualKeyboard;
    if (vk && 'overlaysContent' in vk) {
      /* 在 focus 之前设好：键盘浮在页面上，不缩视口，页面和顶栏不重排 */
      const prev = !!vk.overlaysContent;
      try { vk.overlaysContent = true; } catch (e) {}
      /** @param {any} e */
      const geo = function (e) {
        setKb((e && e.target && e.target.boundingRect && e.target.boundingRect.height) || 0);
      };
      vk.addEventListener('geometrychange', geo);
      kbOff.push(function () {
        vk.removeEventListener('geometrychange', geo);
        try { vk.overlaysContent = prev; } catch (e) {}
      });
      try { setKb(vk.boundingRect.height || 0); } catch (e) {}
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const upd = function () {
      raf = 0;
      setKb(window.innerHeight - vv.height - vv.offsetTop);
    };
    const sched = function () { if (!raf) raf = requestAnimationFrame(upd); };
    vv.addEventListener('resize', sched);
    vv.addEventListener('scroll', sched);
    kbOff.push(function () {
      vv.removeEventListener('resize', sched);
      vv.removeEventListener('scroll', sched);
      if (raf) cancelAnimationFrame(raf);
    });
  }
  function kbStop() {
    kbOff.forEach(function (f) { try { f(); } catch (e) {} });
    kbOff = [];
    setKb(0);
  }

  /* ============ 开 / 关 ============ */
  let open_ = false;
  /** 历史里当前这条是不是搜索层的哨兵（关的时候退掉它） */
  let ours = false;
  /** @type {null | (() => void)} 等哨兵出栈后执行 */
  let awaiting = null;
  /** @type {Animation[]} */
  let anims = [];
  /** @type {number|null} */
  let hideTimer = null;
  /** @type {number|null} */
  let morphTimer = null;

  function isOpen() {
    return open_;
  }
  function stopAnims() {
    anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    anims = [];
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    if (morphTimer) clearTimeout(morphTimer);
    morphTimer = null;
    bar.classList.remove('is-morph');
  }
  /** @param {Element} el @param {Keyframe[]} kf @param {number} ms */
  function anim(el, kf, ms) {
    if (typeof el.animate !== 'function') return null;
    const a = el.animate(kf, { duration: ms, easing: 'cubic-bezier(.2,0,0,1)', fill: 'backwards' });
    anims.push(a);
    return a;
  }

  /**
   * 抽屉面板复制一份原地淡出（抽屉 <dialog> 已经同步关掉，输入框才能拿到焦点）。
   * 复制件盖在顶栏上面、从当前样子淡到透明：顶栏本身一直在、不重绘、不闪；那条搜索框长条在复制件里藏起来（它变成了底栏）。
   * @param {Element} dlg
   */
  function ghostOf(dlg) {
    const sheet = dlg.querySelector('.sgx-drawer-sheet');
    if (!sheet) return null;
    const g = document.createElement('div');
    g.className = 'sgx-drawer is-open sgx-srch-ghost';
    g.setAttribute('aria-hidden', 'true');
    g.setAttribute('inert', '');
    const c = /** @type {HTMLElement} */ (sheet.cloneNode(true));
    c.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
    const ps = c.querySelectorAll('.sgx-drawer-search');
    ps.forEach(function (n) { /** @type {HTMLElement} */ (n).style.visibility = 'hidden'; });
    g.appendChild(c);
    const b0 = sheet.querySelector('.sgx-drawer-body');
    const st = b0 ? b0.scrollTop : 0;
    return { g: g, st: st };
  }

  /** @param {OpenOptions} [o] */
  function open(o) {
    apiDown = false; /* 每次打开重新试一次接口（可能刚解锁） */
    o = o || {};
    const motion = !reduced();
    /* 1. 量起点、复制抽屉（抽屉还开着时） */
    const fromR = o.from && motion ? o.from.getBoundingClientRect() : null;
    const gh = o.ghost && motion ? ghostOf(o.ghost) : null;
    /* 2. 关掉打开它的弹层（同步；模态 <dialog> 关了页面才可聚焦） */
    let reuse = false;
    if (o.handoff) {
      try { reuse = !!o.handoff(); } catch (e) {}
    }
    if (gh) {
      document.body.appendChild(gh.g);
      const b1 = gh.g.querySelector('.sgx-drawer-body');
      if (b1) b1.scrollTop = gh.st;
    }
    stopAnims();
    const wasOpen = open_;
    open_ = true;
    layer.hidden = false;
    bar.hidden = false;
    layer.classList.remove('is-closing');
    bar.classList.remove('is-closing');
    document.documentElement.classList.add('sgx-srch-open');
    if (typeof o.q === 'string') input.value = o.q;
    /* 3. 键盘跟随先挂好，再在这次点击里同步聚焦（安卓才会弹键盘） */
    if (!wasOpen) kbStart();
    if (o.focus !== false) focusInput();
    render();
    loadIndex();
    /* 4. 历史：最多一条 */
    if (!wasOpen) {
      try {
        if (reuse) history.replaceState({ sgxSearch: 1 }, '', location.href);
        else history.pushState({ sgxSearch: 1 }, '', location.href);
        ours = true;
      } catch (e) {
        ours = false;
      }
    }
    /* 5. 动画：长条从抽屉搜索框原地变成底栏药丸，✕ 圆跟着长出来，结果层淡入，抽屉复制件淡出 */
    if (motion && !wasOpen) {
      if (fromR) {
        const to = pill.getBoundingClientRect();
        if (to.width && to.height) {
          const dx = fromR.left - to.left, dy = fromR.top - to.top;
          const sx = fromR.width / to.width, sy = fromR.height / to.height;
          anim(pill, [{ transformOrigin: '0 0', transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')' }, { transformOrigin: '0 0', transform: 'none' }], MORPH_MS);
        }
        anim(closeBtn, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], MORPH_MS);
        /* 变形期间底栏压在抽屉复制件上面（复制件盖着顶栏淡出） */
        bar.classList.add('is-morph');
        morphTimer = window.setTimeout(function () { morphTimer = null; bar.classList.remove('is-morph'); }, MORPH_MS + 20);
      } else {
        anim(barIn, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], MORPH_MS);
      }
      anim(layer, [{ opacity: 0 }, { opacity: 1 }], FADE_MS);
    }
    if (gh) {
      const g = gh.g;
      const done = function () { if (g.parentNode) g.parentNode.removeChild(g); };
      const a = typeof g.animate === 'function' ? g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' }) : null;
      if (a) a.onfinish = done;
      /* 兜底：后台标签页 / 动画被打断时 finish 可能不来 */
      window.setTimeout(done, FADE_MS + 400);
    }
  }

  /** 只收界面，不动历史 */
  function hide() {
    if (!open_) return;
    open_ = false;
    stopAnims();
    try { if (document.activeElement === input) input.blur(); } catch (e) {}
    kbStop();
    document.documentElement.classList.remove('sgx-srch-open');
    const fin = function () {
      hideTimer = null;
      if (open_) return;
      layer.hidden = true;
      bar.hidden = true;
      layer.classList.remove('is-closing');
      bar.classList.remove('is-closing');
      list.innerHTML = '';
    };
    if (reduced()) {
      fin();
      return;
    }
    layer.classList.add('is-closing');
    bar.classList.add('is-closing');
    hideTimer = window.setTimeout(fin, FADE_MS);
  }
  /**
   * 关闭并退掉自己的历史哨兵；after 在哨兵出栈后执行（跳转用）。
   * @param {() => void} [after]
   */
  function close(after) {
    if (!open_) {
      if (after) after();
      return;
    }
    hide();
    if (ours && history.state && history.state.sgxSearch) {
      ours = false;
      awaiting = after || function () {};
      history.back();
    } else {
      ours = false;
      if (after) after();
    }
  }
  /* 系统返回：哨兵出栈 → 只关搜索层（停在本页） */
  window.addEventListener('popstate', function () {
    if (awaiting) {
      const fn = awaiting;
      awaiting = null;
      fn();
      return;
    }
    if (!open_) return;
    if (history.state && history.state.sgxSearch) return;
    ours = false;
    hide();
  });
  /* bfcache 恢复：一律收起 */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && open_) {
      ours = false;
      awaiting = null;
      hide();
    }
  });
  /* 焦点不在输入框时的 Esc */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open_ && !e.defaultPrevented && e.target !== input) {
      e.preventDefault();
      close();
    }
  });

  return { open: open, close: close, isOpen: isOpen, input: input, layer: layer, bar: bar };
}
/* @sgx-shell:end */
