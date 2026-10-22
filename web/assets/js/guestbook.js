/* 留言板（/guestbook/）：三个子站（博客 / 日刻 / 奇趣）共用同一个 Giscus 讨论串——
   styrigx/styrigx 仓库 Announcements 分类里 term = guestbook 的那条（data-mapping="specific"）。
   配置在模板的 [data-giscus] 上（来自 hugo.yaml params.guestbook.giscus），这里只负责：
   ① 按页面当前深浅色挑 giscus 主题再插入 client.js；② <html class="dark"> 变了（跟随系统 / 外观 cookie 重读）就 postMessage 同步主题。
   三个站这份文件一字不差（同博客文章页原来的评论脚本逻辑）。 */
(function () {
  var box = document.querySelector('[data-giscus]');
  if (!box) return;
  var d = box.dataset;
  var root = document.documentElement;
  function theme() { return root.classList.contains('dark') ? d.darkTheme || 'dark' : d.lightTheme || 'light'; }
  var s = document.createElement('script');
  s.src = 'https://giscus.app/client.js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  var attrs = {
    'data-repo': d.repo, 'data-repo-id': d.repoId, 'data-category': d.category, 'data-category-id': d.categoryId,
    'data-mapping': d.mapping || 'specific', 'data-term': d.term || 'guestbook', 'data-strict': d.strict || '0',
    'data-reactions-enabled': d.reactionsEnabled || '1', 'data-emit-metadata': d.emitMetadata || '0',
    'data-input-position': d.inputPosition || 'top', 'data-theme': theme(), 'data-lang': d.lang || 'zh-CN',
    'data-loading': d.loading || 'lazy'
  };
  for (var k in attrs) if (attrs[k] != null) s.setAttribute(k, attrs[k]);
  box.replaceChildren(s);
  var last = theme();
  new MutationObserver(function () {
    var t = theme();
    if (t === last) return;
    last = t;
    var f = document.querySelector('iframe.giscus-frame');
    if (f && f.contentWindow) f.contentWindow.postMessage({ giscus: { setConfig: { theme: t } } }, 'https://giscus.app');
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
})();
