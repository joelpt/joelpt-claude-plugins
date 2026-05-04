---
description: Download a BBC Maestro course for offline viewing. Transcodes directly from HLS to AV1 WebM via a single ffmpeg call per video. Resumes automatically if interrupted.
---

# /download

Download a BBC Maestro course for offline viewing.

Usage: `/download <course-slug>` or `/download <course-slug> --quality 4k`

Example: `/download owen-o-kane/a-life-less-anxious`

## Steps

1. Load `.env` from `~/.claude/plugins/maestro-downloader/`.
   If absent, tell the user to run `/setup` first and stop.

2. Verify `<root>/index.json` exists.
   If absent, tell the user to run `/fetch-list` first and stop.

3. Run `node lib/download.js "<course-slug>"` which:

   a. Looks up the course in `index.json` by slug or title.
      If not found, lists available courses and stops.

   b. Reports totals: N videos total, M to download, K already done.

   c. For each pending video (sequentially):
      - Skip if `completed: true`.
      - Derive 1080p variant URL: replace `.m3u8` → `_1080.m3u8` in the stored `manifestUrl`.
        With `--quality 4k`: use the master manifest URL directly.
      - Create output directory: `<root>/courses/<slug>/videos/<CategoryTitle>/`.
      - Spawn ffmpeg:
        ```bash
        ffmpeg -y \
          -protocol_whitelist file,http,https,tcp,tls,crypto \
          -i "<1080p_variant_url>" \
          -map 0:v:0 -map 0:a:0 \
          -c:v libsvtav1 -crf 28 -preset 6 \
          -c:a libopus -b:a 128k \
          "<output>.webm"
        ```
      - On ffmpeg exit 0: update `index.json` — set `completed: true`, `downloadedAt`, `localPath`.
      - On ffmpeg HTTP error (429/503): exponential backoff 10s → 20s → 40s → abort.
      - Log per-video status and running count.

4. Report summary: `<N> downloaded, <M> failed.`

## Notes

- No browser is needed — manifest URLs were captured during `/fetch-list`.
- Progress persists after each video; rerunning the command resumes from where it stopped.
- Default quality: **1080p** (~3× realtime, ~67 MB/lesson on Apple Silicon M-series).
- `--quality 4k` downloads the highest available variant (~1× realtime, ~198 MB/lesson).
- Encoding performance varies by CPU; Apple Silicon M-series shown above.
- ffmpeg must be installed with `libsvtav1` and `libopus` support (`brew install ffmpeg`).
