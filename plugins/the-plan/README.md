# the-plan

A self-served Claude Code plugin and data repository for developing and gradually executing a multi-decade plan to help reduce suffering and increase well-being on the planet.

The plugin houses the *thinking machinery* (skills, commands, schema, ethics).
The `data/` tree houses the *plan itself* (mutable markdown, git-versioned).
A daily cron job invokes `claude -p` to think about the plan and update `data/` — but never acts externally without explicit approval.

## Philosophy

The end goals are civilizational and beyond any one person's ability to "execute":

1. Increase the number of awakened beings on the planet.
2. Address climate change.
3. Reduce the prevalence of bad governments and fascism.
4. Reduce needless suffering, broadly.

These are not the kind of goals you finish. They are anchors. Working back from them lets us pick concrete near-term moves that build leverage, capacity, and optionality.

The system is designed to be useful when started small ($1000, 10–29 hrs/week) and to remain useful as resources grow.

## Architectural verdicts (see `docs/adr/0001-infrastructure-foundations.md`)

- **Plain cron + `claude -p`**, not Claude Routines. Routines run in ephemeral fresh-clone environments and can't hold mutable state in a local directory between firings. The plan needs persistent files.
- **Git-tracked markdown tree with YAML frontmatter** for every node. Grep-able, diff-able, LLM-friendly.
- **Self-served Claude Code plugin** so the thinking machinery is portable, versioned, and (eventually) installable from a private marketplace.
- **Thinking is separated from acting.** Cron writes to `data/`; nothing external happens without an entry in `APPROVAL_QUEUE.md` that the user has marked approved.
- **Ethics is loaded as a file on every run**, not relied on as ambient.
- **Single active "wedge" at a time.** Other goals stay parked and visible.

## Layout

```text
the-plan/
├── .claude-plugin/plugin.json   # Plugin manifest
├── commands/                    # Slash commands (/plan-status, /plan-tend, /plan-approve)
├── skills/                      # Skills (tend-the-plan)
├── docs/adr/                    # Architecture decision records for the infra
├── data/                        # The plan itself — mutable, git-tracked
│   ├── ETHICS.md                # Loaded every run; non-negotiable refusals
│   ├── END_GOALS.md             # The anchor goals (rare changes)
│   ├── STATE.md                 # Active wedge + rolling context
│   ├── APPROVAL_QUEUE.md        # Proposed actions awaiting user sign-off
│   ├── OPEN_QUESTIONS.md        # Things Claude can't answer alone
│   ├── CLAUDE_NOTES.md          # Claude's voice — dissent, concern, meta-proposals
│   ├── PILLARS/                 # Thematic groupings under end goals
│   ├── GOALS/                   # Strategic goals (short/medium/long/epic horizons)
│   ├── INITIATIVES/             # Time-bounded efforts under goals
│   ├── MILESTONES/              # Dated checkpoints
│   ├── TASKS/                   # Atomic, actionable items
│   ├── ENABLERS/                # Capacity-building (money, skills, tools, allies)
│   ├── REVIEWS/                 # Weekly / monthly / quarterly / annual reviews
│   └── LOG/                     # Append-only daily run log
├── Justfile                     # just tend, just review, just status, just smoke
├── CLAUDE.md                    # Project memory for Claude Code
├── TODO.md                      # Working roadmap for building this thing out
└── .markdownlint.yaml
```

## Roadmap

### v0.1 — Foundation (now)

- Plugin scaffold, schema, ethics, skill, commands.
- Manual invocation via `/plan-tend`, `/plan-status`, `/plan-approve`.
- Plan content seeded with end-goal skeletons; user fills in END_GOALS detail.

### v0.2 — Automation

- Cron job runs `just tend` daily.
- Weekly / monthly / quarterly review crons.
- Python orchestration helper (TDD-built): driver script that loads the right preamble, invokes `claude -p`, captures the result, commits.

### v1.0 — Hardening

- Robust ETHICS enforcement with explicit refusal-protocol assertions.
- Approval workflow with signed approvals (HMAC tokens? signed commits?).
- Restricted user account (`_claude` POSIX isolation already available in `~/code/_claude/`).

### v2.0 — Web UI (planned)

A browser-based viewer + editor over the plan tree. Patterned after `~/code/dailyplanner/` (Flask + Jinja2 + dataclass model).

Features (sketch):

- Goal-tree visualization (collapsible hierarchy: end goals → pillars → goals → initiatives → milestones → tasks).
- Status dashboard: active wedge, queue depth, recent log entries, confidence trends.
- Inline edit of frontmatter and body (commits on save with message templates).
- Approval queue UI: one-click approve / reject / defer with comment.
- Read-only mobile view for thinking on the go.
- Optional: multi-user mode if collaborators ever join.

Out of scope for v2: anything that *acts* externally. The web UI is a window onto the plan, not an execution panel.

### v3.0 — Self-marketplace

Publish `the-plan` to a private plugin marketplace so future installations (other machines, isolated environments, fresh users) can pull it cleanly. The data/ tree stays local; the plugin code is what's served.

## Getting started

```bash
just tend       # run a thinking pass right now (manual; v0.1)
just status     # show plan health: active wedge, queue, open questions
just review     # run a weekly review pass
just smoke      # end-to-end sanity check
```

See `CLAUDE.md` for project conventions and `docs/adr/` for the reasoning behind structural decisions.
