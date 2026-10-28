<div align="center">

[中文](README.md) | English

# Styrigx Daymark

Lines worth keeping, saved as they come, one shown each day.

[daymark.styrigx.com](https://daymark.styrigx.com) · [styrigx.com](https://styrigx.com) · [blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-space/main/.github/actions/setup-hugo/action.yml&query=%24..HUGO_VERSION&label=Hugo&style=flat-square&color=2563eb&logo=hugo)
![Tailwind CSS](https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/styrigx/styrigx-daymark/main/package-lock.json&query=%24.packages%5B%27node_modules%2Ftailwindcss%27%5D.version&label=Tailwind%20CSS&style=flat-square&color=2563eb&logo=tailwindcss)
![Styrigx UI](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-space/main/web/data/version.yaml&query=%24.ui&label=Styrigx%20UI&style=flat-square&color=2563eb)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-daymark/main/web/hugo.yaml&query=%24.params.version&label=Daymark&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-daymark/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

## What it is

A sub-site of Styrigx's Space, with its own repo, Pages project, Worker (`styrigx-daymark-core`) and D1 database. Save a line you read, heard or thought of; one public line is picked per day (Beijing time), and the main site's home can show it too. It is a Styrigx UI immersive app like the blog: app grid on the left, three tabs Echo · Trove · Flavors in the middle, share button on the right (the admin generates a short link with a temporary session; visitors share the current page). Theme, palette, accent and language follow the main site's settings (the `sgx-ui` cookie, read before first paint).

## Features

- **Echo** (default): today's line, full screen. Today's line is locked in D1 on the first request of the day (Asia/Shanghai), so adding lines no longer changes it. "Draw another" picks a random line, "Back to today" returns; the admin can "Set as today" on a drawn public line (the main site's card and lock screen follow); long-press copies, the corner button shares.
- **Trove**: every line, newest first. The admin gets a "Save a line" button and taps a line to edit it; private lines show a small lock.
- **Flavors**: the admin's own collections (name + one-line intro, reorder and remove lines), then automatic groups by author ("People").
- **Save a line**: live preview; line, translation (behind "+ Add translation"), author (autocomplete + recent authors), source (Poetry / Book / Film / Song / Interview / Mine + title), collections, tags, a private note (admin only), public toggle.
- Visitors are read-only and only see public lines; the private note never appears in visitor responses or `/api/today`.

## Stack

| Part | Tech |
|---|---|
| Pages | Hugo + Tailwind 4 (CSS-first config in `web/assets/css/input.css`, built by `@tailwindcss/cli`) on Cloudflare Pages (static only) |
| API | Worker `styrigx-daymark-core` (`workers/core/`) on `daymark.styrigx.com/api/*` |
| Data | Cloudflare D1 `styrigx-daymark-core` |
| Auth | Holds no keys: the main site's auth gateway checks the lock session (`sgx-lock-session`) for pages; the API asks it via a service binding (`AuthVerifier.lockSession`, roles `admin` / `visitor`) |

## Shared shell

Colour roles (13 presets × light/dark + custom seed), top-bar material, nav drawer, the custom-accent engine and the drawer items come from the main site
(styrigx-space `web/shared/shell`). The copy lives in the `@sgx-shell:begin / end` block of `web/assets/css/input.css`, `web/assets/js/sgx/shell/` and
`web/assets/sgx-shell/`, with source and version in `sgx-shell.lock.json`. **Don't edit it by hand**: after the main site changes, run
`node scripts/sync-shell.mjs` (default ref `main`; `--ref <branch>`; `--from <local checkout>`), then `npm run build:css`. CI runs `--check`.

### Appearance cookie (`sgx-ui`)

Theme, palette and accent come from the `sgx-ui` cookie written by the main site (read-only here). Attributes, fields, versions, legacy migration and how to change the format:
[docs/ui-cookie-contract.md](https://github.com/styrigx/styrigx-space/blob/main/docs/ui-cookie-contract.md) in styrigx-space (Chinese).
It is read by the main site's shared-shell reader `web/assets/js/sgx/shell/ui-cookie-read.js` (synced verbatim by sync-shell, do not edit),
inlined into `<head>` by `web/layouts/_default/baseof.html`; `web/assets/js/sgx/ui-inherit-run.js` right after it calls `SgxUI.apply` before first paint.
Language follow lives in `web/assets/js/sgx/lib/ui-inherit.js`: it only uses the reader's `SgxUI.read().lang` (the language the user explicitly picked on the main site, `zh` / `en`; empty = follow system, no redirect).
The contract fixtures `tests/fixtures/ui-cookie-contract.json` (also synced) run case by case in `tests/web/ui-cookie-contract.test.mjs` and `tests/web/e2e/ui-cookie.spec.js`.
If the main site changes the cookie format, run `node scripts/sync-shell.mjs` to sync the reader and fixtures; no code change needed here.

## Seed data

Migration `0003_seed_quotes` adds 63 seed lines (Nietzsche and *The Great Gatsby*) and two collections of the same names. It only inserts: lines whose exact text already exists are skipped, an existing collection with the same name is reused, nothing is updated or deleted. Regenerate with `node scripts/gen-seed-sql.mjs <quotes.json>` (the source texts are not in the repo).

## License

[MIT](LICENSE)
