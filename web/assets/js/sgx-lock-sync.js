/* assets/js/sgx-lock-sync.js
 * SGX 锁屏同步（L6 前端，不跨层：只做“复查 + 重载”）
 *
 * 主站「立即锁定」后，本页切回前台 / bfcache 恢复时，向服务端确认会话：
 *   GET /api/session-check（middleware 白名单放行，由接口自己验签）
 *   - 200 {ok:true}  → 会话有效，什么都不做
 *   - 401 {ok:false} → 会话已失效 → location.reload()，
 *     让 middleware 走正常 302 到主站锁屏（带 return，解锁后可回来）
 *   - 网络错误       → fail open：不 reload，等下次切回再查
 *
 * 另外暴露 sgxLockSync.apiFetch：各页面数据请求统一走它；
 * 任何接口返回 401 即视为已锁定 → 同样 reload，不展示「加载失败」。
 *
 * 只认服务端状态：不用 sessionStorage / localStorage / BroadcastChannel。
 */
(function(){
"use strict";

var G = typeof globalThis !== 'undefined' ? globalThis : this;
var CHECK_URL = '/api/session-check';
/* 该 401 是否视为“已锁定”（需要 reload）：本站接口的 401 只有这一个意思 */
function isLockSignal(url, status){
  return status === 401;
}

function defaultReload(){
  try { G.location.reload(); } catch (e) {}
}

var checking = false;
/* 向服务端确认会话。fetch/reload 可注入，便于单元测试。 */
function checkSession(fetchFn, reloadFn){
  if (checking) return Promise.resolve(false);
  checking = true;
  var f = fetchFn || (G.fetch && G.fetch.bind(G));
  var rl = reloadFn || defaultReload;
  function done(v){ checking = false; return v; }
  if (!f) return Promise.resolve(done(false));
  return f(CHECK_URL, { credentials: 'same-origin', cache: 'no-store' }).then(
    function(res){
      if (res && res.status === 401) { rl(); return done(true); }
      return done(false);
    },
    function(){ return done(false); }  /* 网络错误：fail open，不 reload */
  );
}

/* 数据请求统一入口：
 * - 401 → reload + 抛 sgxLocked 错误，调用方直接 return，不展示错误 UI；
 * - 网络错误 → 原样抛出，调用方按原逻辑处理，不 reload。 */
function apiFetch(url, opts, fetchFn, reloadFn){
  opts = opts || {};
  if (!opts.credentials) opts.credentials = 'same-origin';
  /* 用 redirect: manual 避免 fetch 自动跟随跨域 302（会报 TypeError）；
     opaqueredirect 视为已锁定，走锁屏流程 */
  if (!opts.redirect) opts.redirect = 'manual';
  var f = fetchFn || (G.fetch && G.fetch.bind(G));
  var rl = reloadFn || defaultReload;
  return f(url, opts).then(function(res){
    if ((res && res.type === 'opaqueredirect') || isLockSignal(url, res && res.status)) {
      rl();
      var e = new Error('sgx session locked');
      e.sgxLocked = true;
      throw e;
    }
    return res;
  });
}

function mount(){
  if (!G.document || !G.window) return;
  G.document.addEventListener('visibilitychange', function(){
    if (!G.document.hidden) checkSession();
  });
  /* pageshow 覆盖 bfcache 恢复（event.persisted）与普通加载 */
  G.window.addEventListener('pageshow', function(){ checkSession(); });
}

var api = {
  CHECK_URL: CHECK_URL,
  isLockSignal: isLockSignal,
  checkSession: checkSession,
  apiFetch: apiFetch,
  mount: mount,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;   /* node 单元测试 */
} else {
  G.sgxLockSync = api;
  mount();                /* 浏览器：自动挂载 */
}
})();
