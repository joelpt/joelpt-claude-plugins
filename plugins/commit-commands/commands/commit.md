---
name: commit
description: Atomic git commit of current session changes with mandatory code review and simplify pre-flight.
model: sonnet
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*)
---

## Context

- Git status: !`git status`
- Unstaged changes: !`git diff`
- Staged changes: !`git diff --staged`
- Recent commits (for message style): !`git log --oneline -10`

## Phase 0: Model gate (MANDATORY before invoking any agent/skill)

This orchestrator runs as sonnet; sub-agents inherit sonnet unless overridden.
Most commits are a couple dozen LOC of config or cosmetic change — opus is overkill and slow for those.

Classify the diff:

- **Default (no model override → sonnet via inheritance)**: docs/config/data-only changes (`.md`, `.json`, `.yaml`, `.toml`, lock files, etc.); cosmetic-only (whitespace, comments, identifier renames); value/constant tweaks; or ≤~100 LOC of code with low cyclomatic complexity (no new branches/loops, no new control flow).
- **Heavy (force opus)**: ANY of —
  - highly complex logic (state machines, concurrency, non-trivial algorithms),
  - ambiguous or sketchy intent in the diff (unclear why, mixed concerns, surprising changes),
  - voluminous (>300 net LOC of substantive code, or >10 source files touched),
  - cross-cutting refactor (signature/contract change with many callsites),
  - **security-risky** — touches auth/authz, crypto, secrets/credentials, input validation/sanitization, deserialization, file/path handling, subprocess/shell invocation, SQL/template construction, network exposure, permission boundaries, or anything that could plausibly become a CVE.

Pick exactly one tier. If on the fence, default to sonnet — the worst case is a re-run, not a bad commit.

## Phase 1: Code Review (MANDATORY)

Invoke `Agent` with `subagent_type: "superpowers:code-reviewer"` to review the changes above.
If Heavy per Phase 0, pass `model: "opus"`; otherwise omit `model` (inherits sonnet from this orchestrator).

Present ALL findings to the user. Auto-fix Critical/Important issues before proceeding.

For Minor/Suggestions: use `AskUserQuestion` — "Found N minor issues and M suggestions. Fix any before committing, or proceed?"

## Phase 1b: Simplify

- **Default (not Heavy)**: `Skill(simplify)` on changed files. Sub-agents the skill spawns inherit sonnet from this orchestrator — that's the intended cheap path.
- **Heavy per Phase 0**: skip the skill (its model knob isn't reliably exposed) and call the simplifier agent directly with the override:
  `Agent(subagent_type: "code-simplifier:code-simplifier", model: "opus", prompt: "Simplify the changed files: <list>")`.

If it produces changes: re-run `superpowers:code-reviewer` (same Heavy decision as Phase 1 — `model: "opus"` if Heavy, else omit). At most 2 passes total. If still changing after pass 2 — stop and explain; do not commit.

## Phase 2: Commit

**IMMUTABLE RULES:**

- Stage files individually by name — NEVER `git add .`, `-A`, `--all`, or `commit -a`
- NEVER `--no-verify`
- No AI attribution — no Co-Authored-By, no emojis, no links in message
- Only current session files — ignore unrelated changes
- Message: focus on WHY, not WHAT

**Workflow:**

1. `git status` — confirm current state after review/simplify
2. `git add <file1> <file2> ...` — stage by name
3. `git diff --staged` — verify staged content
4. `git commit -m "type: Subject"` — conventional commit format
5. `git log -1` — confirm

**Message format:** `<type>: <Subject>` — imperative mood, no period, max 50 chars, capitalize first letter.

Types: `feat` / `fix` / `refactor` / `test` / `chore` / `docs` / `perf` / `style`
