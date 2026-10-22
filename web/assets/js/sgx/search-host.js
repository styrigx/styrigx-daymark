/**
 * 日刻接入原地搜索层（共享外壳 search.js，主站同一份，2026-10-22）。
 * 抽屉底栏的搜索框不再跳主站：topbar.js 在点击里同步调用 window.SgxSearch.open(...)，
 * 抽屉原地淡掉、搜索框变成贴着键盘的底栏，结果层盖在当前页上，域名和页面都不变。
 * 数据走本站同源的 /api/search（网关验会话后转给 styrigx-search-index），前台不感知 Worker。
 * 页面一加载就把搜索层 DOM 建好（隐藏），点搜索框时只剩显示 + 同步聚焦（安卓才会弹键盘）。
 */
import { mountSearch } from './shell/search.js';

function boot() {
  if (window.SgxSearch) return;
  const en = document.documentElement.lang === 'en';
  window.SgxSearch = mountSearch({
    lang: en ? 'en' : 'zh',
    api: '/api/search',
    types: [
      { type: 'quote', zh: '日刻', en: 'Daymark' },
      { type: 'post', zh: '博客', en: 'Blog' },
      { type: 'item', zh: '奇趣', en: 'Curio' },
      { type: 'setting', zh: '设置', en: 'Settings' },
      { type: 'app', zh: '应用', en: 'Apps' },
      { type: 'site', zh: '站点', en: 'Sites' },
    ],
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
