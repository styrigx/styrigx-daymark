/**
 * @fileoverview 底部搜索胶囊的键盘跟随 + 语音入口。
 * 移植主站 styrigx-space 的 capsule.js 机制（不重写近似版）：
 * - kbUpdate：宽度按 键盘高度/最大键盘高度 插值（baseW=min(vw*0.64,300) → fullW=vw-32），
 *   写 documentElement 的 --sgx-kb；无 VirtualKeyboard API 时用 transform 把胶囊顶到键盘上沿。
 * - open/close：focus 打开、blur 后 180ms 收起；touchstart preventDefault + focus({preventScroll:true})。
 * - 麦克风：只检测 SpeechRecognition 接口是否存在（不支持则不显示），点击走共享 voice-sheet；
 *   onFinal → 填入搜索框 → 立即搜索（与 capsule.js 的 mic 写法一致）。
 * 与主站差异：胶囊静止 bottom 为 12px（主站 subpage 档），无 layout-dex 分支、无结果浮层 panel。
 */
import { on } from '../lib/events.js';
import { voiceSheet } from './voice-sheet.js';
import { onKeyboardHeight } from './vk.js';

/** 页面的搜索回调：window.__bkCapSearchProvider(q) 由页面内联脚本注册 */
function getProvider() {
  const p = /** @type {any} */ (window).__bkCapSearchProvider;
  return typeof p === 'function' ? p : null;
}

/**
 * 初始化 #bk-cap 搜索胶囊（幂等）。
 */
export function initCapsule() {
  const cap = document.getElementById('bk-cap');
  if (!cap || cap.dataset.sgxInit) return;
  cap.dataset.sgxInit = '1';
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('bk-cap-input'));
  if (!cap || !input) return;

  let opened = false;
  const kbMaxSeen = { v: 0 };

  /* 按键盘高度更新：宽度按 键盘高度/最终高度 同步插值；--sgx-kb 供 CSS 用 */
  /** @param {number} h */
  function kbUpdate(h) {
    h = Math.max(0, h || 0);
    if (h > kbMaxSeen.v) kbMaxSeen.v = h;
    const p = kbMaxSeen.v < 1 ? 1 : Math.min(1, h / kbMaxSeen.v);
    const vw = window.innerWidth || 0;
    const baseW = Math.min(vw * 0.64, 300);
    const fullW = Math.max(0, vw - 32);
    cap.style.width = Math.round(baseW + (fullW - baseW) * p) + 'px';
    document.documentElement.style.setProperty('--sgx-kb', Math.round(h) + 'px');
    /* 无 VK API 时手动把胶囊顶到键盘上方（胶囊静止 bottom=12px，即主站 subpage 档） */
    if (!document.documentElement.classList.contains('sgx-vk')) {
      const capRest = 12;
      cap.style.transform = 'translateX(-50%) translateY(' + Math.round(capRest - 12 - h) + 'px)';
    }
  }

  /** @type {Array<() => void>} */
  let openDisposers = [];
  function open() {
    if (opened) return;
    opened = true;
    cap.classList.add('open');
    /* 键盘高度统一走 vk.js（VirtualKeyboard API / visualViewport 回退） */
    openDisposers.push(onKeyboardHeight(kbUpdate, cap));
    doSearch();
  }
  function close() {
    if (!opened) return;
    opened = false;
    cap.classList.remove('open');
    cap.classList.remove('sgx-kb-sync');
    document.documentElement.classList.remove('sgx-vk');
    cap.style.width = '';
    cap.style.transform = '';
    openDisposers.forEach(function (d) {
      d();
    });
    openDisposers = [];
    document.documentElement.style.setProperty('--sgx-kb', '0px');
  }
  /** 防抖搜索（输入时，150ms） */
  function doSearch() {
    const provider = getProvider();
    if (!provider) return;
    try {
      provider(input.value.trim());
    } catch (e) {}
  }
  /** 立即搜索（回车 / 语音识别完成时） */
  function doSearchNow() {
    const provider = getProvider();
    if (!provider) return;
    try {
      provider(input.value.trim());
    } catch (e) {}
  }

  /** @type {number|null} */
  let deb = null;
  /* 触屏点输入框时手动聚焦并禁止浏览器自动滚动页面（页面全程不动） */
  on(
    input,
    'touchstart',
    function (/** @type {TouchEvent} */ e) {
      if (document.activeElement !== input) {
        try {
          e.preventDefault();
        } catch (_) {}
        try {
          input.focus(/** @type {any} */ ({ preventScroll: true }));
        } catch (err) {
          try {
            input.focus();
          } catch (_) {}
        }
      }
    },
    { passive: false }
  );
  on(input, 'focus', function () {
    open();
  });
  on(input, 'input', function () {
    if (!opened) open();
    if (deb) clearTimeout(deb);
    deb = window.setTimeout(doSearch, 150);
  });
  on(input, 'keydown', function (/** @type {KeyboardEvent} */ e) {
    if (e.key === 'Escape') {
      input.blur();
      close();
    } else if (e.key === 'Enter') {
      doSearchNow();
    }
  });
  /* 失焦后收起（延迟 180ms） */
  on(input, 'blur', function () {
    window.setTimeout(function () {
      if (document.activeElement === input) return;
      close();
    }, 180);
  });
  /* 语音输入：走共享语音弹窗；只检测 SpeechRecognition 接口是否存在；
     不支持则麦克风不渲染（无空位、无报错） */
  const mic = cap.querySelector('[data-mic]');
  const SR =
    /** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition;
  if (mic && SR) {
    /** @type {HTMLElement} */ (mic).style.display = '';
    on(mic, 'click', function (e) {
      e.stopPropagation();
      voiceSheet({
        onFinal: function (t) {
          if (!opened) open();
          input.value = t;
          doSearchNow();
        },
      });
    });
  }
}
