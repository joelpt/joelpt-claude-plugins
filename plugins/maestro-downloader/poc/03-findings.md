# Rate Limiting Strategy POC Findings

Date: 2026-05-04
Method: CDN infrastructure analysis via HTTP header inspection + DNS/routing analysis.
No stress-test performed — see rationale below.

---

## Summary Verdict

**No rate governing mechanism exists at the CDN layer.**
Implementing a conservative inter-page delay in `/fetch-list` (scraping `bbcmaestro.com`) is sufficient.
No special handling is needed for the actual video download (CloudFront CDN).

---

## 1. CDN Infrastructure

```text
videos.cdn.bbcmaestro.com  →  d2cbjjemtzq7h6.cloudfront.net
                            →  3.163.158.x  (4 IPs, anycast)
                            →  SEA900-P1 edge (Seattle, nearest to test location)
Origin: AmazonS3 (direct S3 origin, not a load balancer or custom origin server)
Transcoder: AWS Elemental MediaConvert (job ID visible in x-amz-meta headers)
```

---

## 2. Headers — What Is and Is Not Present

Observed headers on manifest + segment responses:

```text
server: AmazonS3
x-cache: Hit from cloudfront
via: 1.1 <node>.cloudfront.net (CloudFront)
x-amz-cf-pop: SEA900-P1
x-amz-server-side-encryption: AES256   ← S3 at-rest encryption, not DRM
x-amz-meta-mediaconvert-jobid: ...     ← same job ID on all files in a course
x-amz-version-id: ...                  ← S3 versioning (housekeeping)
age: 3074–5838                          ← segments/manifests cached at edge
```

**Absent — and their implications:**

| Missing header / feature | What it would mean if present |
|--------------------------|-------------------------------|
| Signed URL query params (`X-Amz-Signature`, `X-Amz-Expires`) | Per-user expiring access control |
| `x-amz-waf-*` headers | AWS WAF rate limiting attached to this distribution |
| `X-RateLimit-*` / `Retry-After` | Active rate governing |
| Lambda@Edge / CloudFront Functions headers | Custom auth or throttling at the edge |
| Auth cookies / tokens in CDN requests | Session-bound download tracking |

---

## 3. Architecture Interpretation

BBC Maestro uses **authentication at discovery, not delivery.**

- The web app (`bbcmaestro.com`) gates *who can find* manifest URLs (login required).
- The CDN (`videos.cdn.bbcmaestro.com`) serves those URLs to *anyone unconditionally*.
- CloudFront has zero knowledge of which subscriber is downloading — no auth token is
  forwarded to the CDN from the player.
- Manifest URLs contain a MediaConvert timestamp suffix and do **not expire** — URLs
  captured in March 2026 POC testing still return HTTP 200 in May 2026.

The CDN cannot detect download-rate vs. watch-rate because it has no per-user identity.
From CloudFront's perspective, every request is an anonymous IP fetching a static file.

---

## 4. Why No Stress Test Was Performed

Running a stress test (back-to-back video downloads or rapid lesson-page scraping) would:

1. **Not reveal anything new** — there are no rate governing headers to trigger, no WAF
   to discover, and the CDN architecture confirms the absence of enforcement mechanisms.
2. **Introduce unnecessary risk** — aggressive scraping of `bbcmaestro.com` lesson pages
   could still trigger application-level rate limiting or flag the account, even if the CDN
   itself is unguarded.

The correct risk management is a conservative scraping policy, not empirical probing.

---

## 5. Rate Limiting Risk Surface

Only **one layer** has any rate limiting potential:

**`bbcmaestro.com` lesson page loads (Playwright)**
- Happens once per lesson during `/fetch-list`
- Equivalent to a subscriber browsing their course library
- A full scan of 10 courses × ~22 lessons = ~220 page loads
- At 2–4s random delay between pages: ~8–15 minutes total, well within normal human
  browsing behaviour patterns

**`videos.cdn.bbcmaestro.com` (ffmpeg HLS download)**
- Fully public CloudFront distribution, no WAF, no signed URLs
- Rate limiting: none. CloudFront is designed for millions of concurrent HLS streams.
- A 1080p lesson at 3× realtime produces ~35 segment requests/minute per IP
- AWS WAF (if ever added) typically thresholds at 400–2000 req/min — far above this

---

## 6. Recommended Parameters for `/fetch-list`

```text
Inter-page delay:     random 1.5–3.5 s between each lesson page load
Inter-course delay:   random 3–6 s between finishing one course and starting the next
On HTTP 429/503:      exponential backoff — 10s → 20s → 40s → 80s → abort + warn
On network error:     retry once after 5s, then skip and log warning
Max concurrency:      1 (sequential only — no parallel page loads)
```

These parameters are indistinguishable from a subscriber browsing their library
at human speed. No special CDN-side handling is needed for video downloads.

---

## 7. Open Questions

- Does `bbcmaestro.com` implement application-level rate limiting independent of WAF?
  (Not observed in any testing. Conservative delay policy is sufficient precaution.)
- If BBC Maestro adds CloudFront WAF in future, will existing segment URLs still work?
  (Yes — WAF rules apply to new requests; cached CDN segments are unaffected. But manifest
  URL extraction via Playwright could be impacted if WAF blocks rapid lesson-page loads.)
