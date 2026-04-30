# the-plan — Project Memory

This is a self-served Claude Code plugin + data repo for developing a long-horizon plan in service of civilizational goals.

## What this project is

- The plugin (commands, skills, schema) is the *thinking machinery*.
- The `data/` tree is the *plan itself* — mutable markdown.
- A cron job invokes `claude -p` daily to refine the plan and queue proposals; nothing external happens without explicit user approval.

## Core invariants (do not violate)

1. **Thinking is not acting.** The `tend-the-plan` skill writes only to files inside `data/`. Anything that spends money, sends messages, calls external APIs with side effects, or commits user time — goes into `data/APPROVAL_QUEUE.md` for Joel to review.
2. **Ethics is loaded, not assumed.** `data/ETHICS.md` is prepended to every cron prompt. Read it before proposing anything.
3. **Single active wedge.** `data/STATE.md` names the one active wedge. Other goals are visible but parked. Do not silently start work on parked goals.
4. **Confidence is honest.** Every node carries a `confidence:` frontmatter field. Estimate it cold; do not anchor to past values.
5. **Voice has a place.** `data/CLAUDE_NOTES.md` is where Claude registers dissent, concern, or meta-proposals. Use it.

## Frontmatter schema (every node)

```yaml
---
id: <type>-<topic>-<seq>     # e.g. goal-2026-climate-001
type: end-goal | pillar | goal | initiative | milestone | task | enabler
parent: <id of parent>       # null for end-goals
horizon: short | medium | long | epic | conditional
status: draft | active | parked | done | abandoned
confidence: 0.0 - 1.0        # honest probability of success
last_touched: YYYY-MM-DD
needs_approval: true | false
tags: [list, of, tags]
---
```

`horizon: conditional` means "do Y when X arises" — the body must specify the trigger condition.

## Commands (slash commands provided by this plugin)

- `/plan-tend` — run a daily thinking pass against the plan
- `/plan-status` — print active wedge, queue depth, recent log, open questions
- `/plan-approve` — interactively walk the approval queue

## Justfile recipes

- `just tend` — equivalent to `/plan-tend` but as a shell command (cron-callable)
- `just status` — equivalent to `/plan-status`
- `just review` — weekly review pass (different prompt from daily)
- `just smoke` — end-to-end plugin sanity check
- `just test` — run plugin tests (when Python helpers exist)

## Conventions

- **Markdown:** one sentence per line; ATX headings; `-` for lists. See `~/.claude/rules/markdown.md`.
- **Commits:** via `/commit` or `/commitall` exclusively (per global CLAUDE.md). Never `git add .`. Never `--no-verify`.
- **TDD:** required for any Python helpers (cron driver, validators, etc.). Markdown content and plugin manifests are infra and exempt.
- **ADRs:** every structural change to the plan infra gets an ADR in `docs/adr/`.

## Where things live

| Concern | Path |
|---|---|
| Plugin manifest | `.claude-plugin/plugin.json` |
| Slash commands | `commands/*.md` |
| Skills | `skills/*/SKILL.md` |
| Architecture decisions | `docs/adr/NNNN-*.md` |
| Plan content (mutable) | `data/**/*.md` |
| Daily run log | `data/LOG/YYYY-MM-DD.md` |
| Roadmap for building this | `TODO.md` |

## Context for future-Claude or future-Joel reading this cold

You are picking up a long-horizon planning system. The plan you find in `data/` reflects the *current best understanding* — it is not authoritative truth. Your job (when running tend) is to refine it, not defend it. If something looks wrong, write to `CLAUDE_NOTES.md`.

Read in order on first contact:

1. `data/ETHICS.md`
2. `data/END_GOALS.md`
3. `data/STATE.md`
4. `data/APPROVAL_QUEUE.md`
5. `data/CLAUDE_NOTES.md` (last 5 entries)
6. `data/LOG/` (last 3 days)

Then look at the active wedge's goal/initiative tree.
