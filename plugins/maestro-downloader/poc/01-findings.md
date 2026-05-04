# BBC Maestro Browser Automation POC Findings

Date: 2026-05-04
Scripts run: `poc/01-bbc-maestro-browser.js`, `poc/02-login-and-video.js`, `poc/03-login-fix-and-course-access.js`

---

## Summary Verdict

**Plugin is viable.** No DRM. CDN is fully open. Browser automation works.

---

## 1. DRM Status — ABSENT (Critical Gate)

**Result: No DRM detected on promotional content OR actual course lessons.**

Manifests are plain HLS version 3 with no `#EXT-X-KEY` directive.
Verified on both public trailers and an authenticated course lesson (Owen O'Kane "Dare to Dream", Lesson 22/22).

Sample media manifest (confirmed DRM-free):

```text
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:5,
22_OwenOKane_ALifeLessAnxious_Lesson22_DareToDream_HEVC_72020260310T141947_00001.ts
#EXTINF:5,
...
#EXT-X-ENDLIST
```

Note: S3 headers include `x-amz-server-side-encryption: AES256` — this is server-side at-rest
encryption in S3 (AWS compliance), fully transparent to the client. Not DRM.

---

## 2. CDN Access — Publicly Open (No Auth Required)

**Result: `.ts` segment files are directly downloadable with no authentication whatsoever.**

```text
GET https://videos.cdn.bbcmaestro.com/22_OwenOKane_.../HLS/...00001.ts
→ HTTP 200, video/MP2T, Access-Control-Allow-Origin: *
→ Served by CloudFront (S3 origin)
```

Architecture implication: browser automation is needed only to **extract manifest URLs**
from lesson pages. Actual downloading of `.m3u8` manifests and `.ts` segments can be done
with plain HTTP (`fetch`/`curl`) — no session, no cookies, no browser during download.

---

## 3. Login — 2-Step Email + Password with reCAPTCHA

**Result: Login works but has reCAPTCHA on the submit step.**

Flow:
1. Navigate to `https://www.bbcmaestro.com/users/sign_in`
2. Fill `#user_email` (Stimulus.js enables Submit after input)
3. Click "Continue" → POST to `/users/identity`
4. Password field appears; fill it
5. Submit → reCAPTCHA verification on server
6. Session cookie set → redirect to home/dashboard

The reCAPTCHA check appears to run **after** the session cookie is set.
In headless tests, reCAPTCHA returned an error message but the session was still valid
(authenticated lesson content was successfully loaded in the same session).

**Login selectors:**

```text
Email:    #user_email  (or input[name="user[email]"])
Password: input[type="password"]  (or #user_password)
Submit:   input[type="submit"]  — starts disabled, Stimulus enables on email input
```

**Anti-bot:** No 429/503 observed. reCAPTCHA is the only protection.

**Recommendation:** Use `playwright-extra` with stealth plugin for production.
If still blocked, fall back to cookie import from a real browser session.

---

## 4. URL Structure

```text
Course list:   https://www.bbcmaestro.com/courses
Course page:   https://www.bbcmaestro.com/courses/{instructor-slug}/{course-slug}
Lesson page:   https://www.bbcmaestro.com/courses/{instructor-slug}/{course-slug}/lessons/{lesson-slug}
               ?autoplay=true#lesson-player (optional params)

HLS master:    https://videos.cdn.bbcmaestro.com/{VideoTitle}/HLS/{VideoTitle}.m3u8
HLS variant:   https://videos.cdn.bbcmaestro.com/{VideoTitle}/HLS/{VideoTitle}_{res}.m3u8
TS segment:    https://videos.cdn.bbcmaestro.com/{VideoTitle}/HLS/{VideoTitle}_{res}{timestamp}_{seq:05d}.ts
```

Video title naming convention: `{LessonNum}_{InstructorName}_{CourseSlug}_{LessonTitle}_HEVC`

---

## 5. HLS Format Details

- **Container:** MPEG-TS (`.ts`)
- **Video codec:** H.264 (AVC) — `avc1.77.30` (360p), `avc1.4d401f` (720p), `avc1.4d4028` (1080p), `avc1.4d4033` (2160p)
- **Audio codec:** AAC-LC (`mp4a.40.2`)
- **Segment duration:** 5 seconds
- **Playlist type:** VOD (`#EXT-X-PLAYLIST-TYPE:VOD`)
- **Resolutions available:** 360p, 720p, 1080p, 2160p (4K)
- **Frame rate:** 25 fps

Segment count for a 9-minute lesson: ~108 segments × 5s = 540 seconds = 9 minutes.

---

## 6. Course List DOM Structure

Course cards use class `vc-poster position-relative` (`<a>` elements).
Category filter buttons use class `btn btn-pill`.

Accessible courses appear on `/courses` with `vc-poster` tiles.
Lesson links from course pages: `<a href="/courses/.../lessons/...?autoplay=true#lesson-player">`

---

## 7. Subscription Model

Account (joelpt@joelpt.net) appears to have a subscription covering multiple courses:
`owen-o-kane`, `marina-abramovic`, `agatha-christie`, `ago-perrone`,
`isabel-allende`, `evy-poumpouras`, `trinny-woodall`, `beata-heuman`,
`eric-vetro`, `stephanie-romiszewski`.

Course pages require login + course access to see lesson links.
Course pages for non-subscribed courses show "Buy Course" / "Gift course" links only.

---

## 8. Anti-Bot Measures

- **reCAPTCHA:** On login submit step only
- **Rate limiting:** None observed (no 429/503 during testing)
- **CDN auth:** None — videos.cdn.bbcmaestro.com is fully public
- **Fingerprinting:** Unknown; recommend stealth mode as precaution

---

## 9. Architecture Implications

Given these findings, the download architecture should be:

1. **Session setup** (once per session): Use Playwright to log in, establish session cookies
2. **Course discovery** (per run): Playwright navigates course/lesson pages, extracts HLS manifest URLs
3. **Download** (bulk): Plain HTTP client downloads `.m3u8` and `.ts` files directly — no browser needed
4. **Merge**: `ffmpeg -f concat` (or direct HLS download with `ffmpeg -protocol_whitelist`)
5. **Transcode**: `ffmpeg` to AV1

The browser is only needed for steps 1–2. Steps 3–5 are pure file I/O.

**Simplification opportunity**: `ffmpeg` can download HLS streams directly:
```bash
ffmpeg -i "https://videos.cdn.bbcmaestro.com/.../HLS/...m3u8" \
       -c:v libsvtav1 -crf 28 -preset 6 \
       -c:a libopus -b:a 128k \
       output.mkv
```

This collapses the download+merge+transcode pipeline into a single ffmpeg call per video.

---

## 10. Open Questions

- Does reCAPTCHA consistently allow headless login with stealth mode?
- Are lesson manifest URLs stable/permanent, or do they rotate? (Segment timestamps suggest stable)
- Is there a REST API for course/lesson metadata? (Would avoid DOM scraping)
- What happens on a partial download if a segment 404s? (Need retry logic)
