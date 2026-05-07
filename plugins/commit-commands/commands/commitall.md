---
name: commitall
description: Commit ALL uncommitted changes as semantically atomic conventional commits with code review and simplify pre-flight. Ignore session-only restriction.
---

## Context

- Git status: !`git status`
- All unstaged changes: !`git diff`
- Staged changes: !`git diff --staged`
- Recent commits (for message style): !`git log --oneline -10`
- Current branch: !`git branch --show-current`

## Phase 0: Review (MANDATORY, in order)

1. Invoke `Agent` with `subagent_type: "superpowers:code-reviewer"` — show full findings to user.
2. Auto-fix all Critical/Important issues.
3. Invoke `simplify` skill on changed files (pass 1).
4. If simplify changed anything: re-run code reviewer, fix new Critical/Important, run `simplify` again (pass 2).
   If still changing after pass 2 — STOP and explain; do not commit.
5. `AskUserQuestion`: "Found N minor issues and M suggestions. Fix any before committing, or proceed?"

## Phase 1: Git Rules (IMMUTABLE)

**Banned:**

- `git add .` / `git add -A` / `git add --all` / `git commit -a`
- AI attribution, emojis, Co-Authored-By, links in commit messages
- `--no-verify`

**Required:**

- Stage files individually by name
- `git diff --staged` before every commit
- Every changed file must end up in some commit — tree must be clean after
- Message: focus on WHY, not WHAT

**Atomic grouping:** each commit = one logical change.
Group changes that would break the build if split (new required param + its callsite belong together).
Split independent changes (docs vs feature). Use `git add -p` for partial-file commits when one file has unrelated changes.

## Phase 2: Commit Message Format

```text
<type>: <Subject in imperative mood, ≤50 chars>

[optional body — wrap at 72 chars]
```

Types: `feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore`

No trailing period. Capitalize subject. No AI attribution in body.

## Phase 3: Commit Loop

For each atomic group:

1. `git add <specific files>`
2. `git diff --staged` — verify
3. `git commit -m "type: Subject"`
4. `git log -1` — confirm
5. Repeat until `git status` is clean
