---
description: Download a BBC Maestro course for offline viewing. Merges .ts fragments, transcodes to AV1, and updates the local HTML UI. Resumes automatically if interrupted.
---

# /download

Download a BBC Maestro course, converting each video to AV1 format.

Usage: `/download <course title>`

## Steps

1. Load credentials and root path from `~/.claude/plugins/maestro-downloader/.env`.
   If `.env` is missing, tell the user to run `/setup` first.

2. Resolve the course folder: `<root>/courses/<ConciseCourseTitle>/`.
   Create it if it doesn't exist.

3. Load or create `config.json` in the course folder:
   - If it doesn't exist, run `node lib/discover.js "<course title>"` to fetch the course's
     full video index (categories → videos) and save it as `config.json`.
   - If it exists, load it (enables resume from previous interrupted download).

4. Run `node lib/download.js "<course title>"` which processes each video sequentially:

   For each category → each video (skipping those already marked `complete: true`):
   - Log: `Downloading [<category>] <index>. <video title>...`
   - Download all `.ts` fragments via the headless browser
   - Merge fragments: `ffmpeg -f concat -i fragments.txt -c copy merged.ts`
   - Transcode to AV1: `ffmpeg -i merged.ts -c:v libaom-av1 -crf 30 -b:v 0 -c:a copy output.av1`
   - Save to `<root>/courses/<ConciseCourseTitle>/videos/<ConciseCategoryTitle>/<N-ConciseVideoTitle>.av1`
   - Update `config.json`: mark video as `complete: true`
   - Apply rate-limiting delay (exponential backoff + jitter) before next video

5. After all videos complete:
   - Update `<root>/index.json` to include this course entry
   - Log: `✓ Course "<title>" download complete. Open <root>/index.html to view.`

6. If the command is re-run on a course already partially downloaded, it resumes from
   the first incomplete video (all `complete: true` videos are skipped).

## Notes

- Progress is saved after every individual video, so an interrupted download is safe to resume.
- ffmpeg and Node.js 18+ must be installed on the system.
- Downloading a full course may take several hours; the terminal must remain open.
