/**
 * 顶栏（沉浸式 app，同博客 BlogTopNav）：这里只管导航抽屉；长条里的分段滑块（余响 · 拾录 · 百味）由 daymark.js 管。
 * - 抽屉（#sgx-drawer，<dialog> 模态）：九宫格打开；点遮罩 / 系统返回 / Esc 关闭。
 *   打开时 push 一条同 URL 的历史哨兵，系统返回只关抽屉不离开页面；点当前项（日刻）只关抽屉，其他项、头部头像（主站账号页）、底栏搜索框（主站搜索）都是关完再跳转。
 */
(function () {
  var doc = document, G = window;
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
        var a = t.closest ? t.closest('a.sgx-drawer-item, a.sgx-drawer-me, a.sgx-drawer-search') : null;
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

})();
