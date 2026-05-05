---
description: Start the local Maestro Archive web server to browse and play downloaded courses in your browser.
---

# /serve

Start the local HTTP server that serves the Maestro Archive UI and your downloaded videos.

## Steps

1. Determine the plugin directory.
   It is the directory containing this commands file — typically
   `~/.claude/plugins/maestro-downloader/` or wherever the plugin is installed.

2. Check that `~/.claude/plugins/maestro-downloader/.env` exists and `MAESTRO_ROOT` is set.
   If not, tell the user to run `/setup` first.

3. Run the server:

   ```bash
   node lib/serve.js
   ```

   from the plugin directory (e.g. `cd ~/.claude/plugins/maestro-downloader && node lib/serve.js`).

4. Report the URL to the user:

   ```
   Maestro Archive running at http://localhost:8080
   Open this URL in your browser to browse and play downloaded courses.
   Press Ctrl+C to stop the server.
   ```

## Notes

- The default port is **8080**. Set `MAESTRO_PORT` in `.env` to use a different port.
- The server serves the course archive UI from the plugin directory and your downloaded video
  files from `MAESTRO_ROOT`. No files are exposed outside `MAESTRO_ROOT`.
- Keep the server running while watching videos; closing it will interrupt playback.
