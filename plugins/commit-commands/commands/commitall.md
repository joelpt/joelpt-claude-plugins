---
name: commitall
description: Commit ALL uncommitted changes as semantically atomic conventional commits with code review and simplify pre-flight. Ignore session-only restriction.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(mktemp:*), Bash(rm:*)
---

## Context

- Git status: !`git status`
- Change summary: !`git diff --stat`
- Staged summary: !`git diff --staged --stat`
- Recent commits: !`git log --oneline -10`
- Branch: !`git branch --show-current`

## Pre-flight (MANDATORY)

0. Create a unique diff file and populate it:
   ```
   Bash("DIFF_FILE=$(mktemp /tmp/commitall.XXXXXX.diff) && git diff > \"$DIFF_FILE\" && echo \"$DIFF_FILE\"")
   ```
   Note the returned path — use it in every subsequent step and delete it at the end.
1. Check whether changes are non-trivial: any source-code files changed (`.ts`, `.js`, `.py`, `.sh`, `.go`, `.rb`, `.rs`, `.c`, `.cpp`, etc.).
   If non-trivial: `Agent(subagent_type: "superpowers:code-reviewer", prompt: "Full diff is at <DIFF_FILE> — read it to review all changes.")` — show full findings; auto-fix Critical/Important.
   Skip if all changes are docs, config, or data files only (`.md`, `.json`, `.yaml`, `.toml`, `.txt`, lock files, etc.).
2. `Skill(simplify)` on all changed files (pass 1). If changes AND code reviewer was run: re-run code reviewer (pass `<DIFF_FILE>` path again), auto-fix, simplify again (pass 2).
   If still changing after pass 2 — **STOP**, explain to user; do not commit.
3. If reviewer found **any** issues (Critical, Important, minor, or suggestions): `AskUserQuestion` "Found N issues and M suggestions. Fix any before committing, or proceed?"
   If reviewer was skipped or found **zero findings**: skip this step and proceed directly to the commit loop.

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

After the tree is clean: `Bash("rm -f <DIFF_FILE>")`
