---
description: Open the maestro-downloader Ink TUI (subscribe, content-type, rescan, download).
---

Run `node lib/tui/main.js` from the plugin directory. The TUI reads `<MAESTRO_ROOT>/index.json`, presents one row per course, and accepts these keys:

- `↑↓` — navigate
- `Space` — toggle the highlighted course's `subscribed` flag
- `t` — cycle the highlighted course's `contentType` (default → speech → music → visual → lean → ...)
- `r` — rescan (spawns `node lib/fetch-list.js`)
- `d` — download all subscribed-and-pending (spawns `node lib/queue.js`)
- `Esc` — SIGTERM the running subprocess
- `q` — quit

Subprocess output streams to a tail panel at the bottom. State changes are persisted to `index.json` via the schema-validated atomic writer; external writes (e.g. by the running subprocess) are picked up via `fs.watch` with a 200 ms debounce.
