/**
 * 顶栏（与主站 styrigx-space 通版 v5 同一套）：导航抽屉、长条搜索图标、快捷面板。
 * - 抽屉（#sgx-drawer，<dialog> 模态）：九宫格打开；点遮罩 / 系统返回 / Esc 关闭。
 *   打开时 push 一条同 URL 的历史哨兵，系统返回只关抽屉不离开页面；点当前项（日刻）只关抽屉，其他项关完再跳转。
 * - 搜索图标：聚焦并滚到底部搜索胶囊（#bk-cap-input），没有胶囊的页面回日刻首页。
 * - 快捷面板（#sgx-qp）：顶栏下内嵌展开，正文下移（CSS grid-template-rows 0fr ↔ 1fr）；
 *   再点图标 / 在面板上上滑 > 40px / Esc 收起，离开本页一律收起。
 *   深色 / 跟随系统写本站 sgx-theme-mode + sgx-theme-at（与主站 cookie 谁后改听谁的，见 ui-inherit.js），语言切到另一种语言的同一页。
 */
(function () {
  var doc = document, G = window;
  var en = doc.documentElement.lang === 'en';
  function reduced() {
    return doc.documentElement.classList.contains('reduced-motion') ||
      !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------- 导航抽屉 ---------- */
  (function () {
    var btn = doc.querySelector('.sgx-tb-nav');
    var dlg = doc.getElementById('sgx-drawer');
    if (!btn || !dlg || typeof dlg.showModal !== 'function') return;
    var sheet = dlg.querySelector('.sgx-drawer-sheet');
    var MS = 220, open = false, sentinel = false, timer = 0, after = null;

    function show() {
      if (open) return;
      open = true; clearTimeout(timer);
      try { dlg.showModal(); } catch (e) { open = false; return; }
      btn.setAttribute('aria-expanded', 'true');
      try { history.pushState({ sgxDrawer: 1 }, ''); sentinel = true; } catch (e) {}
      requestAnimationFrame(function () { requestAnimationFrame(function () { dlg.classList.add('is-open'); }); });
    }
    function finish() {
      try { dlg.close(); } catch (e) {}
      var fn = after; after = null;
      if (fn) fn();
      else { try { btn.focus({ preventScroll: true }); } catch (e) {} }
    }
    /* fromPop：系统返回触发（哨兵已出栈）；否则自己把哨兵退掉 */
    function hide(fn, fromPop) {
      if (!open) return;
      open = false; after = fn || null;
      btn.setAttribute('aria-expanded', 'false');
      dlg.classList.remove('is-open');
      if (sentinel) {
        sentinel = false;
        if (!fromPop) { try { history.back(); } catch (e) {} }
      }
      clearTimeout(timer);
      timer = setTimeout(finish, reduced() ? 80 : MS);
    }
    G.addEventListener('popstate', function () { if (open) hide(null, true); });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); hide(); });
    btn.addEventListener('click', function (e) { e.stopPropagation(); if (open) hide(); else show(); });
    dlg.addEventListener('click', function (e) {
      var t = e.target;
      if (sheet && sheet.contains(t)) {
        var a = t.closest ? t.closest('a.sgx-drawer-item') : null;
        if (!a) return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (a.getAttribute('aria-current') === 'page') { hide(); return; }
        var href = a.href;
        /* 等哨兵出栈后再跳，避免 history.back() 吃掉跳转 */
        hide(function () { setTimeout(function () { location.href = href; }, 60); });
        return;
      }
      hide();
    });
    G.addEventListener('pageshow', function (e) {
      if (e.persisted && open) { open = false; sentinel = false; dlg.classList.remove('is-open'); try { dlg.close(); } catch (er) {} btn.setAttribute('aria-expanded', 'false'); }
    });
  })();

  /* ---------- 长条搜索图标 ---------- */
  (function () {
    var btn = doc.getElementById('sgx-tb-search');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var input = doc.getElementById('bk-cap-input');
      if (!input) { location.href = en ? '/en/' : '/'; return; }
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    });
  })();

  /* ---------- 快捷面板 ---------- */
  (function () {
    var btn = doc.querySelector('.sgx-tb-quick');
    var qp = doc.getElementById('sgx-qp');
    if (!btn || !qp) return;
    var sheet = qp.querySelector('.sgx-qp-sheet');
    var MS = 250, timer = 0;
    var T = en ? { on: 'On', off: 'Off' } : { on: '已开启', off: '已关闭' };

    function mode() {
      var m = doc.documentElement.getAttribute('data-theme-mode');
      return m === 'light' || m === 'dark' ? m : 'system';
    }
    function isDark() { return doc.documentElement.classList.contains('dark'); }
    function setMode(m) {
      try { localStorage.setItem('sgx-theme-mode', m); localStorage.setItem('sgx-theme-at', String(Date.now())); } catch (e) {}
      if (G.__sgxApplyUi) G.__sgxApplyUi();
      else doc.documentElement.classList.toggle('dark', m === 'dark' || (m === 'system' && G.matchMedia('(prefers-color-scheme: dark)').matches));
      paint();
    }
    function paintToggle(id, on) {
      var el = qp.querySelector('[data-qp="' + id + '"]');
      if (!el) return;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      var st = el.querySelector('[data-qp-state]');
      if (st) st.textContent = on ? T.on : T.off;
    }
    function paint() {
      paintToggle('dark', isDark());
      paintToggle('system', mode() === 'system');
    }
    if (G.matchMedia) {
      var mq = G.matchMedia('(prefers-color-scheme: dark)');
      var onSys = function () { if (mode() === 'system' && G.__sgxApplyUi) G.__sgxApplyUi(); paint(); };
      if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
    }

    qp.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-qp]') : null;
      if (!t) return;
      var id = t.getAttribute('data-qp');
      if (id === 'dark') setMode(isDark() ? 'light' : 'dark');
      else if (id === 'system') setMode(mode() === 'system' ? (isDark() ? 'dark' : 'light') : 'system');
      else if (id === 'lang') {
        var p = location.pathname;
        var to = en ? (p.replace(/^\/en(\/|$)/, '/') || '/') : '/en' + (p === '/' ? '/' : p);
        location.replace(to + location.search);
      }
    });

    function isOpen() { var s = qp.getAttribute('data-state'); return s === 'open' || s === 'opening'; }
    function openQp() {
      clearTimeout(timer);
      paint();
      qp.removeAttribute('inert');
      qp.setAttribute('data-state', 'opening');
      btn.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(function () { requestAnimationFrame(function () { qp.classList.add('is-open'); }); });
      timer = setTimeout(function () {
        qp.setAttribute('data-state', 'open');
        var first = qp.querySelector('.sgx-qp-tile');
        if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
      }, reduced() ? 0 : MS);
    }
    function closeQp(focusBtn) {
      clearTimeout(timer);
      qp.setAttribute('data-state', 'closing');
      qp.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      timer = setTimeout(function () {
        qp.setAttribute('data-state', 'closed');
        qp.setAttribute('inert', '');
      }, reduced() ? 0 : MS);
      if (focusBtn) { try { btn.focus({ preventScroll: true }); } catch (e) {} }
    }
    btn.addEventListener('click', function () { if (isOpen()) closeQp(true); else openQp(); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen() && !doc.querySelector('dialog[open]')) closeQp(true);
    });
    /* 上滑收起：在面板上竖直上拖 > 40px */
    var y0 = null, x0 = 0;
    if (sheet) {
      sheet.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; } }, { passive: true });
      sheet.addEventListener('touchmove', function (e) {
        if (y0 === null || !isOpen()) return;
        var dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
        if (dy < -40 && Math.abs(dy) > Math.abs(dx)) { y0 = null; closeQp(true); }
      }, { passive: true });
      sheet.addEventListener('touchend', function () { y0 = null; }, { passive: true });
    }
    G.addEventListener('pageshow', function (e) {
      if (e.persisted && isOpen()) { clearTimeout(timer); qp.classList.remove('is-open'); qp.setAttribute('data-state', 'closed'); qp.setAttribute('inert', ''); btn.setAttribute('aria-expanded', 'false'); }
    });
    paint();
  })();
})();
