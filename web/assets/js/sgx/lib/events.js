/**
 * @fileoverview 事件管理：AbortController 统一清理 + 事件委托。
 * 返回的 disposer 调用后移除监听，避免泄漏。
 */

/**
 * 绑定事件，返回清理函数。
 * @param {EventTarget} target
 * @param {string} type
 * @param {EventListener} listener
 * @param {boolean|AddEventListenerOptions} [options]
 * @returns {() => void} disposer
 */
export function on(target, type, listener, options) {
  const c = new AbortController();
  /** @type {AddEventListenerOptions} */
  let opts = {};
  if (typeof options === 'boolean') opts = { capture: options };
  else if (options) opts = Object.assign({}, options);
  opts.signal = c.signal;
  target.addEventListener(type, listener, opts);
  return function dispose() {
    c.abort();
  };
}

/**
 * 事件委托：在 root 上监听，命中 selector 的后代时触发。
 * @param {Element|Document} root
 * @param {string} type
 * @param {string} selector
 * @param {(e: Event, el: Element) => void} handler
 * @param {boolean|AddEventListenerOptions} [options]
 * @returns {() => void} disposer
 */
export function delegate(root, type, selector, handler, options) {
  return on(
    root,
    type,
    function (e) {
      const t = /** @type {Element|null} */ (e.target);
      const el = t && t.closest ? t.closest(selector) : null;
      if (el && root.contains(el)) handler(e, el);
    },
    options
  );
}
