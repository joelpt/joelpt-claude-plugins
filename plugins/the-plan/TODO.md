# the-plan — Build Roadmap

## v0.1 — Foundation

- [x] Plugin manifest (`.claude-plugin/plugin.json`)
- [x] README with philosophy + roadmap
- [x] CLAUDE.md project memory
- [x] ETHICS.md with refusal protocol
- [x] END_GOALS.md skeleton
- [x] STATE.md skeleton
- [x] APPROVAL_QUEUE.md, OPEN_QUESTIONS.md, CLAUDE_NOTES.md
- [x] tend-the-plan skill
- [x] /plan-tend, /plan-status, /plan-approve commands
- [x] Justfile with tend/status/review/smoke
- [x] ADR-0001 (infrastructure foundations)
- [x] ADR-0002 (markdown tree schema)
- [x] .markdownlint.yaml, .gitignore
- [x] git init + first commit (via /commit)
- [ ] User fills in END_GOALS.md detail (Joel)
- [ ] User picks v0.1 active wedge (Joel)
- [ ] First manual `/plan-tend` run end-to-end

## v0.2 — Automation

- [x] Python helper: cron driver script (`scripts/tend_driver.py`) — TDD
- [ ] Cron entry: daily tend at 09:00 local
- [ ] Cron entry: weekly review Sundays 10:00
- [ ] Cron entry: monthly recalibrate first-of-month
- [ ] Cron entry: quarterly anchor check
- [ ] Cron entry: annual epic review
- [ ] Approval-queue CLI helper (`just approve`)
- [x] Schema validator (frontmatter integrity check) — TDD
- [ ] Plugin smoke test that exercises commands non-destructively

## v1.0 — Hardening

- [ ] ETHICS refusal-protocol unit tests
- [ ] HMAC or signed-commit-based approval token scheme
- [ ] Run cron under `_claude` POSIX user (sandbox)
- [ ] Backup strategy (encrypted offsite snapshot of `data/`)

## v2.0 — Web UI

- [ ] Flask app pattern from `~/code/dailyplanner/`
- [ ] Goal-tree visualization (collapsible)
- [ ] Status dashboard
- [ ] Inline frontmatter + body edit with commit-on-save
- [ ] Approval queue UI
- [ ] Read-only mobile view

## v3.0 — Self-marketplace

- [ ] Plugin marketplace setup
- [ ] Versioning + release workflow
- [ ] Install path that separates plugin code (read-only) from data dir (writable)
