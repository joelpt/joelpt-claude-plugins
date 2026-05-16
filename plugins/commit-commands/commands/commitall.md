---
name: commitall
description: Commit ALL uncommitted changes as semantically atomic conventional commits with code review and simplify pre-flight. Ignore session-only restriction.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(mktemp:*), Bash(rm:*)
effort: low
---

## Context

- Git status: !`git status`
- Change summary: !`git diff --stat`
- Staged summary: !`git diff --staged --stat`
- Recent commits: !`git log --oneline -10`
- Full diff: !`git diff`

## Steps 

DEFINITIONS:
   "call code review": run `/code-review:code-review`. Show full findings using colorized output and emojis; auto-fix Critical/Important.
   "call Codex": run `/codex:review`. Show full findings using colorized output and emojis; auto-fix P0/P1 and for ambiguous/major changes, before auto-fixing, use AskUserQuestion to explain each change, the pro/con, and ask the user if/how to proceed.
   "simplify:" run `Skill(simplify)` on all changed files.

STEPS:

1. Check the nature of the changes and:
   - If trivial or documentation/config/data files only: skip calling code-review, Codex, and simplify
   - If non-trivial but not highly complex and <= 10 code files changed: call code-review and simplify 
   - If non-trivial and highly complex and/or >10 code files changed: call code-review and Codex in parallel, evaluate the combined set of recommendations, and follow the auto-fix/HITL pattern described above. Then simplify.
2. If any files were changed in previous step, re-call code review (first re-running `git diff` for a fresh picture), auto-fix, and simplify again.
3. After step 2 and if further changes were made during that step, **STOP**, explain to user; do not commit. If reviewer found **any** issues (Critical, Important, minor, or suggestions): `AskUserQuestion` "Found N issues and M suggestions. Fix any before committing, or proceed?"
4. Perform commit loop, below.


## Commit Loop

Repeat until `git status` is clean:

1. `git add <specific files>`
2. `git diff --staged` — verify
3. `git commit -m "<<Conventional Commits format message>>"`
4. `git log -1` — confirm


## Git Rules (IMMUTABLE)

**BANNED:** `git add .`/`-A`/`--all` · `commit -a` · `--no-verify` · AI attribution · emojis · Co-Authored-By · links in messages.

**REQUIRED:** stage by name · `git diff --staged` before every commit · every changed file lands in a commit (tree clean) · message = WHY not WHAT.

**Atomic grouping:** one logical change per commit.
Group if split would break the build (new required param + callsite → same commit).
Split independent changes. Use `git add -p` for partial-file commits.


## Conventional Commits format message

**Format:** `<type>(area): <Subject ≤50 chars, imperative mood, capitalized, no period>` -> strictly adhere to Conventional Commits format
Types: `feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` · `chore`
Optional body rules: wrap at 72 chars. Only when needed, write a concise body explaining rationale for this change and/or specifics of the change that would be valuable to a new developer perusing the commit log in the future. Follow  best practices for Git commit message bodies.
