# 仓库结构

按用途分层，根目录只放入口文件和顶层目录（与 styrigx-space 同一套约定）。改页面只动 `web/`，改接口只动 `workers/core/`。

```
styrigx-daymark/
├─ web/          网站本体（Hugo），Cloudflare Pages 发布，只放静态文件
├─ workers/
│  └─ core/      Worker styrigx-daymark-core：句子的存、读、今日一句
├─ scripts/      生成脚本（强调色 CSS、种子迁移 SQL）
├─ tests/        全部测试，按测试对象分目录
├─ .github/      CI 工作流
├─ package.json  npm 依赖（npm 只认根目录）
└─ README / STRUCTURE / LICENSE
```

## web/

| 位置 | 是什么 |
|---|---|
| `hugo.yaml` | Hugo 配置（`params.version` 是版本号，README 徽章读它） |
| `wrangler.toml` | Pages 项目 `styrigx-daymark`：不带变量、钥匙和绑定 |
| `layouts/_default/baseof.html` | 沉浸式 app 顶栏（九宫格 · 余响/拾录/百味 分段滑块 · 头像）、导航抽屉（主站共享外壳 `assets/sgx-shell/nav.json`：四个应用 + 设置） |
| `layouts/index.html` | 首页三块面板（余响 · 拾录 · 百味）、记一句弹层、新建专题、确认框 |
| `assets/js/daymark.js` | 首页逻辑（页签 / hash 路由、余响、拾录、百味、记一句）；纯函数导出给 `tests/web/daymark.test.mjs` |
| `assets/js/topbar.js` | 导航抽屉开关 |
| `assets/js/sgx/` | 外观和语言继承主站（`sgx-ui` cookie：mode / pal / accent 种子 / fs / rm / lang）；`shell/palette-scheme.js` 是主站共享外壳的自定义主题色引擎（`shell-accent.js` 按需加载） |
| `assets/sgx-shell/` | 主站共享外壳的抽屉项 + 图标（`nav.json`）、预设种子（`palettes.json`），`scripts/sync-shell.mjs` 同步，勿手改 |
| `assets/css/input.css` | 样式；`@sgx-shell:begin … end` 之间是主站共享外壳（色彩角色 + 顶栏材质 + 导航抽屉，`scripts/sync-shell.mjs` 写入，勿手改），后面的 `--m-*` 只是角色的别名 |
| `assets/js/sgx-lock-sync.js` | 切回前台复查会话，401 → 刷新去主站锁屏 |
| `static/_worker.js` | 只把 `*.pages.dev` 跳回 `daymark.styrigx.com`（不经网关的地址不能直接开页面） |

CSS 类名里的 `bk-` 前缀沿用自 styrigx-book 的共用组件（弹层、标题行），本站新写的用 `dm-`。

## workers/core/

| 位置 | 是什么 |
|---|---|
| `wrangler.toml` | 路由 `daymark.styrigx.com/api/*`、D1 绑定 `DB`、网关服务绑定 `AUTH`、全站搜索 KV `SEARCH_KV`、每小时 Cron |
| `src/index.js` | 入口：`/api/today` 公开，其余先问网关会话 |
| `src/search-index.js` | 全站搜索索引：句子 → KV `site:daymark`（写接口成功后重建 + Cron 每小时兜底；私密句子 `private:true`） |
| `src/routes.js` | 路由表（与 `src/api/` 一一对应，测试核对） |
| `src/api/quotes.js` | `GET` 列表（主人全部 + 随手一笔 + 所在专题 / 访客公开），`POST` `PUT` `DELETE` 只主人 + 同源 |
| `src/api/collections.js` | 百味自建专题：`GET`（访客只含公开句子、空的不给），`POST` `PUT`（含排序 `quote_ids`）`DELETE` 只主人 + 同源 |
| `src/api/today.js` | 今日一句，CORS 只给 `https://styrigx.com` |
| `src/api/_quotes.js` | 表结构、校验、行映射（`note` 只给主人）、按日期挑句子 |
| `src/api/_write.js` | 写接口共用：读 body、同源 + 主人门槛、`?id=` |
| `migrations/` | D1 迁移：`0001_init`（quotes）、`0002_three_tabs`（quotes.source_type / note，collections、collection_quotes）、`0003_seed_quotes`（63 句种子 + 专题「尼采」「了不起的盖茨比」，只增不删，由 `scripts/gen-seed-sql.mjs` 生成）。代码里的 `CREATE TABLE IF NOT EXISTS` 只兜底全新的库，不做 ALTER |

## 部署顺序（CI）

1. 主站网关先登记 `daymark.styrigx.com` 的页面路由（styrigx-space 仓库）
2. 本仓库 CI：测试 → 构建 → 网关检查 → D1 迁移 → 部署 core → 冒烟 → 部署 Pages → 冒烟
3. 首次部署后在 Pages 绑定自定义域名 `daymark.styrigx.com`（域名没解析前，CI 跳过网关检查和冒烟）
