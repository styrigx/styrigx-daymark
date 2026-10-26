<div align="center">

中文 | [English](README.en.md)

# Styrigx Daymark

日刻（Daymark）：随手刻下值得记住的句子，每天挑一句给你看。

[在线访问 daymark.styrigx.com](https://daymark.styrigx.com) · [主站 styrigx.com](https://styrigx.com) · [博客 blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-space/main/.github/actions/setup-hugo/action.yml&query=%24..HUGO_VERSION&label=Hugo&style=flat-square&color=2563eb&logo=hugo)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-daymark/main/web/hugo.yaml&query=%24.params.version&label=Daymark&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-daymark/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

## 这是什么

Styrigx's Space 的子站。读到、听到、想到一句好话，打开就记下；每天从公开的句子里挑一句，主站首页也能显示。界面是和博客同款的沉浸式 app：左边九宫格切站，中间「余响 · 拾录 · 百味」三个页签，右边分享按钮（管理员生成带临时会话的短链，访客分享当前页）；深浅色、调色板、强调色、语言都跟主站设置走（`sgx-ui` cookie，首帧前读，不闪屏）。

## 能做什么

- **余响**（默认页）：整屏一句今日一句（按北京时间每天换，同一天所有人看到同一句；当天第一次打开时挑好存进 D1，之后新加句子也不会让当天的句子变）。「再抽一句」随机换一句，抽过后可「回到今日」；管理员抽到公开句子时还可以「设为今日」，主站首页和锁屏跟着变；长按复制，右上角分享。
- **拾录**：全部句子，新的在前。管理员右下角「记一句」，点句子就能改；私密句子带小锁。
- **百味**：管理员自建的专题（名字 + 一句话简介，可排序、移出句子），再加按作者自动分好的「人物」。
- **记一句**：顶部实时预览；句子、译文（点「＋ 加译文」才出现）、作者（自动补全 + 最近作者）、出处（诗词 / 书 / 电影 / 歌 / 访谈 / 自己 + 名字）、归入百味、标签、随手一笔（只有自己看得到）、公开开关。
- 访客只读，只看到公开的句子；随手一笔永远不会出现在访客接口和 `/api/today` 里。

## 怎么搭的

| 部分 | 用什么 |
|---|---|
| 页面 | Hugo + Tailwind，Cloudflare Pages 只放静态文件 |
| 接口 | Worker `styrigx-daymark-core`（`workers/core/`），路由 `daymark.styrigx.com/api/*` |
| 数据 | Cloudflare D1 `styrigx-daymark-core` |
| 登录 | 不持任何钥匙：页面由主站鉴权网关验锁屏会话（`sgx-lock-session`），接口经服务绑定问网关（`AuthVerifier.lockSession`，角色 `admin` / `visitor`） |

目录说明见 [STRUCTURE.md](STRUCTURE.md)。

## 接口

| 接口 | 谁能用 | 做什么 |
|---|---|---|
| `GET /api/today` | 公开（CORS 只给 styrigx.com） | 今日一句（当天锁定在 D1 `daily_pick`；只出公开句子） |
| `PUT /api/today` | 管理员 + 同源 | 设为今日：body `{id}`，改写今天那一句（私密句子 409） |
| `GET /api/quotes` | 有效会话 | 管理员全部（带 `note`、`collections`）；访客只有公开句子，不带这两个键 |
| `POST` / `PUT ?id=` / `DELETE ?id=` `/api/quotes` | 管理员 + 同源 | 增改删句子；`collections` 给了就重设归属 |
| `GET /api/collections` | 有效会话 | 百味专题；访客只看到公开句子，空专题不返回 |
| `POST` / `PUT ?id=` / `DELETE ?id=` `/api/collections` | 管理员 + 同源 | 建 / 改名 / 排序（`quote_ids`）/ 删专题 |

数据库迁移在 `workers/core/migrations/`，CI 部署 core 之前自动跑（`d1 migrations apply styrigx-daymark-core --remote`）。`0004_daily_pick` 建今日一句的锁定表（每天一行：`day`、`quote_id`、`set_by` auto/admin（admin = 管理员手动设的）、`set_at`）；`0005_daily_pick_set_by_admin` 把旧行的 `set_by='owner'` 改成 `'admin'`。`0003_seed_quotes` 是种子句子（尼采 42 句、《了不起的盖茨比》21 句及两个同名专题）：正文已存在的跳过、同名专题不重建、不删不改任何已有数据。改种子：`node scripts/gen-seed-sql.mjs <quotes.json>` 重新生成（种子原文不进仓库）。

## 本地开发

```bash
npm ci
npm run build:css
hugo server -s web
npm test            # 单元测试（Node 22+，D1 的 SQL 用 node:sqlite 真跑，含迁移）
node scripts/sync-shell.mjs       # 主站共享外壳改了以后同步（默认主站 main；--ref <分支>、--from <本地主站目录>）
DAYMARK_SEED_JSON=<quotes.json> npm test   # 顺带核对种子迁移和生成脚本一致
npm run test:e2e    # 手机 E2E（先 hugo --minify -s web）
```

## 主站共享外壳

色彩角色（13 套预设 × 亮 / 暗 + 自定义种子）、顶栏材质、导航抽屉、自定义主题色引擎、抽屉项都来自主站 styrigx-space 的 `web/shared/shell`，
副本在 `web/assets/css/input.css` 的 `@sgx-shell:begin / end` 段、`web/assets/js/sgx/shell/`、`web/assets/sgx-shell/`，来源和版本记在 `sgx-shell.lock.json`。
**不要手改**：主站改了以后跑 `node scripts/sync-shell.mjs`，再 `npm run build:css`。CI 跑 `--check`，副本被手改或落后主站 main 都会红。

### 外观 cookie（`sgx-ui`）

深浅色、调色板、主题色读主站写的 `sgx-ui` cookie（本站只读，不写）。cookie 的属性、字段、版本、旧数据迁移和改格式的步骤见主站契约
[docs/ui-cookie-contract.md](https://github.com/styrigx/styrigx-space/blob/main/docs/ui-cookie-contract.md)。
本仓库读它的是 `web/assets/js/sgx/lib/ui-inherit.js`（`web/assets/js/sgx/ui-inherit-run.js` 打包后由 `web/layouts/_default/baseof.html` 内联，首帧前执行），
单测 `tests/web/ui-inherit.test.mjs`。主站改了 cookie 格式，这里要跟着改。

## 许可

[MIT](LICENSE)
