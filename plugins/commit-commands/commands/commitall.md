---
name: commitall
description: Commit ALL uncommitted changes as semantically atomic conventional commits with code review and simplify pre-flight. Ignore session-only restriction.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*)
---

## Context

- Git status: !`git status`
- All changes: !`git diff`
- Staged: !`git diff --staged`
- Recent commits: !`git log --oneline -10`
- Branch: !`git branch --show-current`

## Pre-flight (MANDATORY)

1. `Agent(subagent_type: "superpowers:code-reviewer")` — show full findings; auto-fix Critical/Important.
2. `Skill(simplify)` on all changed files (pass 1). If changes: re-run code reviewer, auto-fix, simplify again (pass 2).
   If still changing after pass 2 — **STOP**, explain to user; do not commit.
3. `AskUserQuestion`: "Found N minor issues and M suggestions. Fix any before committing, or proceed?"

## Git Rules (IMMUTABLE)

**BANNED:** `git add .`/`-A`/`--all` · `commit -a` · `--no-verify` · AI attribution · emojis · Co-Authored-By · links in messages.

**REQUIRED:** stage by name · `git diff --staged` before every commit · every changed file lands in a commit (tree clean) · message = WHY not WHAT.

**Atomic grouping:** one logical change per commit.
Group if split would break the build (new required param + callsite → same commit).
Split independent changes. Use `git add -p` for partial-file commits.

**Format:** `<type>: <Subject ≤50 chars, imperative mood, capitalized, no period>`
Types: `feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` · `chore`
Optional body: wrap at 72 chars.

## Commit Loop

Repeat until `git status` is clean:

1. `git add <specific files>`
2. `git diff --staged` — verify
3. `git commit -m "type: Subject"`
4. `git log -1` — confirm
