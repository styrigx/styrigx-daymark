<div align="center">

[中文](README.md) | English

# Styrigx Daymark

Lines worth keeping, saved as they come, one shown each day.

[daymark.styrigx.com](https://daymark.styrigx.com) · [styrigx.com](https://styrigx.com) · [blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

</div>

---

## What it is

A sub-site of Styrigx's Space. Save a line you read, heard or thought of; the home page picks one public line per day (Beijing time), and the main site's home can show it too. Same Styrigx UI as the main site.

## Features

- Line of the day: changes daily, the same for everyone on a given day.
- Save a line: text, translation, author, source, tags; can be private.
- Find lines: tag filter and a search capsule over text, translation, author and source.
- Visitors are read-only and only see public lines.

## Stack

| Part | Tech |
|---|---|
| Pages | Hugo + Tailwind on Cloudflare Pages (static only) |
| API | Worker `styrigx-daymark-core` (`workers/core/`) on `daymark.styrigx.com/api/*` |
| Data | Cloudflare D1 `styrigx-daymark` |
| Auth | Holds no keys: the main site's auth gateway checks sessions for pages; the API asks it via a service binding |

## License

[MIT](LICENSE)
