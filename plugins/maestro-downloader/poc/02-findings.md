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

## 2. CRF Quality/Size Tradeoff — 4K (2160p), 60-second clip

Source variant: `...HEVC_2160.m3u8` (~46 Mbps H.264).

| CRF | Output size | Avg bitrate | Encoding speed | Est. 9-min lesson |
|-----|-------------|-------------|----------------|-------------------|
| 23  | 33 MB       | ~4600 kbps  | ~1.00× realtime | ~297 MB, ~9 min |
| 28  | 22 MB       | ~2950 kbps  | ~1.05× realtime | ~198 MB, ~9 min |
| 32  | 16 MB       | ~2160 kbps  | ~1.10× realtime | ~144 MB, ~8 min |

At 4K, encoding speed is bottlenecked by network I/O (pulling ~46 Mbps of source).
All CRF values run at approximately 1× realtime — wall time ≈ video duration.

---

## 3. CRF Quality/Size Tradeoff — 1080p, 60-second clip

Source variant: `...HEVC_1080.m3u8` (~11.5 Mbps H.264).

| CRF | Output size | Avg bitrate | Encoding speed | Est. 9-min lesson |
|-----|-------------|-------------|----------------|-------------------|
| 23  | 10 MB       | ~1400 kbps  | ~4.0× realtime | ~90 MB, ~2.25 min |
| 28  | 7.4 MB      | ~1030 kbps  | ~3.0× realtime | ~67 MB, ~3 min    |
| 35  | 5.2 MB      | ~725 kbps   | ~3.7× realtime | ~47 MB, ~2.4 min  |
| 40  | 4.3 MB      | ~590 kbps   | ~3.7× realtime | ~39 MB, ~2.4 min  |

At 1080p, the bottleneck shifts to CPU — encode runs 3–4× faster than realtime.
The quality cliff hits around CRF 35: below that, sharpness visibly degrades at full screen.
CRF 40 at 590 kbps is below Netflix's SD floor; not recommended for 1080p content.

**Decided default: 1080p, CRF 28.**

Rationale:
- 3× faster than 4K (3 min vs 9 min per lesson), 3× smaller files (67 MB vs 198 MB)
- Perceptual quality difference between 1080p and 4K is imperceptible for instructor-on-camera
  educational content at normal viewing distances and screen sizes
- AV1 at ~1 Mbps for 1080p talking-head content is near-transparent quality
- 4K remains available via `--quality 4k` flag for future implementation

---

## 4. Encoding Speed (Apple Silicon, M-series, preset 6)

- 1080p CRF 28: **~3× realtime** — 9-min lesson encodes in ~3 min
- 4K CRF 28: **~1× realtime** — 9-min lesson encodes in ~9 min
- CPU usage: ~700% (7 P-cores saturated with SVT-AV1 NEON SIMD)

**For a 10-lesson course at ~9 min/lesson at 1080p (default):** ~30 min total, ~670 MB disk.

**For a 10-lesson course at ~9 min/lesson at 4K:** ~90 min total, ~2 GB disk.

---

## 5. Audio — Critical Fix

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
