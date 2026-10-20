/* assets/js/daymark.js —— 日刻首页逻辑（浏览器 IIFE；node 测试时导出纯函数）。
 *
 * 三个页签（顶栏分段滑块，顺序固定）：余响 Echo（默认）· 拾录 Trove · 百味 Flavors。
 *   hash：余响 = 无，#trove，#flavors；百味里的分组 #flavors/c/<专题 id>、#flavors/a/<作者>。只用 replaceState，切页签不加历史。
 * - 余响：整屏一句（今日一句 /api/today）；「再抽一句」从能看到的句子里随机抽（主人：全部；访客：公开），抽过后多一个「回到今日」。
 *   长按复制（toast 已复制），右上角分享（navigator.share，不支持就复制）。
 * - 拾录：全部句子，新的在前；没有搜索。主人：右下角「记一句」，点句子进编辑；私密句子带小锁。
 * - 百味：先是主人的自建专题（主人多一张「＋ 新建」），再是按作者自动分组的「人物」；点进去是该组的句子（页内返回）。
 *   主人在自建专题里可以上移 / 下移 / 移出句子、删专题。
 * - 记一句（底部弹层）：顶部实时预览；句子；「＋ 加译文」；作者（自动补全 + 最近作者）；出处（类型 + 名字自动补全）；
 *   归入百味（多选 + 就地新建）；标签（回车 / 逗号成块，推荐已有标签）；随手一笔（只主人看得到）；公开开关。
 *
 * 数据：GET /api/quotes、GET /api/collections、GET /api/today；写：POST/PUT/DELETE /api/quotes、/api/collections（只主人 + 同源）。
 * 读请求走 sgxLockSync.apiFetch（401 = 锁定 → 刷新去锁屏）。纯函数导出给 tests/web/daymark.test.mjs。
 */
(function(){
"use strict";
var G = typeof globalThis !== 'undefined' ? globalThis : this;

/* ================= 纯函数 ================= */

var TABS = ['echo', 'trove', 'flavors'];
var SOURCE_TYPES = ['poetry', 'book', 'film', 'song', 'interview', 'mine'];
var MAX_TAGS = 8;

/** hash → 路由 {tab, group?:{kind:'c'|'a', key}}；认不出返回 null */
function parseHash(hash){
  var h = String(hash || '').replace(/^#/, '');
  if (!h) return { tab: 'echo' };
  var parts = h.split('/');
  var tab = parts[0];
  if (TABS.indexOf(tab) < 0) return null;
  if (tab === 'flavors' && (parts[1] === 'c' || parts[1] === 'a') && parts.length > 2) {
    var key;
    try { key = decodeURIComponent(parts.slice(2).join('/')); } catch (e) { return { tab: 'flavors' }; }
    if (key) return { tab: 'flavors', group: { kind: parts[1], key: key } };
  }
  return { tab: tab };
}

/** 路由 → hash */
function routeHash(r){
  if (!r || r.tab === 'echo') return '';
  if (r.tab === 'flavors' && r.group) return '#flavors/' + r.group.kind + '/' + encodeURIComponent(r.group.key);
  return '#' + r.tab;
}

/** 标签输入 → 标签数组（逗号、顿号、空格分隔；去 #、去重、最多 8 个、每个 20 字） */
function parseTagInput(s){
  var out = [];
  String(s || '').split(/[,，、\s]+/).forEach(function(t){
    t = t.replace(/^#+/, '').trim().slice(0, 20);
    if (t && out.indexOf(t) < 0 && out.length < MAX_TAGS) out.push(t);
  });
  return out;
}

/** 已有标签块 + 新输入的文字 → 新的标签块（保持顺序、去重、最多 8 个） */
function addTags(tags, input){
  var out = (tags || []).slice();
  parseTagInput(input).forEach(function(t){ if (out.indexOf(t) < 0 && out.length < MAX_TAGS) out.push(t); });
  return out;
}

/** 全部标签，按出现次数从多到少（同数按字母） */
function allTags(quotes){
  return countBy(quotes, function(q){ return q.tags || []; }).map(function(x){ return x.name; });
}

/** 按某个字段计数，次数多的在前，同数按字母；空值跳过 → [{name, count}] */
function countBy(quotes, pick){
  var n = {};
  (quotes || []).forEach(function(q){
    var v = pick(q);
    (Array.isArray(v) ? v : [v]).forEach(function(x){ x = String(x || '').trim(); if (x) n[x] = (n[x] || 0) + 1; });
  });
  return Object.keys(n).sort(function(a, b){ return n[b] - n[a] || (a < b ? -1 : a > b ? 1 : 0); })
    .map(function(k){ return { name: k, count: n[k] }; });
}

/** 百味 · 人物：每位作者一组（没写作者的不分组） */
function authorGroups(quotes){ return countBy(quotes, function(q){ return q.author; }); }

/** 最近用过的作者（按添加时间新→旧去重），最多 n 个 */
function recentAuthors(quotes, n){
  var out = [];
  (quotes || []).slice().sort(function(a, b){ return (b.created_at || 0) - (a.created_at || 0); }).forEach(function(q){
    var a = String(q.author || '').trim();
    if (a && out.indexOf(a) < 0 && out.length < (n || 6)) out.push(a);
  });
  return out;
}

/** 出处名字候选：给了类型就只要同类型的，常用的在前 */
function knownSources(quotes, type){
  return countBy((quotes || []).filter(function(q){ return !type || q.source_type === type; }), function(q){ return q.source; })
    .map(function(x){ return x.name; });
}

/** 自动补全：包含输入（不分大小写）的候选，开头就匹配的排前面；和输入完全一样的不出；最多 n 个 */
function suggest(list, input, n){
  var q = String(input || '').trim().toLowerCase();
  if (!q) return [];
  var head = [], mid = [];
  (list || []).forEach(function(s){
    var l = String(s).toLowerCase();
    if (l === q) return;
    var i = l.indexOf(q);
    if (i === 0) head.push(s); else if (i > 0) mid.push(s);
  });
  return head.concat(mid).slice(0, n || 5);
}

/** 再抽一句：随机一条，尽量不和现在这条相同；空列表返回 null */
function pickRandom(list, excludeId, rnd){
  var pool = (list || []).filter(function(q){ return q.id !== excludeId; });
  if (!pool.length) pool = list || [];
  if (!pool.length) return null;
  var r = typeof rnd === 'function' ? rnd() : Math.random();
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))];
}

/** 数组里第 i 项挪 delta 位（越界不动），返回新数组 */
function moveItem(arr, i, delta){
  var out = (arr || []).slice();
  var j = i + delta;
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  var x = out.splice(i, 1)[0];
  out.splice(j, 0, x);
  return out;
}

/** 百味分组里的句子：自建专题按专题顺序；人物按添加时间新→旧（quotes 已是新→旧） */
function groupQuotes(quotes, collections, group){
  if (!group) return [];
  if (group.kind === 'a') return (quotes || []).filter(function(q){ return q.author === group.key; });
  var c = (collections || []).filter(function(x){ return x.id === group.key; })[0];
  if (!c) return [];
  var by = {};
  (quotes || []).forEach(function(q){ by[q.id] = q; });
  return (c.quote_ids || []).map(function(id){ return by[id]; }).filter(Boolean);
}

/** 署名「作者 · 《出处》」：诗词 / 书 / 电影 / 歌加书名号（出处里已有书名号就原样用），访谈 / 自己 / 没选类型不加；英文 "Author · Source" */
function attribution(q, isEn){
  var a = String((q && q.author) || '').trim();
  var s = String((q && q.source) || '').trim();
  if (s && !isEn) {
    var bare = s.replace(/^《/, '').replace(/》$/, '');
    var t = q.source_type || '';
    /* 自己已经带书名号的（如「《查拉图斯特拉如是说》·序言 3」）原样用 */
    if (!/[《》]/.test(s) && (t === 'poetry' || t === 'book' || t === 'film' || t === 'song')) s = '《' + bare + '》';
  }
  return [a, s].filter(Boolean).join(' · ');
}

/** 今日的日期行：YYYY-MM-DD → 「10月20日 星期二」/ "Tuesday, Oct 20" */
function fmtDay(day, isEn){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (isEn) return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (+m[2]) + '月' + (+m[3]) + '日 ' + ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getUTCDay()];
}

/** 抽到的句子的日期行：记下它的那天（北京时间）→「拾于 2026年10月20日」/ "Kept Oct 20, 2026" */
function fmtKept(ts, isEn){
  if (!ts) return isEn ? 'From the trove' : '拾录里的一句';
  var d = new Date(ts + 8 * 3600 * 1000);
  if (isEn) return 'Kept ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return '拾于 ' + d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日';
}

/** 复制 / 分享用的纯文本 */
function shareText(q, isEn){
  if (!q) return '';
  var a = attribution(q, isEn);
  return [q.text, q.trans, a ? '—— ' + a : ''].filter(Boolean).join('\n');
}

var pure = {
  TABS: TABS, SOURCE_TYPES: SOURCE_TYPES, parseHash: parseHash, routeHash: routeHash, parseTagInput: parseTagInput, addTags: addTags,
  allTags: allTags, authorGroups: authorGroups, recentAuthors: recentAuthors, knownSources: knownSources, suggest: suggest,
  pickRandom: pickRandom, moveItem: moveItem, groupQuotes: groupQuotes, attribution: attribution, fmtDay: fmtDay, fmtKept: fmtKept,
  shareText: shareText
};
if (typeof module !== 'undefined' && module.exports) { module.exports = pure; return; }
G.SgxDaymark = pure;

/* ================= 页面 ================= */
var doc = G.document;
var isEn = doc.documentElement.lang === 'en';
var T = isEn ? {
  add: 'Save a line', edit: 'Edit line', kept: 'Kept.', deleted: 'Deleted.', failed: 'Something went wrong. Please try again.',
  needText: 'Write the line first.', priv: 'Only you can see this', emptyOwner: 'Nothing kept yet. Tap "Save a line" to keep your first one.',
  emptyVisitor: 'Nothing here yet.', noToday: 'No line for today yet.', copied: 'Copied.', nothingToDraw: 'Nothing to draw from yet.',
  count: function(n){ return n + (n === 1 ? ' line' : ' lines'); }, newCol: 'New', colCreated: 'Collection created.',
  delQuote: 'Delete this line? This cannot be undone.', delCol: 'Delete this collection? The lines in it stay in your Trove.',
  removed: 'Removed from this collection.', groupEmpty: 'Nothing in here yet.', edit2: 'Edit', done: 'Done', needName: 'Give it a name first.',
  previewPh: 'Your line will show here, just like in Echo.', up: 'Move up', down: 'Move down', remove: 'Remove from collection'
} : {
  add: '记一句', edit: '编辑这一句', kept: '已拾录', deleted: '已删除', failed: '出了点问题，请再试一次。',
  needText: '先写下这一句。', priv: '仅自己可见', emptyOwner: '还没有句子。点「记一句」留下第一句。',
  emptyVisitor: '这里还空着。', noToday: '今天还没有句子。', copied: '已复制', nothingToDraw: '还没有可以抽的句子。',
  count: function(n){ return n + ' 句'; }, newCol: '新建', colCreated: '专题已建好',
  delQuote: '确定删除这一句吗？删除后无法恢复。', delCol: '确定删除这个专题吗？里面的句子还留在拾录里。',
  removed: '已移出专题', groupEmpty: '这里还没有句子。', edit2: '编辑', done: '完成', needName: '先给专题起个名字。',
  previewPh: '写下的句子会像在余响里这样显示。', up: '上移', down: '下移', remove: '移出专题'
};

var $ = function(s){ return doc.querySelector(s); };
var quotes = [];
var collections = [];
var owner = false;
var loaded = false;
var today = { day: '', quote: null };
var echoQuote = null;
var drawn = false;
var tab = 'echo';
var group = null;
var groupEditing = false;
var scrolls = { echo: 0, trove: 0, flavors: 0 };
var toastTimer = null;

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}
function reduced(){
  return doc.documentElement.classList.contains('reduced-motion') || !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
  toastTimer = setTimeout(function(){ el.classList.add('hidden'); }, 2200);
}
function haptic(){ try { if (G.navigator && typeof navigator.vibrate === 'function') navigator.vibrate(12); } catch (e) {} }
function copyText(s){
  function fallback(){
    var ta = doc.createElement('textarea');
    ta.value = s; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }
  if (G.navigator && navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).catch(fallback);
  return fallback();
}
function copyQuote(q){ if (q) copyText(shareText(q, isEn)).then(function(){ haptic(); toast(T.copied); }, function(){ toast(T.failed); }); }

/** 长按（≈550ms，手指不挪）触发 fn；触发后吞掉随后的那次点击 */
function onLongPress(el, fn){
  var timer = 0, x0 = 0, y0 = 0, fired = false;
  el.addEventListener('pointerdown', function(e){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    fired = false; x0 = e.clientX; y0 = e.clientY;
    clearTimeout(timer);
    var target = e.target;
    timer = setTimeout(function(){ fired = true; fn(target); }, 550);
  });
  el.addEventListener('pointermove', function(e){ if (Math.abs(e.clientX - x0) > 10 || Math.abs(e.clientY - y0) > 10) clearTimeout(timer); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(t){ el.addEventListener(t, function(){ clearTimeout(timer); }); });
  el.addEventListener('contextmenu', function(e){ e.preventDefault(); });
  el.addEventListener('click', function(e){ if (fired) { fired = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
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
  if (open.length) closeOverlay(open[open.length - 1].id);
});
var confirmFn = null;
function ask(msg, okLabel, fn){
  $('#confirm-msg').textContent = msg;
  $('#confirm-ok').textContent = okLabel;
  confirmFn = fn;
  openOverlay('confirm-wrap');
}
$('#confirm-cancel').addEventListener('click', function(){ confirmFn = null; closeOverlay('confirm-wrap'); });
$('#confirm-ok').addEventListener('click', function(){ var f = confirmFn; confirmFn = null; closeOverlay('confirm-wrap'); if (f) f(); });

/* ---------- 句子的几种画法 ---------- */
var LOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function bodyHTML(q){
  var a = attribution(q, isEn);
  return '<p class="dm-text">' + esc(q.text) + '</p>'
    + (q.trans ? '<p class="dm-trans">' + esc(q.trans) + '</p>' : '')
    + (a ? '<p class="dm-attr">' + esc(a) + '</p>' : '');
}
function cardHTML(q, ctl){
  return '<article class="dm-card" data-id="' + esc(q.id) + '"' + (owner && !ctl ? ' tabindex="0" role="button"' : '') + '>'
    + (owner && q.visibility === 'private' ? '<span class="dm-lock" role="img" aria-label="' + esc(T.priv) + '" title="' + esc(T.priv) + '">' + LOCK + '</span>' : '')
    + bodyHTML(q)
    + ((q.tags || []).length ? '<div class="dm-meta">' + q.tags.map(function(t){ return '<span class="dm-tag">#' + esc(t) + '</span>'; }).join('') + '</div>' : '')
    + (ctl || '')
    + '</article>';
}
function findQuote(id){ return quotes.filter(function(x){ return x.id === id; })[0] || null; }
function bindCards(box){
  box.querySelectorAll('.dm-card').forEach(function(card){
    var q = findQuote(card.dataset.id);
    onLongPress(card, function(){ copyQuote(findQuote(card.dataset.id)); });
    if (!owner) return;
    function act(e){
      if (e && e.target && e.target.closest && e.target.closest('[data-move],[data-remove]')) return;
      if (groupEditing && box.id === 'dm-g-list') return;
      var cur = findQuote(card.dataset.id);
      if (cur) openEdit(cur);
    }
    card.addEventListener('click', act);
    card.addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target === card) act(e); });
    void q;
  });
}

/* ---------- 余响 ---------- */
function renderEcho(){
  var q = echoQuote;
  $('#dm-echo-day').textContent = drawn ? fmtKept(q && q.created_at, isEn) : fmtDay(today.day, isEn);
  $('#dm-echo-body').innerHTML = q ? bodyHTML(q) : '<p class="dm-trans">' + esc(loaded || today.day ? T.noToday : '') + '</p>';
  $('#dm-share').classList.toggle('hidden', !q);
  $('#dm-back-today').classList.toggle('hidden', !drawn);
}
$('#dm-draw').addEventListener('click', function(){
  var q = pickRandom(quotes, echoQuote && echoQuote.id);
  if (!q) { toast(T.nothingToDraw); return; }
  echoQuote = q; drawn = true; renderEcho();
});
$('#dm-back-today').addEventListener('click', function(){ echoQuote = today.quote; drawn = false; renderEcho(); });
$('#dm-share').addEventListener('click', function(){
  var q = echoQuote; if (!q) return;
  var text = shareText(q, isEn);
  if (G.navigator && typeof navigator.share === 'function') {
    navigator.share({ text: text, url: G.location.origin + (isEn ? '/en/' : '/') }).catch(function(e){ if (!e || e.name !== 'AbortError') copyQuote(q); });
  } else copyQuote(q);
});
onLongPress($('#dm-echo'), function(t){ if (t && t.closest && t.closest('#dm-share')) return; copyQuote(echoQuote); });

/* ---------- 拾录 ---------- */
function renderTrove(){
  $('#dm-loading').classList.toggle('hidden', loaded);
  var box = $('#dm-list');
  box.innerHTML = quotes.map(function(q){ return cardHTML(q); }).join('');
  bindCards(box);
  $('#dm-empty').textContent = owner ? T.emptyOwner : T.emptyVisitor;
  $('#dm-empty').classList.toggle('hidden', !loaded || quotes.length > 0);
}

/* ---------- 百味 ---------- */
function renderFlavors(){
  var showCols = owner || collections.length > 0;
  $('#dm-cols-sec').classList.toggle('hidden', !showCols);
  $('#dm-cols').innerHTML = collections.map(function(c){
    var n = groupQuotes(quotes, collections, { kind: 'c', key: c.id }).length;
    return '<button type="button" class="dm-fcard" data-group="c" data-key="' + esc(c.id) + '">'
      + '<span class="dm-fcard-name">' + esc(c.name) + '</span>'
      + (c.intro ? '<span class="dm-fcard-intro">' + esc(c.intro) + '</span>' : '')
      + '<span class="dm-fcard-count">' + esc(T.count(n)) + '</span></button>';
  }).join('') + (owner ? '<button type="button" class="dm-fcard dm-fcard-new" id="dm-col-new"><span class="dm-fcard-plus" aria-hidden="true">＋</span><span class="dm-fcard-name">' + esc(T.newCol) + '</span></button>' : '');
  var authors = authorGroups(quotes);
  $('#dm-authors-sec').classList.toggle('hidden', !authors.length);
  $('#dm-authors').innerHTML = authors.map(function(a){
    return '<button type="button" class="dm-fcard dm-fcard-person" data-group="a" data-key="' + esc(a.name) + '">'
      + '<span class="dm-fcard-name">' + esc(a.name) + '</span><span class="dm-fcard-count">' + esc(T.count(a.count)) + '</span></button>';
  }).join('');
  $('#dm-fl-empty').classList.toggle('hidden', !loaded || showCols || authors.length > 0);
  $('#dm-fl-empty').textContent = T.emptyVisitor;
  doc.querySelectorAll('#dm-fl-home [data-group]').forEach(function(b){
    b.addEventListener('click', function(){ go({ tab: 'flavors', group: { kind: b.dataset.group, key: b.dataset.key } }); });
  });
  var nb = $('#dm-col-new');
  if (nb) nb.addEventListener('click', function(){ openNewCollection(); });
  renderGroup();
}
function currentCollection(){
  return group && group.kind === 'c' ? collections.filter(function(c){ return c.id === group.key; })[0] || null : null;
}
function renderGroup(){
  var inGroup = !!group;
  $('#dm-fl-home').classList.toggle('hidden', inGroup);
  $('#dm-fl-group').classList.toggle('hidden', !inGroup);
  if (!inGroup) return;
  var col = currentCollection();
  var list = groupQuotes(quotes, collections, group);
  var title = group.kind === 'c' ? (col ? col.name : '') : group.key;
  $('#dm-g-title').textContent = title;
  $('#dm-g-intro').textContent = col && col.intro ? col.intro : '';
  $('#dm-g-intro').classList.toggle('hidden', !(col && col.intro));
  $('#dm-g-count').textContent = T.count(list.length);
  var canEdit = owner && !!col;
  if (!canEdit) groupEditing = false;
  $('#dm-g-tools').classList.toggle('hidden', !canEdit);
  $('#dm-g-edit').textContent = groupEditing ? T.done : T.edit2;
  $('#dm-g-edit').setAttribute('aria-pressed', groupEditing ? 'true' : 'false');
  $('#dm-g-del').classList.toggle('hidden', !groupEditing);
  var box = $('#dm-g-list');
  box.classList.toggle('is-editing', groupEditing);
  box.innerHTML = list.map(function(q, i){
    var ctl = groupEditing ? '<div class="dm-reorder">'
      + '<button type="button" class="dm-rbtn" data-move="-1" data-i="' + i + '" aria-label="' + esc(T.up) + '"' + (i === 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg></button>'
      + '<button type="button" class="dm-rbtn" data-move="1" data-i="' + i + '" aria-label="' + esc(T.down) + '"' + (i === list.length - 1 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg></button>'
      + '<button type="button" class="dm-rbtn dm-rbtn-x" data-remove="' + i + '" aria-label="' + esc(T.remove) + '"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
      + '</div>' : '';
    return cardHTML(q, ctl);
  }).join('');
  $('#dm-g-empty').classList.toggle('hidden', list.length > 0);
  $('#dm-g-empty').textContent = T.groupEmpty;
  bindCards(box);
  box.querySelectorAll('[data-move]').forEach(function(b){
    b.addEventListener('click', function(e){ e.stopPropagation(); reorder(moveItem(list.map(function(q){ return q.id; }), +b.dataset.i, +b.dataset.move)); });
  });
  box.querySelectorAll('[data-remove]').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var ids = list.map(function(q){ return q.id; });
      ids.splice(+b.dataset.remove, 1);
      reorder(ids, T.removed);
    });
  });
}
function reorder(ids, msg){
  var col = currentCollection(); if (!col) return;
  var before = col.quote_ids.slice();
  /* 访客看不到的私密句子也在专题里：主人的 quote_ids 就是全部，直接用 */
  col.quote_ids = ids;
  syncQuoteCollections();
  renderGroup();
  send('PUT', '/api/collections?id=' + encodeURIComponent(col.id), { quote_ids: ids }).then(function(j){
    col.quote_ids = j.collection.quote_ids; syncQuoteCollections();
    if (msg) toast(msg);
  }).catch(function(e){
    if (e.sgxLocked) return;
    col.quote_ids = before; syncQuoteCollections(); renderGroup(); toast(T.failed);
  });
}
/** 专题的 quote_ids 改了之后，句子上的 collections 跟着改（编辑器里的「归入百味」读它） */
function syncQuoteCollections(){
  quotes.forEach(function(q){
    q.collections = collections.filter(function(c){ return c.quote_ids.indexOf(q.id) >= 0; }).map(function(c){ return c.id; });
  });
}
$('#dm-fl-back').addEventListener('click', function(){ go({ tab: 'flavors' }); });
$('#dm-g-edit').addEventListener('click', function(){ groupEditing = !groupEditing; renderGroup(); });
$('#dm-g-del').addEventListener('click', function(){
  var col = currentCollection(); if (!col) return;
  ask(T.delCol, isEn ? 'Delete' : '删除', function(){
    send('DELETE', '/api/collections?id=' + encodeURIComponent(col.id)).then(function(){
      collections = collections.filter(function(c){ return c.id !== col.id; });
      syncQuoteCollections(); groupEditing = false;
      go({ tab: 'flavors' }); toast(T.deleted);
    }).catch(function(e){ if (!e.sgxLocked) toast(T.failed); });
  });
});

/* 新建专题（百味里的「＋ 新建」卡）：名字 + 一句话简介 */
function openNewCollection(){
  $('#c-name').value = ''; $('#c-intro').value = '';
  $('#col-err').classList.add('hidden');
  openOverlay('col-wrap');
  setTimeout(function(){ $('#c-name').focus(); }, 60);
}
function createCollection(name, intro){
  return send('POST', '/api/collections', { name: name, intro: intro || '' }).then(function(j){
    collections.push(j.collection);
    return j.collection;
  });
}
$('#col-save').addEventListener('click', function(){
  var name = $('#c-name').value.trim();
  if (!name) { $('#col-err').textContent = T.needName; $('#col-err').classList.remove('hidden'); $('#c-name').focus(); return; }
  createCollection(name, $('#c-intro').value.trim()).then(function(c){
    closeOverlay('col-wrap'); renderFlavors(); haptic(); toast(T.colCreated);
    go({ tab: 'flavors', group: { kind: 'c', key: c.id } });
  }).catch(function(e){ if (!e.sgxLocked) { $('#col-err').textContent = T.failed; $('#col-err').classList.remove('hidden'); } });
});

/* ---------- 页签 ---------- */
var seg = doc.querySelector('[data-dm-seg]');
var tabBtns = TABS.map(function(id){ return doc.querySelector('[data-dm-tab="' + id + '"]'); });
function writeHash(){
  var h = routeHash({ tab: tab, group: tab === 'flavors' ? group : null });
  var url = G.location.pathname + G.location.search + h;
  if (url !== G.location.pathname + G.location.search + G.location.hash) { try { history.replaceState(history.state, '', url); } catch (e) {} }
}
function setTab(next, opts){
  opts = opts || {};
  var i = TABS.indexOf(next); if (i < 0) return;
  if (!opts.initial) scrolls[tab] = G.scrollY;
  var changed = next !== tab;
  tab = next;
  tabBtns.forEach(function(b, j){ if (!b) return; b.setAttribute('aria-selected', j === i ? 'true' : 'false'); b.tabIndex = j === i ? 0 : -1; });
  TABS.forEach(function(id){
    var p = doc.getElementById('dm-pane-' + id);
    if (id === next) { p.hidden = false; p.removeAttribute('inert'); } else { p.hidden = true; p.setAttribute('inert', ''); }
  });
  if (seg) seg.style.setProperty('--seg-pos', String(i));
  doc.documentElement.setAttribute('data-dm-active', next);
  $('#dm-fab').classList.toggle('hidden', !(owner && next === 'trove'));
  if (opts.focus && tabBtns[i]) tabBtns[i].focus();
  writeHash();
  if (changed && !opts.initial) G.scrollTo({ top: scrolls[next] || 0, behavior: 'auto' });
}
function go(r, opts){
  opts = opts || {};
  var g = r.tab === 'flavors' ? (r.group || null) : group;
  var groupChanged = r.tab === 'flavors' && JSON.stringify(g) !== JSON.stringify(group);
  if (r.tab === 'flavors') { group = g; if (groupChanged) groupEditing = false; renderGroup(); }
  setTab(r.tab, opts);
  if (groupChanged && !opts.initial) G.scrollTo({ top: 0, behavior: 'auto' });
}
tabBtns.forEach(function(b, i){
  if (!b) return;
  b.addEventListener('click', function(){
    if (TABS[i] === tab) {
      if (tab === 'flavors' && group) { go({ tab: 'flavors' }); return; }
      G.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return;
    }
    setTab(TABS[i]);
  });
});
if (seg) seg.addEventListener('keydown', function(e){
  var i = TABS.indexOf(tab), n = -1;
  if (e.key === 'ArrowRight') n = (i + 1) % 3; else if (e.key === 'ArrowLeft') n = (i + 2) % 3;
  else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = 2;
  if (n < 0) return;
  e.preventDefault(); setTab(TABS[n], { focus: true });
});
G.addEventListener('hashchange', function(){ var r = parseHash(G.location.hash); if (r) go(r); });
/* 左右滑切页签（竖着滑照常滚动；在弹层、按钮行里不算） */
(function(){
  var panes = $('#dm-panes'), x0 = 0, y0 = 0, t0 = 0, on = false;
  panes.addEventListener('touchstart', function(e){
    if (e.touches.length !== 1) { on = false; return; }
    on = true; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  panes.addEventListener('touchend', function(e){
    if (!on) return; on = false;
    var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || Date.now() - t0 > 700) return;
    var i = TABS.indexOf(tab) + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < TABS.length) setTab(TABS[i]);
  }, { passive: true });
})();

/* ---------- 记一句 / 编辑 ---------- */
var editing = null;
var ed = { tags: [], cols: [], stype: '' };
var ST_LABEL = isEn
  ? { poetry: 'Poetry', book: 'Book', film: 'Film', song: 'Song', interview: 'Interview', mine: 'Mine' }
  : { poetry: '诗词', book: '书', film: '电影', song: '歌', interview: '访谈', mine: '自己' };

function edQuote(){
  return { text: $('#f-text').value.trim(), trans: $('#f-trans').value.trim(), author: $('#f-author').value.trim(), source: $('#f-source').value.trim(), source_type: ed.stype };
}
function renderPreview(){
  var q = edQuote();
  $('#ed-preview-body').innerHTML = q.text ? bodyHTML(q) : '<p class="dm-preview-ph">' + esc(T.previewPh) + '</p>';
}
function renderStype(){
  $('#f-stype').innerHTML = SOURCE_TYPES.map(function(t){
    return '<button type="button" class="dm-chip" data-st="' + t + '" aria-pressed="' + (ed.stype === t) + '">' + esc(ST_LABEL[t]) + '</button>';
  }).join('');
  $('#f-stype').querySelectorAll('[data-st]').forEach(function(b){
    b.addEventListener('click', function(){ ed.stype = ed.stype === b.dataset.st ? '' : b.dataset.st; renderStype(); renderPreview(); });
  });
}
function renderRecent(){
  var list = recentAuthors(quotes, 6);
  var box = $('#f-author-recent');
  box.classList.toggle('hidden', !list.length);
  box.innerHTML = list.map(function(a){ return '<button type="button" class="dm-chip dm-chip-sm" data-author="' + esc(a) + '">' + esc(a) + '</button>'; }).join('');
  box.querySelectorAll('[data-author]').forEach(function(b){
    b.addEventListener('click', function(){ $('#f-author').value = b.dataset.author; hideAc('#f-author-ac'); renderPreview(); });
  });
}
function renderCols(){
  var box = $('#f-cols');
  box.innerHTML = collections.map(function(c){
    return '<button type="button" class="dm-chip" data-col="' + esc(c.id) + '" aria-pressed="' + (ed.cols.indexOf(c.id) >= 0) + '">' + esc(c.name) + '</button>';
  }).join('') + '<button type="button" class="dm-chip dm-chip-new" id="f-col-new">＋ ' + esc(T.newCol) + '</button>';
  box.querySelectorAll('[data-col]').forEach(function(b){
    b.addEventListener('click', function(){
      var id = b.dataset.col, i = ed.cols.indexOf(id);
      if (i >= 0) ed.cols.splice(i, 1); else ed.cols.push(id);
      renderCols();
    });
  });
  $('#f-col-new').addEventListener('click', function(){
    $('#f-col-new-row').classList.remove('hidden');
    $('#f-col-name').value = '';
    $('#f-col-name').focus();
  });
}
function addInlineCol(){
  var name = $('#f-col-name').value.trim();
  if (!name) { $('#f-col-name').focus(); return; }
  createCollection(name, '').then(function(c){
    ed.cols.push(c.id);
    $('#f-col-new-row').classList.add('hidden');
    renderCols(); renderFlavors(); haptic();
  }).catch(function(e){ if (!e.sgxLocked) toast(T.failed); });
}
$('#f-col-add').addEventListener('click', addInlineCol);
$('#f-col-name').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); addInlineCol(); } });

function renderTags(){
  var box = $('#f-tagchips');
  box.innerHTML = ed.tags.map(function(t, i){
    return '<span class="dm-tagchip">#' + esc(t) + '<button type="button" data-untag="' + i + '" aria-label="' + esc((isEn ? 'Remove ' : '删除 ') + t) + '">×</button></span>';
  }).join('');
  box.querySelectorAll('[data-untag]').forEach(function(b){
    b.addEventListener('click', function(){ ed.tags.splice(+b.dataset.untag, 1); renderTags(); $('#f-tag-input').focus(); });
  });
  var q = $('#f-tag-input').value.replace(/^#+/, '').trim().toLowerCase();
  var sugg = allTags(quotes).filter(function(t){ return ed.tags.indexOf(t) < 0 && (!q || t.toLowerCase().indexOf(q) >= 0); }).slice(0, 8);
  var sb = $('#f-tag-sugg');
  sb.classList.toggle('hidden', !sugg.length || ed.tags.length >= MAX_TAGS);
  sb.innerHTML = sugg.map(function(t){ return '<button type="button" class="dm-chip dm-chip-sm" data-addtag="' + esc(t) + '">#' + esc(t) + '</button>'; }).join('');
  sb.querySelectorAll('[data-addtag]').forEach(function(b){
    b.addEventListener('click', function(){ ed.tags = addTags(ed.tags, b.dataset.addtag); $('#f-tag-input').value = ''; renderTags(); });
  });
  $('#f-tag-input').classList.toggle('hidden', ed.tags.length >= MAX_TAGS);
}
function commitTagInput(){
  var inp = $('#f-tag-input');
  if (!inp.value.trim()) return false;
  ed.tags = addTags(ed.tags, inp.value);
  inp.value = '';
  renderTags();
  return true;
}
$('#f-tag-input').addEventListener('keydown', function(e){
  if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); commitTagInput(); }
  else if (e.key === 'Backspace' && !e.target.value && ed.tags.length) { ed.tags.pop(); renderTags(); }
});
$('#f-tag-input').addEventListener('input', function(e){
  /* 手机输入法常常不发 keydown：输入里出现逗号 / 顿号就成块 */
  if (/[,，、]/.test(e.target.value)) commitTagInput(); else renderTags();
});
$('#f-tag-input').addEventListener('blur', function(){ commitTagInput(); });
$('#f-tagbox').addEventListener('click', function(e){ if (e.target === e.currentTarget || e.target.id === 'f-tagchips') $('#f-tag-input').focus(); });

/* 自动补全下拉（作者 / 出处） */
function hideAc(sel){ var el = $(sel); el.classList.add('hidden'); el.innerHTML = ''; }
function bindAc(inputSel, listSel, source){
  var inp = $(inputSel), box = $(listSel);
  function show(){
    var items = suggest(source(), inp.value, 5);
    box.classList.toggle('hidden', !items.length);
    box.innerHTML = items.map(function(s){ return '<button type="button" role="option" class="dm-ac-item">' + esc(s) + '</button>'; }).join('');
    box.querySelectorAll('.dm-ac-item').forEach(function(b){
      b.addEventListener('pointerdown', function(e){ e.preventDefault(); });
      b.addEventListener('click', function(){ inp.value = b.textContent; hideAc(listSel); renderPreview(); });
    });
  }
  inp.addEventListener('input', function(){ show(); renderPreview(); });
  inp.addEventListener('focus', show);
  inp.addEventListener('blur', function(){ setTimeout(function(){ hideAc(listSel); }, 150); });
  inp.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !box.classList.contains('hidden')) { e.stopPropagation(); hideAc(listSel); } });
}
bindAc('#f-author', '#f-author-ac', function(){ return authorGroups(quotes).map(function(a){ return a.name; }); });
bindAc('#f-source', '#f-source-ac', function(){ return knownSources(quotes, ed.stype); });
$('#f-text').addEventListener('input', renderPreview);
$('#f-trans').addEventListener('input', renderPreview);
function showTrans(on){
  $('#f-trans-wrap').classList.toggle('hidden', !on);
  $('#f-trans-toggle').classList.toggle('hidden', on);
}
$('#f-trans-toggle').addEventListener('click', function(){ showTrans(true); $('#f-trans').focus(); });

function openEdit(q){
  editing = q || null;
  $('#edit-title').textContent = q ? T.edit : T.add;
  $('#f-text').value = q ? q.text : '';
  $('#f-trans').value = q ? q.trans : '';
  showTrans(!!(q && q.trans));
  $('#f-author').value = q ? q.author : '';
  $('#f-source').value = q ? q.source : '';
  $('#f-note').value = q ? (q.note || '') : '';
  $('#f-public').checked = q ? q.visibility !== 'private' : true;
  $('#f-tag-input').value = '';
  $('#f-col-new-row').classList.add('hidden');
  ed = { tags: q ? (q.tags || []).slice() : [], cols: q ? (q.collections || []).slice() : (group && group.kind === 'c' && tab === 'flavors' ? [group.key] : []), stype: q ? (q.source_type || '') : '' };
  hideAc('#f-author-ac'); hideAc('#f-source-ac');
  renderStype(); renderRecent(); renderCols(); renderTags(); renderPreview();
  $('#edit-del').classList.toggle('hidden', !q);
  $('#edit-err').classList.add('hidden');
  $('#edit-form').scrollTop = 0;
  openOverlay('edit-wrap');
  setTimeout(function(){ if (!q) $('#f-text').focus(); }, 60);
}
function formBody(){
  commitTagInput();
  return {
    text: $('#f-text').value, trans: $('#f-trans').value, author: $('#f-author').value, source: $('#f-source').value,
    source_type: ed.stype, tags: ed.tags.slice(), visibility: $('#f-public').checked ? 'public' : 'private',
    note: $('#f-note').value, collections: ed.cols.filter(function(id){ return collections.some(function(c){ return c.id === id; }); }),
  };
}
function reloadCollections(){
  return getJSON('/api/collections').then(function(j){ collections = j.collections || []; syncQuoteCollections(); renderFlavors(); }, function(){});
}
var saving = false;
$('#edit-save').addEventListener('click', function(){
  if (saving) return;
  var body = formBody();
  if (!body.text.trim()) { $('#edit-err').textContent = T.needText; $('#edit-err').classList.remove('hidden'); $('#f-text').focus(); return; }
  saving = true;
  var was = editing;
  var p = was ? send('PUT', '/api/quotes?id=' + encodeURIComponent(was.id), body) : send('POST', '/api/quotes', body);
  p.then(function(j){
    if (was) quotes = quotes.map(function(x){ return x.id === j.quote.id ? j.quote : x; });
    else quotes.unshift(j.quote);
    if (echoQuote && echoQuote.id === j.quote.id) echoQuote = j.quote;
    closeOverlay('edit-wrap');
    renderAll(); haptic(); toast(T.kept);
    reloadCollections();
    if (!was || (today.quote && today.quote.id === j.quote.id)) loadToday();
  }).catch(function(e){
    if (e.sgxLocked) return;
    $('#edit-err').textContent = T.failed; $('#edit-err').classList.remove('hidden');
  }).then(function(){ saving = false; });
});
$('#edit-del').addEventListener('click', function(){
  var q = editing; if (!q) return;
  ask(T.delQuote, isEn ? 'Delete' : '删除', function(){
    send('DELETE', '/api/quotes?id=' + encodeURIComponent(q.id)).then(function(){
      quotes = quotes.filter(function(x){ return x.id !== q.id; });
      collections.forEach(function(c){ c.quote_ids = c.quote_ids.filter(function(id){ return id !== q.id; }); });
      if (echoQuote && echoQuote.id === q.id) { echoQuote = today.quote; drawn = false; }
      closeOverlay('edit-wrap');
      renderAll(); toast(T.deleted); loadToday();
    }).catch(function(e){ if (!e.sgxLocked) toast(T.failed); });
  });
});
$('#dm-fab').addEventListener('click', function(){ openEdit(null); });

/* ---------- 启动 ---------- */
function renderAll(){ renderEcho(); renderTrove(); renderFlavors(); }
function loadToday(){
  return getJSON('/api/today').then(function(j){
    var wasToday = !drawn;
    today = { day: j.day, quote: j.quote };
    if (wasToday) echoQuote = j.quote;
    renderEcho();
  }, function(e){ if (!e.sgxLocked) renderEcho(); });
}
function boot(){
  var r = parseHash(G.location.hash) || { tab: 'echo' };
  go(r, { initial: true });
  renderEcho();
  loadToday();
  Promise.all([getJSON('/api/quotes'), getJSON('/api/collections').catch(function(e){ if (e && e.sgxLocked) throw e; return { collections: [] }; })]).then(function(res){
    owner = !!res[0].owner;
    quotes = res[0].quotes || [];
    collections = res[1].collections || [];
    if (owner) syncQuoteCollections();
    loaded = true;
    doc.documentElement.classList.toggle('dm-owner', owner);
    renderAll();
    setTab(tab, { initial: true });
  }).catch(function(e){
    if (e && e.sgxLocked) return;
    $('#dm-loading').textContent = T.failed;
  });
}
boot();
})();
