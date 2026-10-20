/**
 * @fileoverview 基础工具：HTML 转义、语言判定、rAF 节流。
 * 无副作用，可被任意模块导入（会被 tree-shaking）。
 */

/**
 * HTML 转义（插入 innerHTML 前用）。
 * @param {any} s
 * @returns {string}
 */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/**
 * 当前页面是否为英文版（<html lang="en">）。
 * @returns {boolean}
 */
export function isEn() {
  return document.documentElement.lang === 'en';
}

/**
 * rAF 节流包装：同一帧内多次调用只执行一次。
 * @param {() => void} fn
 * @returns {() => void}
 */
export function rafThrottle(fn) {
  let ticking = false;
  return function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      fn();
    });
  };
}

/**
 * 是否开启减弱动效（设置项或系统偏好）。
 * @returns {boolean}
 */
export function reducedMotion() {
  return (
    document.documentElement.classList.contains('reduced-motion') ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

/**
 * 按时区格式化当前时间（HH:MM）。
 * @param {string} tz IANA 时区
 * @param {boolean} h12 是否 12 小时制
 * @returns {string}
 */
export function fmtTz(tz, h12) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: !!h12,
    }).format(new Date());
  } catch (e) {
    return '';
  }
}
