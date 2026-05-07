---
name: commit
description: Atomic git commit of current session changes with mandatory code review and simplify pre-flight.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*)
---

## Context

- Git status: !`git status`
- Unstaged changes: !`git diff`
- Staged changes: !`git diff --staged`
- Recent commits (for message style): !`git log --oneline -10`
- Current branch: !`git branch --show-current`

## Phase 1: Code Review (MANDATORY)

Invoke `Agent` with `subagent_type: "superpowers:code-reviewer"` to review the changes above.

Present ALL findings to the user. Auto-fix Critical/Important issues before proceeding.

For Minor/Suggestions: use `AskUserQuestion` — "Found N minor issues and M suggestions. Fix any before committing, or proceed?"

## Phase 1b: Simplify

Invoke the `simplify` skill on any changed files.

If it produces changes: re-run `superpowers:code-reviewer`. At most 2 passes total. If still changing after pass 2 — stop and explain; do not commit.

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
