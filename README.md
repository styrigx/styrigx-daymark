<div align="center">

中文 | [English](README.en.md)

# Styrigx Daymark

每日一句：随手留下值得记住的句子，每天挑一句给你看。

[在线访问 daymark.styrigx.com](https://daymark.styrigx.com) · [主站 styrigx.com](https://styrigx.com) · [博客 blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/Hugo-0.162.0-2563eb?style=flat-square&logo=hugo)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-daymark/main/web/hugo.yaml&query=%24.params.version&label=Daymark&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-daymark/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

## 这是什么

Styrigx's Space 的子站。读到、听到、想到一句好话，打开就记下；首页每天从公开的句子里挑一句，主站首页也能显示。界面用主站同一套 Styrigx UI：悬浮顶栏、九宫格切站、壁纸和外观设置。

## 能做什么

- 今日一句：按北京时间每天换一句，同一天所有人看到同一句。
- 记一句：原文、译文、作者、出处、标签，可设成只有自己看得到。
- 找句子：按标签筛，底部搜索胶囊搜正文、译文、作者和出处。
- 访客只读，只看到公开的句子。

## 怎么搭的

| 部分 | 用什么 |
|---|---|
| 页面 | Hugo + Tailwind，Cloudflare Pages 只放静态文件 |
| 接口 | Worker `styrigx-daymark-core`（`workers/core/`），路由 `daymark.styrigx.com/api/*` |
| 数据 | Cloudflare D1 `styrigx-daymark` |
| 登录 | 不持任何钥匙：页面由主站鉴权网关验会话，接口经服务绑定问网关 |

目录说明见 [STRUCTURE.md](STRUCTURE.md)。

## 本地开发

```bash
npm ci
npm run build:css
hugo server -s web
npm test            # 单元测试（Node 22+，D1 的 SQL 用 node:sqlite 真跑）
npm run test:e2e    # 手机 E2E（先 hugo --minify -s web）
```

## 许可

[MIT](LICENSE)
