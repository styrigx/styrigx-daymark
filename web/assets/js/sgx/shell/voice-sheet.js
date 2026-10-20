/**
 * @fileoverview 语音输入弹窗（2.4.0 D：<dialog> 实现）。
 * 点麦克风后 showModal() + 底部语音卡片；识别中实时显示 interim 文字。
 * 原生 ::backdrop 做遮罩、Esc 关闭、焦点陷阱。
 */
import { on } from '../lib/events.js';
import { loadI18n } from '../lib/i18n.js';
import { reducedMotion } from '../lib/util.js';
import { onDialogBackdrop, onDialogCancel, recordDialogClose } from '../lib/dialog-behavior.js';

let vsOpen = false;

/**
 * @typedef {Object} VoiceSheetOpts
 * @property {(text: string) => void} [onFinal] 识别到最终文字时的回调
 */

/**
 * 弹出语音输入。返回 true 表示已弹出，false 表示不支持。
 * @param {VoiceSheetOpts} [opts]
 * @returns {boolean}
 */
export function voiceSheet(opts) {
  opts = opts || {};
  const SR =
    /** @type {any} */ (window).SpeechRecognition || /** @type {any} */ (window).webkitSpeechRecognition;
  if (!SR || vsOpen) return false;
  vsOpen = true;
  const T = loadI18n('sgx-i18n-core');
  const reduced = reducedMotion();
  /* 收起键盘 */
  try {
    const _ae = /** @type {HTMLElement|null} */ (document.activeElement);
  if (_ae && _ae.blur) _ae.blur();
  } catch (e) {}
  const dlg = document.createElement('dialog');
  dlg.className = 'sgx-vs-dlg';
  dlg.setAttribute('aria-label', T.t('vsAria'));
  dlg.innerHTML =
    '<div class="sgx-vs-card">' +
    /* 批次 A 收尾 A3：右上角 × 关闭按钮 */
    '<button type="button" class="sgx-dlg-close" data-vs-close aria-label="' + T.t('vsClose') + '">×</button>' +
    '<div class="sgx-vs-tx"><div class="sgx-vs-l1"></div><div class="sgx-vs-l2"></div></div>' +
    '<button type="button" class="sgx-vs-btn" aria-label="' +
    T.t('vsAria') +
    '">' +
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15zm6-3.5a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.94V22h2v-2.06A8 8 0 0 0 20 11.5h-2z"/></svg>' +
    '</button>' +
    '</div>';
  const card = /** @type {HTMLElement} */ (dlg.firstChild);
  const l1 = /** @type {HTMLElement} */ (card.querySelector('.sgx-vs-l1'));
  const l2 = /** @type {HTMLElement} */ (card.querySelector('.sgx-vs-l2'));
  const btn = /** @type {HTMLElement} */ (card.querySelector('.sgx-vs-btn'));
  l1.textContent = T.t('vsSpeak');
  l2.textContent = T.t('vsLang');
  document.body.appendChild(dlg);

  /** @type {any} */
  let rec = null;
  let finalTxt = '',
    finished = false;
  /** @type {number|null} */
  let timer = null;
  const disposers = [];
  /** @param {boolean} on_ */
  function setListening(on_) {
    btn.classList.toggle('listening', on_);
  }
  function teardown() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    disposers.forEach(function (d) {
      d();
    });
    vsOpen = false;
    if (dlg.open) {
      try {
        dlg.close();
      } catch (e) {}
    }
    if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
  }
  function hide() {
    dlg.classList.remove('show');
    window.setTimeout(teardown, reduced ? 0 : 280);
  }
  function cancel(reason) {
    recordDialogClose('voice-sheet', reason || 'unknown');
    if (finished && !btn.classList.contains('listening')) {
      hide();
      return;
    }
    finished = true;
    setListening(false);
    try {
      if (rec) rec.abort();
    } catch (e) {}
    hide();
  }
  function start() {
    finished = false;
    finalTxt = '';
    l1.textContent = T.t('vsSpeak');
    l2.textContent = T.t('vsLang');
    setListening(true);
    try {
      rec = new SR();
      rec.lang = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = function (/** @type {any} */ ev) {
        let f = '',
          im = '';
        try {
          for (let i = 0; i < ev.results.length; i++) {
            const tr = ev.results[i][0].transcript || '';
            if (ev.results[i].isFinal) f += tr;
            else im += tr;
          }
        } catch (e) {}
        if (f) finalTxt = f;
        let disp = (im || f).trim();
        if (disp.length > 24) disp = '…' + disp.slice(-24);
        if (disp) l1.textContent = disp;
      };
      rec.onerror = function (/** @type {any} */ ev) {
        if (finished) return;
        const c = (ev && ev.error) || '';
        if (c === 'not-allowed' || c === 'service-not-allowed') {
          finished = true;
          setListening(false);
          l1.textContent = T.t('vsNoPerm');
          timer = window.setTimeout(function () {
            hide();
          }, 2000);
        }
      };
      rec.onend = function () {
        if (finished) return;
        finished = true;
        setListening(false);
        const t = finalTxt.trim();
        if (t) {
          hide();
          try {
            if (opts.onFinal) opts.onFinal(t);
          } catch (e) {}
        } else {
          l1.textContent = T.t('vsRetry');
        }
      };
      rec.start();
      timer = window.setTimeout(function () {
        try {
          if (rec) rec.stop();
        } catch (e) {}
      }, 8000);
    } catch (e) {
      setListening(false);
      l1.textContent = T.t('vsRetry');
    }
  }
  disposers.push(
    on(btn, 'click', function (e) {
      e.stopPropagation();
      if (btn.classList.contains('listening')) {
        try {
          if (rec) rec.stop();
        } catch (e) {}
      } else {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        start();
      }
    }),
    /* 批次 A 收尾 A1：点遮罩只失焦不关闭 */
    on(dlg, 'click', function (e) {
      onDialogBackdrop(e, dlg);
    }),
    /* 批次 A 收尾 A2：Esc/返回时，键盘开着先收键盘，键盘收起才关闭 */
    on(dlg, 'cancel', function (/** @type {Event} */ e) {
      onDialogCancel(e, dlg, function (reason) { cancel(reason); });
    }),
    /* 批次 A 收尾 A3：右上角 × 关闭按钮 */
    on(dlg, 'click', function (e) {
      const t = /** @type {Element|null} */ (e.target);
      if (t && t.closest && t.closest('[data-vs-close]')) cancel('close-btn');
    })
  );
  try {
    dlg.showModal();
  } catch (e) {
    teardown();
    return false;
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      dlg.classList.add('show');
    });
  });
  start();
  return true;
}
