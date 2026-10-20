/* assets/js/daymark.js —— 日刻首页逻辑（浏览器 IIFE；node 测试时导出纯函数）。
 *
 * 数据：GET /api/quotes（owner 全部 / visitor 公开）、GET /api/today（今日一句）；
 * 主人写：POST /api/quotes、PUT/DELETE /api/quotes?id=。读请求走 sgxLockSync.apiFetch（401 = 锁定 → 刷新去锁屏）。
 * 纯函数（filterQuotes / allTags / parseTagInput / fmtDay / attribution）导出给 tests/web/daymark.test.mjs。
 */
(function(){
"use strict";
var G = typeof globalThis !== 'undefined' ? globalThis : this;

/* ================= 纯函数 ================= */

/** 标签输入框 → 标签数组（逗号、顿号、空格分隔；去 #、去重、最多 8 个） */
function parseTagInput(s){
  var out = [];
  String(s || '').split(/[,，、\s]+/).forEach(function(t){
    t = t.replace(/^#+/, '').trim().slice(0, 20);
    if (t && out.indexOf(t) < 0 && out.length < 8) out.push(t);
  });
  return out;
}

/** 全部标签，按出现次数从多到少（同数按字母） */
function allTags(quotes){
  var n = {};
  (quotes || []).forEach(function(q){ (q.tags || []).forEach(function(t){ n[t] = (n[t] || 0) + 1; }); });
  return Object.keys(n).sort(function(a, b){ return n[b] - n[a] || (a < b ? -1 : a > b ? 1 : 0); });
}

/** 按标签和关键词筛（关键词搜正文、译文、作者、出处、标签，不分大小写） */
function filterQuotes(quotes, tag, query){
  var q = String(query || '').trim().toLowerCase();
  return (quotes || []).filter(function(x){
    if (tag && (x.tags || []).indexOf(tag) < 0) return false;
    if (!q) return true;
    var hay = [x.text, x.trans, x.author, x.source].concat(x.tags || []).join('\n').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}

/** 「— 作者《出处》」；英文用 — Author, Source */
function attribution(q, isEn){
  var a = (q && q.author) || '', s = (q && q.source) || '';
  if (!a && !s) return '';
  if (isEn) return '— ' + [a, s].filter(Boolean).join(', ');
  return '— ' + a + (s ? '《' + s.replace(/^《|》$/g, '') + '》' : '');
}

/** 今日卡上方的日期：YYYY-MM-DD → 「10月20日 星期二」/ "Tuesday, Oct 20" */
function fmtDay(day, isEn){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isEn) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  return (+m[2]) + '月' + (+m[3]) + '日 ' + ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getUTCDay()];
}

var pure = { parseTagInput: parseTagInput, allTags: allTags, filterQuotes: filterQuotes, attribution: attribution, fmtDay: fmtDay };
if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
G.SgxDaymark = pure;

/* ================= 页面 ================= */
var doc = G.document;
var isEn = doc.documentElement.lang === 'en';
var T = isEn ? {
  add: 'Save a line', edit: 'Edit line', saved: 'Saved.', deleted: 'Deleted.', failed: 'Something went wrong. Please try again.',
  needText: 'Write the line first.', all: 'All', priv: 'Private', emptyOwner: 'Nothing saved yet. Tap "Save a line" to keep your first one.',
  emptyVisitor: 'Nothing here yet.', noToday: 'No line for today yet.', copied: 'Copied.'
} : {
  add: '记一句', edit: '编辑这一句', saved: '已保存。', deleted: '已删除。', failed: '出了点问题，请再试一次。',
  needText: '先写下这一句。', all: '全部', priv: '仅自己可见', emptyOwner: '还没有句子。点「记一句」留下第一句。',
  emptyVisitor: '这里还空着。', noToday: '今天还没有句子。', copied: '已复制。'
};

var $ = function(s){ return doc.querySelector(s); };
var quotes = [];
var owner = false;
var tag = '';
var query = '';
var editing = null;
var toastTimer = null;

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function getJSON(url){
  var f = G.sgxLockSync ? G.sgxLockSync.apiFetch : function(u, o){ return fetch(u, o); };
  return f(url, { credentials: 'same-origin', cache: 'no-store' }).then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}
function send(method, url, body){
  return fetch(url, {
    method: method, credentials: 'same-origin', redirect: 'manual',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).then(function(r){
    if (r.type === 'opaqueredirect' || r.status === 401) { G.location.reload(); throw Object.assign(new Error('locked'), { sgxLocked: true }); }
    return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  });
}
function toast(msg){
  var el = $('#bk-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.add('hidden'); }, 2400);
}

/* ---------- 弹层 ---------- */
function openOverlay(id){ var el = doc.getElementById(id); if (!el) return; el.classList.add('open'); doc.body.style.overflow = 'hidden'; }
function closeOverlay(id){
  var el = doc.getElementById(id); if (!el) return;
  el.classList.remove('open');
  if (!doc.querySelector('.bk-overlay.open')) doc.body.style.overflow = '';
}
doc.querySelectorAll('[data-close]').forEach(function(b){ b.addEventListener('click', function(){ closeOverlay(b.dataset.close + '-wrap'); }); });
doc.addEventListener('keydown', function(e){
  if (e.key !== 'Escape') return;
  var open = doc.querySelectorAll('.bk-overlay.open');
  if (open.length) { closeOverlay(open[open.length - 1].id); return; }
  var m = $('#bk-more-menu'); if (m) m.classList.add('hidden');
});

/* ---------- 今日一句 ---------- */
function quoteBodyHTML(q){
  return '<p class="dm-text">' + esc(q.text) + '</p>'
    + (q.trans ? '<p class="dm-trans">' + esc(q.trans) + '</p>' : '')
    + (attribution(q, isEn) ? '<p class="dm-attr">' + esc(attribution(q, isEn)) + '</p>' : '');
}
function renderToday(day, q){
  $('#dm-today-day').textContent = fmtDay(day, isEn);
  $('#dm-today-body').innerHTML = q ? quoteBodyHTML(q) : '<p class="dm-trans">' + esc(T.noToday) + '</p>';
}

/* ---------- 标签条 + 列表 ---------- */
function renderTags(){
  var tags = allTags(quotes);
  var box = $('#dm-tags');
  if (!tags.length) { box.innerHTML = ''; return; }
  if (tag && tags.indexOf(tag) < 0) tag = '';
  box.innerHTML = [''].concat(tags).map(function(t){
    var on = t === tag;
    return '<button type="button" role="tab" aria-selected="' + on + '" class="dm-chip' + (on ? ' is-active' : '') + '" data-tag="' + esc(t) + '">' + esc(t || T.all) + '</button>';
  }).join('');
  box.querySelectorAll('[data-tag]').forEach(function(b){
    b.addEventListener('click', function(){ tag = b.dataset.tag; renderTags(); renderList(); });
  });
}
function cardHTML(q){
  return '<article class="dm-card" data-id="' + esc(q.id) + '" tabindex="0">'
    + quoteBodyHTML(q)
    + '<div class="dm-meta">'
    + (q.tags || []).map(function(t){ return '<span class="dm-tag">#' + esc(t) + '</span>'; }).join('')
    + (owner && q.visibility === 'private' ? '<span class="dm-priv">' + esc(T.priv) + '</span>' : '')
    + '</div></article>';
}
function renderList(){
  $('#dm-loading').classList.add('hidden');
  var list = filterQuotes(quotes, tag, query);
  $('#dm-list').innerHTML = list.map(cardHTML).join('');
  $('#dm-empty').textContent = owner ? T.emptyOwner : T.emptyVisitor;
  $('#dm-empty').classList.toggle('hidden', quotes.length > 0);
  $('#dm-no-results').classList.toggle('hidden', !quotes.length || list.length > 0);
  $('#dm-list').querySelectorAll('.dm-card').forEach(function(card){
    function act(){
      var q = quotes.filter(function(x){ return x.id === card.dataset.id; })[0];
      if (!q) return;
      if (owner) openEdit(q);
      else if (G.navigator && navigator.clipboard) navigator.clipboard.writeText(q.text + (attribution(q, isEn) ? '\n' + attribution(q, isEn) : '')).then(function(){ toast(T.copied); }, function(){});
    }
    card.addEventListener('click', act);
    card.addEventListener('keydown', function(e){ if (e.key === 'Enter') act(); });
  });
}

/* ---------- 记一句 / 编辑 ---------- */
function openEdit(q){
  editing = q || null;
  $('#edit-title').textContent = q ? T.edit : T.add;
  $('#f-text').value = q ? q.text : '';
  $('#f-trans').value = q ? q.trans : '';
  $('#f-author').value = q ? q.author : '';
  $('#f-source').value = q ? q.source : '';
  $('#f-tags').value = q ? (q.tags || []).join(', ') : '';
  $('#f-public').checked = q ? q.visibility !== 'private' : true;
  $('#edit-del').classList.toggle('hidden', !q);
  $('#edit-err').classList.add('hidden');
  openOverlay('edit-wrap');
  setTimeout(function(){ if (!q) $('#f-text').focus(); }, 60);
}
function formBody(){
  return {
    text: $('#f-text').value, trans: $('#f-trans').value, author: $('#f-author').value, source: $('#f-source').value,
    tags: parseTagInput($('#f-tags').value), visibility: $('#f-public').checked ? 'public' : 'private',
  };
}
var saving = false;
$('#edit-save').addEventListener('click', function(){
  if (saving) return;
  var body = formBody();
  if (!body.text.trim()) { $('#edit-err').textContent = T.needText; $('#edit-err').classList.remove('hidden'); $('#f-text').focus(); return; }
  saving = true;
  var p = editing ? send('PUT', '/api/quotes?id=' + encodeURIComponent(editing.id), body) : send('POST', '/api/quotes', body);
  p.then(function(j){
    if (editing) quotes = quotes.map(function(x){ return x.id === j.quote.id ? j.quote : x; });
    else quotes.unshift(j.quote);
    closeOverlay('edit-wrap');
    renderTags(); renderList(); toast(T.saved);
    if (!editing) loadToday();
  }).catch(function(e){
    if (e.sgxLocked) return;
    $('#edit-err').textContent = T.failed; $('#edit-err').classList.remove('hidden');
  }).then(function(){ saving = false; });
});
$('#edit-del').addEventListener('click', function(){ openOverlay('confirm-wrap'); });
$('#confirm-cancel').addEventListener('click', function(){ closeOverlay('confirm-wrap'); });
$('#confirm-ok').addEventListener('click', function(){
  closeOverlay('confirm-wrap');
  var q = editing; if (!q) return;
  send('DELETE', '/api/quotes?id=' + encodeURIComponent(q.id)).then(function(){
    quotes = quotes.filter(function(x){ return x.id !== q.id; });
    closeOverlay('edit-wrap');
    renderTags(); renderList(); toast(T.deleted); loadToday();
  }).catch(function(e){ if (!e.sgxLocked) toast(T.failed); });
});
$('#dm-add').addEventListener('click', function(){ openEdit(null); });

/* ---------- ⋮ 菜单 + 主题 ---------- */
function applyTheme(mode){
  try { localStorage.setItem('sgx-theme-mode', mode); localStorage.setItem('sgx-theme-at', String(Date.now())); } catch (e) {}
  if (G.__sgxApplyUi) G.__sgxApplyUi();
  else doc.documentElement.classList.toggle('dark', mode === 'dark' || (mode === 'system' && G.matchMedia('(prefers-color-scheme: dark)').matches));
  markTheme(mode);
}
function markTheme(mode){
  doc.querySelectorAll('.bk-theme-opt').forEach(function(b){
    var on = b.dataset.theme === mode;
    var c = b.querySelector('.bk-theme-check'); if (c) c.classList.toggle('hidden', !on);
  });
}
doc.querySelectorAll('.bk-theme-opt').forEach(function(b){ b.addEventListener('click', function(){ applyTheme(b.dataset.theme); }); });
var menu = $('#bk-more-menu'), menuBtn = $('#bk-menu-btn');
function renderMenu(){
  var items = owner ? [['add', T.add]] : [];
  items.push(['settings', isEn ? 'Settings' : '设置']);
  menu.innerHTML = items.map(function(it){ return '<button type="button" class="bk-menu-item" role="menuitem" data-more="' + it[0] + '"><span>' + esc(it[1]) + '</span></button>'; }).join('');
  menu.querySelectorAll('[data-more]').forEach(function(b){
    b.addEventListener('click', function(){
      menu.classList.add('hidden');
      if (b.dataset.more === 'add') openEdit(null);
      if (b.dataset.more === 'settings') { markTheme(doc.documentElement.getAttribute('data-theme-mode') || 'system'); openOverlay('settings-wrap'); }
    });
  });
}
if (menu && menuBtn) {
  menuBtn.addEventListener('click', function(e){
    e.stopPropagation();
    var willOpen = menu.classList.contains('hidden');
    menu.classList.add('hidden');
    if (willOpen) { renderMenu(); menu.classList.remove('hidden'); if (G.sgxAnchorMenu) G.sgxAnchorMenu(menu, menuBtn); }
  });
  doc.addEventListener('click', function(e){ if (!e.target.closest('#bk-more-menu') && !e.target.closest('#bk-menu-btn')) menu.classList.add('hidden'); });
}

/* ---------- 搜索胶囊回调（capsule-kb.js 调用） ---------- */
G.__bkCapSearchProvider = function(q){ query = String(q || '').trim(); renderList(); };

/* ---------- 启动 ---------- */
function loadToday(){
  return getJSON('/api/today').then(function(j){ renderToday(j.day, j.quote); }, function(e){ if (!e.sgxLocked) renderToday('', null); });
}
function boot(){
  loadToday();
  getJSON('/api/quotes').then(function(j){
    owner = !!j.owner;
    quotes = j.quotes || [];
    $('#dm-add-row').classList.toggle('hidden', !owner);
    renderTags(); renderList();
  }).catch(function(e){
    if (e.sgxLocked) return;
    $('#dm-loading').textContent = T.failed;
  });
}
boot();
})();
