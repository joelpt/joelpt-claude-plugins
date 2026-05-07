# commit-commands TODO

## /commitall optimizations

Implemented:
- [x] Cache `git diff` to a unique `mktemp` file; pass path to reviewer instead of inlining diff
- [x] Drop `AskUserQuestion` when reviewer reports zero findings
- [x] Skip reviewer for docs/config-only changes — checks any source-code extension
  (`.ts`, `.js`, `.py`, `.sh`, `.go`, `.rb`, `.rs`, `.c`, `.cpp`, etc.) rather than just
  `.py`, reducing brittleness; accepted tradeoff that ADR/prose review is skipped

Deferred (correctness / quality trade-off not worth it):

- [ ] **Use `--stat` first; full diff only for flagged files** — reviewer sees less context;
  may miss cross-file coupling issues in the initial pass.

- [ ] **Run code-reviewer on Haiku** — lower cost but meaningfully lower catch rate on
  subtle bugs and security issues; paying the Sonnet tax is deliberate here.

- [ ] **Combine review + simplify into one agent pass** — the two passes catch different
  things: review finds bugs, simplify finds quality/redundancy. One pass degrades both.
