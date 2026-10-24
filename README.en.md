<div align="center">

[中文](README.md) | English

# Styrigx Daymark

Lines worth keeping, saved as they come, one shown each day.

[daymark.styrigx.com](https://daymark.styrigx.com) · [styrigx.com](https://styrigx.com) · [blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

</div>

---

## What it is

A sub-site of Styrigx's Space. Save a line you read, heard or thought of; one public line is picked per day (Beijing time), and the main site's home can show it too. It is an immersive app like the blog: app grid on the left, three tabs Echo · Trove · Flavors in the middle, avatar on the right. Theme, palette, accent and language follow the main site's settings (the `sgx-ui` cookie, read before first paint).

## Features

- **Echo** (default): today's line, full screen. Today's line is locked in D1 on the first request of the day (Asia/Shanghai), so adding lines no longer changes it. "Draw another" picks a random line, "Back to today" returns; the owner can "Set as today" on a drawn public line (the main site's card and lock screen follow); long-press copies, the corner button shares.
- **Trove**: every line, newest first. The owner gets a "Save a line" button and taps a line to edit it; private lines show a small lock.
- **Flavors**: the owner's own collections (name + one-line intro, reorder and remove lines), then automatic groups by author ("People").
- **Save a line**: live preview; line, translation (behind "+ Add translation"), author (autocomplete + recent authors), source (Poetry / Book / Film / Song / Interview / Mine + title), collections, tags, a private note (owner only), public toggle.
- Visitors are read-only and only see public lines; the private note never appears in visitor responses or `/api/today`.

## Stack

| Part | Tech |
|---|---|
| Pages | Hugo + Tailwind on Cloudflare Pages (static only) |
| API | Worker `styrigx-daymark-core` (`workers/core/`) on `daymark.styrigx.com/api/*` |
| Data | Cloudflare D1 `styrigx-daymark-core` |
| Auth | Holds no keys: the main site's auth gateway checks sessions for pages; the API asks it via a service binding |

## Shared shell

Colour roles (13 presets × light/dark + custom seed), top-bar material, nav drawer, the custom-accent engine and the drawer items come from the main site
(styrigx-space `web/shared/shell`). The copy lives in the `@sgx-shell:begin / end` block of `web/assets/css/input.css`, `web/assets/js/sgx/shell/` and
`web/assets/sgx-shell/`, with source and version in `sgx-shell.lock.json`. **Don't edit it by hand**: after the main site changes, run
`node scripts/sync-shell.mjs` (default ref `main`; `--ref <branch>`; `--from <local checkout>`), then `npm run build:css`. CI runs `--check`.

## Seed data

Migration `0003_seed_quotes` adds 63 seed lines (Nietzsche and *The Great Gatsby*) and two collections of the same names. It only inserts: lines whose exact text already exists are skipped, an existing collection with the same name is reused, nothing is updated or deleted. Regenerate with `node scripts/gen-seed-sql.mjs <quotes.json>` (the source texts are not in the repo).

## License

[MIT](LICENSE)
