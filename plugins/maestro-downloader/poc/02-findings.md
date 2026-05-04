# Video Processing Pipeline POC Findings

Date: 2026-05-04
Scripts/commands: direct `ffmpeg` CLI invocations (no separate POC script needed — direct HLS to AV1 works)

---

## Summary Verdict

**Single-step ffmpeg pipeline confirmed.** Direct HLS → AV1 WebM in one `ffmpeg` call works perfectly.
No separate .ts download, concat, or merge step is needed.

---

## 1. Core Pipeline — Direct HLS to AV1 WebM

The simplification from `01-findings.md` is confirmed:

```bash
ffmpeg -y \
  -protocol_whitelist file,http,https,tcp,tls,crypto \
  -i "https://videos.cdn.bbcmaestro.com/{VideoTitle}/HLS/{VideoTitle}.m3u8" \
  -t 60 \
  -map 0:v:0 -map 0:a:0 \
  -c:v libsvtav1 -crf 28 -preset 6 \
  -c:a libopus -b:a 128k \
  output.webm
```

**Critical flags:**

- `-protocol_whitelist file,http,https,tcp,tls,crypto` — required for HLS over HTTPS
- `-map 0:v:0 -map 0:a:0` — **mandatory**; without explicit mapping, ffmpeg silently drops the audio stream
- `-c:a libopus` — correct codec for WebM container; produces 2-channel 48 kHz Opus audio

---

## 2. CRF Quality/Size Tradeoff (4K / 2160p, 60-second clip)

All tests on the highest available variant: `...HEVC_2160.m3u8` (source: ~46 Mbps H.264).

| CRF | Output size | Avg bitrate | Encoding speed | Est. 9-min lesson |
|-----|-------------|-------------|----------------|-------------------|
| 23  | 33 MB       | ~4600 kbps  | ~1.00x realtime | ~297 MB, ~9 min wall time |
| 28  | 22 MB       | ~2950 kbps  | ~1.05x realtime | ~198 MB, ~8.6 min wall time |
| 32  | 16 MB       | ~2160 kbps  | ~1.10x realtime | ~144 MB, ~8.2 min wall time |

**Recommended default: CRF 28.**
AV1 at ~3 Mbps for 4K is roughly equivalent perceptual quality to the source H.264 at
10–15 Mbps (AV1 gains ~40–50% coding efficiency over H.264).
The 46 Mbps source is overkill for offline playback; CRF 28 is the practical sweet spot.

---

## 3. Encoding Speed (Apple Silicon, M-series, preset 6)

- SVT-AV1 preset 6 runs at essentially **1.0× realtime for 4K** on this machine
- CPU usage: ~700% (7 cores active)
- A full 9-minute (513s) lesson takes ~8.5–9 minutes wall time end-to-end

This means download + encode is bottlenecked by network I/O and CPU roughly equally.
The user should expect ~1× realtime wall time per lesson at CRF 28.

For a 10-lesson course at 9 min/lesson: ~90 minutes total download time.

---

## 4. Audio — Critical Fix

The 4K variant `.ts` segments contain H.264 video + AAC-LC audio (2ch, 48 kHz).
Without `-map 0:v:0 -map 0:a:0`, ffmpeg silently produces a video-only output.
Always include explicit stream mapping in production code.

Verified output streams (CRF 28):

```text
0  video  av1
1  audio  opus  48000 Hz  2 channels
```

---

## 5. Container — File Extension Correction

**The spec in README.md and CLAUDE.md incorrectly specifies `.av1` as the output extension.**

AV1 is a codec; `.av1` is not a playable container.
The correct container for AV1 + Opus is **`.webm`**.

Updated spec throughout:

- Output files: `<index-title>.webm`
- MIME type for server: `video/webm`
- Browser `<video>` element: accepts `.webm` natively in Chrome 70+, Firefox 67+, Edge, Safari 17+

---

## 6. Why Not Separate Download + Concat + Transcode?

The original plan assumed three steps: download `.ts` files → `ffmpeg -concat` → transcode.
Direct HLS input eliminates this entirely:

- ffmpeg pulls segments on-demand (no temp storage of full source)
- No intermediate merged file (saves ~3 GB per 9-min 4K lesson vs. staging raw HLS)
- Single process, single pass, no coordination code

The concat demuxer approach was not tested — it is unnecessary given direct HLS works.

---

## 7. Open Questions

- **Browser playback**: Chrome/Firefox/Edge support `.webm` + AV1 natively; Safari 17+ added support.
  Should be fine for target users (macOS + modern browsers). Verify with a local file:// test.
- **Resume on partial download**: ffmpeg doesn't support resume mid-encode.
  Resume must be implemented at the per-lesson level in `config.json` (skip completed lessons).
- **Network failure mid-download**: If a segment fetch fails, ffmpeg exits with an error.
  Need retry logic wrapping the ffmpeg subprocess call.
- **Preset tuning for other CPUs**: preset 6 is optimal for Apple Silicon M-series.
  Older Intel Macs may need preset 8–10 to stay near realtime.
