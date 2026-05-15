# Phase 1.5 — scrapeCoursePage Audit

Date: 2026-05-14
Method: Code reading of `lib/fetch-list.js:116-192` + cross-reference against the live index.json category structures observed post-Phase-1.3 schema migration.

---

## Summary Verdict

**Post-fixture finding (2026-05-14): the premise of Phase 1.5 was wrong.**
BBC Maestro course pages **do not expose any category structure for downloadable lessons** in their post-render DOM.
Every course page renders its lessons as a single flat `<ul>` inside `<div id="lessons">` — no headings, no groupings, no nested containers.
The 42 `<h2>` tags every fixture contains are entirely page-template noise (nav, footer, marketing testimonials, related-courses sidebar).

The current `scrapeCoursePage()` walks those `<h2>`s and treats each one as a category delimiter (unless its text matches a four-phrase navigation-noise denylist).
That's not "missing real categories"; it's **fabricating false ones from page-template noise** — exactly the failure mode observed in the live index.

### The actual fix

Drop the heading-walk heuristic entirely.
Always emit a single `[{ title: 'Lessons', lessonLinks: uniqueLessons }]` category — which is also the current code's fallback path (lib/fetch-list.js:160-161) when no headings are detected.
The net change is **deleting ~30 lines** of fragile structural code; no new parsing strategy is needed.

### One genuine multi-category structure exists, but it's out of scope

`eric-vetro/singing` has a separate `<div id="practices">` tab containing 18 `<details>`/`<summary>` disclosure groups (Vocal Slides, Humming, Lip Bubbling, etc.) totalling 105 practice videos.
These use a distinct URL pattern: `/courses/<slug>/practices/<group>/<item>` rather than `/courses/<slug>/lessons/<item>`.
The live index has **0 entries** with `/practices/` URLs across all 1204 videos, meaning the current scraper has never captured them and the existing 556 downloaded videos are all `/lessons/`.
**Phase 1.6 territory** — adding `/practices/` support is a feature decision, not a fix.

---

## 1. What the current parser does

`scrapeCoursePage()` runs entirely inside a Playwright `page.evaluate(...)` callback after `networkidle`.
The relevant DOM logic (paraphrased from lines 149-189):

```js
const NAV_HEADING = /explore|browse|all courses|see all/i;

// Step 1: collect every "small" heading whose text isn't navigation noise.
const categoryHeadings = new Set();
for (const node of body.querySelectorAll('h2, h3, h4')) {
  const text = node.textContent.trim();
  if (text && text.length < 100 && !NAV_HEADING.test(text)) {
    categoryHeadings.add(node);
  }
}

// Step 2: walk every node in document order. When we hit a "category heading",
// flush the accumulated lessons into a category with that heading's text;
// otherwise, if the node is a lesson <a>, append it to the current category.
let currentCatTitle = 'Lessons';
let currentLessons = [];
for (const node of allNodes) {
  if (categoryHeadings.has(node)) {
    if (currentLessons.length > 0) {
      categories.push({ title: currentCatTitle, lessonLinks: currentLessons });
      currentLessons = [];
    }
    currentCatTitle = node.textContent.trim();
  } else if (node.tagName === 'A' && lessonHrefSet.has(node.href)) {
    currentLessons.push({ href, text });
  }
}
```

### Failure modes baked into this approach

1. **Marketing headings get treated as category boundaries.** Anything inside the page's `<main>` that BBC Maestro authored as `<h3>What you'll learn</h3>` or `<h2>About Eric Vetro</h2>` becomes a category title, fragmenting the real categories or capturing zero lessons under a fake one.
2. **The real category boundary may not be a heading at all.** Modern SPAs typically render groupings as React/Vue components with data-attributes or stable class names; the heading text is presentational rather than structural. A purely text-driven walk misses these.
3. **The `NAV_HEADING` regex is a denylist, not an allowlist.** It only filters the four phrases the author noticed during initial development. Any other navigation-or-marketing heading is silently treated as a category, with no way to detect that it's wrong without comparing to a known-good source.
4. **Document-order traversal is brittle to layout changes.** Sidebar widgets, modal headings, and "you might also like" rails all flow into the same walk; whichever appears before a lesson link "captures" that lesson.

---

## 2. Live evidence — all-48 distribution and per-fixture finding

Category-count distribution across all 48 courses in `~/xfer/maestro/index.json` (post-Phase-1.3 migration):

| Category count | Course count |
| -------------: | -----------: |
| 1 | 43 |
| 2 | 4 |
| 21 | 1 |

The 5 courses with >1 categories are the entire fix surface:

| Slug | Cats in index | Total videos | Correct shape (per fixtures) |
| ---- | ------------: | -----------: | ---------------------------- |
| `mark-ronson/music-production` | 2 | 18 | 1 (flat playlist, no headings in lessons panel) |
| `alan-moore/storytelling` | 2 | 33 | (not captured — `alan-moore/writing-fiction` 404'd) |
| `oliver-burkeman/time-management` | 2 | 22 | 1 (flat playlist) |
| `eric-vetro/singing` | 2 | 31 | 1 for `/lessons/`; separate Practices tab is Phase 1.6 |
| `owen-o-kane/a-life-less-anxious` | 21 | 22 | 1 (flat playlist — current 21 cats are pure h2-noise) |

The 43 single-cat courses are unaffected by the fix.
For the 5 multi-cat courses, the fix converges all of them onto `[{ title: 'Lessons', videos: […all of them…] }]`.

### Why those h2 tags exist

Every fixture (regardless of course) contains **exactly 42 `<h2>` tags** — same count, same DOM template.
They come from the page shell: related-courses sidebar, instructor bio header, customer reviews, the "Lessons" tab heading itself, etc.
The `<h2>` distribution is structurally identical across all 5 fixtures — there is no per-course signal in the heading tree.

---

## 3. What the rewrite needs

Concretely, the new parser needs to:

1. **Run against captured `page.content()` HTML fixtures, not against a live page.** Lets us TDD without a browser.
   This requires either (a) extracting the parsing logic into a pure function that takes a DOM root, with `jsdom` driving it in tests, or (b) keeping the logic inside `page.evaluate()` but adding a separate `parseCoursePageHtml(html, courseUrl)` pure-Node entry point used only by tests.
   Option (a) is cleaner.
2. **Replace the heading-walk with a structural selector.** Determining the right selector requires the Phase 1.4 fixtures to be in hand — likely some combination of:
   - The lesson list's *container* element class/data attribute
   - The category header's *container* (not its `<h2>` text node)
   - A check that the category container actually contains lesson `<a>` descendants before recording it
3. **Add a sanity-check post-pass.** Reject category trees whose shape is clearly degenerate — e.g. >50% of categories holding exactly one lesson — and fall back to a single `Lessons` bucket with a logged warning rather than persisting nonsense.
4. **Add unit tests for each known-broken course.** Each captured fixture becomes a golden test: input HTML, expected category tree (shape only — actual lesson URLs vary). Locks in the fix and prevents future regressions if BBC Maestro changes their DOM.
5. **Update the `MIGRATION_REQUIRES_REFETCH_AFTER` constant in `lib/migrate.js`** (currently `null`) to the commit SHA of the Phase 1.5 ship. Removes the manual `--i-have-re-fetched` gate so Phase 3 file migration can run safely.

---

## 4. Open questions for next session

These can only be answered with the Phase 1.4 fixtures in hand:

- Is there a single stable selector that delimits a category across all the broken courses, or does each layout need its own branch?
- Does the page expose any JSON-LD or `<script type="application/ld+json">` that already encodes the category tree?
  If so, that's a far more reliable source than DOM-walking.
- Do any courses use nested categories (subcategory tree), and if so, does the v2 schema's `subcategories[]` field need to be exercised by Phase 1.5 or is "flat with deeper titles" sufficient?

---

## 5. Out of scope for this audit

- Manifest URL extraction (`getLessonManifest`) — unaffected by category-walk bugs.
  The one `manifestUrl: null` record found during the Phase 1.3 migration (Pierre Koffmann / Pistachio soufflé) is a per-lesson scrape failure, not a category-structure issue.
- Resume logic — orthogonal to the parsing problem.
- The `categoryHeadings.size === 0 || uniqueLessons.length === 0` fallback path that emits a single `Lessons` bucket — this *is* correct for the genuinely single-category courses; Phase 1.5 should preserve that behavior, not replace it.
