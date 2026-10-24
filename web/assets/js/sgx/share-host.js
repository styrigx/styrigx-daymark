/**
 * 日刻接入顶栏右胶囊的分享按钮（共享外壳 share.js，主站同一份，2026-10-24）。
 * 站长（网关注入 <html data-sgx-role="owner">）：生成带临时会话的短链（链接 24 小时、点开能看 12 小时；同页复用）再系统分享；
 * 访客：直接分享当前页地址。没有系统分享 / 被拒 → 复制 + toast「已复制分享链接」。
 * 余响卡片里的 #dm-share（分享句子文字，daymark.js）不归这里管。
 */
import { mountShare } from './shell/share.js';

function boot() {
  mountShare({ button: document.querySelector('.sgx-topbar [data-sgx-share]') });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
