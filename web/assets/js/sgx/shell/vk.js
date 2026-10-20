/**
 * @fileoverview 2.4.0 D：VirtualKeyboard 统一封装（合并 capsule.js / page-browser.js 重复实现）。
 * - 有 VirtualKeyboard API（Chrome）：overlaysContent=true，键盘悬浮不顶页面；
 *   geometrychange → 回调键盘高度 h（px）。
 * - 无 API：visualViewport resize/scroll → rAF 节流 → 回调估算高度。
 * 返回 disposer 数组的清理函数。
 */

/**
 * 订阅键盘高度变化。
 * @param {(h: number) => void} cb 键盘高度（px）变化回调
 * @param {HTMLElement} [syncEl] 无 VK API 时需要加 .sgx-kb-sync 类做 transform 跟随的元素
 * @returns {() => void} 清理函数
 */
export function onKeyboardHeight(cb, syncEl) {
  /** @type {Array<() => void>} */ const disposers = [];
  let useVK = false;
  try {
    const vk = /** @type {any} */ (navigator).virtualKeyboard;
    if (vk && 'overlaysContent' in vk) {
      vk.overlaysContent = true;
      useVK = true;
    }
  } catch (e) {}
  if (useVK) {
    document.documentElement.classList.add('sgx-vk');
    /** @param {any} e */
    const onGeo = function (e) {
      let h = 0;
      try {
        h = (e.target && e.target.boundingRect && e.target.boundingRect.height) || 0;
      } catch (_) {}
      cb(Math.max(0, h));
    };
    try {
      /** @type {any} */ (navigator).virtualKeyboard.addEventListener('geometrychange', onGeo);
    } catch (e) {}
    disposers.push(function () {
      try {
        /** @type {any} */ (navigator).virtualKeyboard.removeEventListener('geometrychange', onGeo);
      } catch (e) {}
    });
    cb(0);
  } else {
    const vv = window.visualViewport;
    if (!vv) return function () {};
    if (syncEl) syncEl.classList.add('sgx-kb-sync');
    let raf = 0;
    const upd = function () {
      raf = 0;
      const h = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      cb(h);
    };
    const sched = function () {
      if (!raf) raf = requestAnimationFrame(upd);
    };
    vv.addEventListener('resize', sched);
    vv.addEventListener('scroll', sched);
    disposers.push(function () {
      vv.removeEventListener('resize', sched);
      vv.removeEventListener('scroll', sched);
      if (raf) cancelAnimationFrame(raf);
      if (syncEl) syncEl.classList.remove('sgx-kb-sync');
    });
    sched();
  }
  return function () {
    disposers.forEach(function (d) {
      try {
        d();
      } catch (e) {}
    });
  };
}

/**
 * P2-13：让底部弹层跟随键盘上移的可复用 hook。
 * 输入框聚焦时订阅键盘高度（onKeyboardHeight），弹层整体上移 h（px）；
 * 失焦或弹层关闭（<dialog> close 事件，含 Esc）时恢复原位并取消订阅。
 * @param {HTMLElement} sheetEl 要上移的弹层元素（<dialog> 或遮罩/容器 div）
 * @param {HTMLInputElement|Array<HTMLInputElement>} inputEl 触发的输入框（可多个）
 * @returns {() => void} 清理函数（解绑监听、恢复原位；供页面卸载等场景）
 */
export function followKeyboard(sheetEl, inputEl) {
  const noop = function () {};
  if (!sheetEl || !inputEl) return noop;
  const inputs = (Array.isArray(inputEl) ? inputEl : [inputEl]).filter(function (el) {
    return !!el;
  });
  if (!inputs.length) return noop;
  /** @type {(() => void)|null} */ let stopKb = null;
  const clear = function () {
    try {
      sheetEl.style.transform = '';
    } catch (e) {}
    if (stopKb) {
      try {
        stopKb();
      } catch (e2) {}
      stopKb = null;
    }
  };
  const start = function () {
    if (stopKb) return;
    try {
      stopKb = onKeyboardHeight(function (h) {
        try {
          sheetEl.style.transform = h > 0 ? 'translateY(' + Math.round(-h) + 'px)' : '';
        } catch (e) {}
      });
    } catch (e) {
      stopKb = null;
    }
  };
  const onFocus = function () {
    start();
  };
  /**
   * @param {FocusEvent} e
   */
  const onBlur = function (e) {
    /* 焦点在同弹层的输入框之间切换（双密码框）时不恢复 */
    try {
      const rt = e && e.relatedTarget;
      if (rt && inputs.indexOf(rt) !== -1) return;
    } catch (e2) {}
    clear();
  };
  const onClose = function () {
    clear();
  };
  inputs.forEach(function (inp) {
    inp.addEventListener('focus', onFocus);
    inp.addEventListener('blur', onBlur);
  });
  /* <dialog> 原生关闭（Esc/表单提交）也要清理 */
  let hostDlg = null;
  try {
    hostDlg = sheetEl.tagName === 'DIALOG' ? sheetEl : sheetEl.closest('dialog');
  } catch (e) {}
  if (hostDlg) hostDlg.addEventListener('close', onClose);
  /* 调用方先 focus 再挂 hook 时直接启动 */
  try {
    if (inputs.indexOf(document.activeElement) !== -1) start();
  } catch (e) {}
  return function () {
    inputs.forEach(function (inp) {
      try {
        inp.removeEventListener('focus', onFocus);
      } catch (e) {}
      try {
        inp.removeEventListener('blur', onBlur);
      } catch (e2) {}
    });
    try {
      if (hostDlg) hostDlg.removeEventListener('close', onClose);
    } catch (e3) {}
    clear();
  };
}
