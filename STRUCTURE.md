# 仓库结构

按用途分层，根目录只放入口文件和顶层目录（与 styrigx-space 同一套约定）。改页面只动 `web/`，改接口只动 `workers/core/`。

```
styrigx-daymark/
├─ web/          网站本体（Hugo），Cloudflare Pages 发布，只放静态文件
├─ workers/
│  └─ core/      Worker styrigx-daymark-core：句子的存、读、今日一句
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
| `layouts/index.html` | 首页：今日一句、标签条、句子列表、记一句弹层 |
| `assets/js/daymark.js` | 首页逻辑；纯函数导出给 `tests/web/daymark.test.mjs` |
| `assets/js/sgx/` | 主站移植的共用件：外观继承、搜索胶囊键盘跟随、语音输入 |
| `assets/js/sgx-lock-sync.js` | 切回前台复查会话，401 → 刷新去主站锁屏 |
| `static/_worker.js` | 只把 `*.pages.dev` 跳回 `daymark.styrigx.com`（不经网关的地址不能直接开页面） |

CSS 类名里的 `bk-` 前缀沿用自 styrigx-book 的共用组件（顶栏菜单、弹层、搜索胶囊），本站新写的用 `dm-`。

## workers/core/

| 位置 | 是什么 |
|---|---|
| `wrangler.toml` | 路由 `daymark.styrigx.com/api/*`、D1 绑定 `DB`、网关服务绑定 `AUTH` |
| `src/index.js` | 入口：`/api/today` 公开，其余先问网关会话 |
| `src/routes.js` | 路由表（与 `src/api/` 一一对应，测试核对） |
| `src/api/quotes.js` | `GET` 列表（主人全部 / 访客公开），`POST` `PUT` `DELETE` 只主人 + 同源 |
| `src/api/today.js` | 今日一句，CORS 只给 `https://styrigx.com` |
| `src/api/_quotes.js` | 表结构、校验、按日期挑句子 |
| `migrations/` | D1 迁移（代码里也有 `CREATE TABLE IF NOT EXISTS` 兜底） |

## 部署顺序（CI）

1. 主站网关先登记 `daymark.styrigx.com` 的页面路由（styrigx-space 仓库）
2. 本仓库 CI：测试 → 构建 → 网关检查 → D1 迁移 → 部署 core → 冒烟 → 部署 Pages → 冒烟
3. 首次部署后在 Pages 绑定自定义域名 `daymark.styrigx.com`（域名没解析前，CI 跳过网关检查和冒烟）
