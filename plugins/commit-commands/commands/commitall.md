---
name: commitall
description: Commit ALL uncommitted changes as semantically atomic conventional commits with code review and simplify pre-flight. Ignore session-only restriction.
model: sonnet
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(mktemp:*), Bash(rm:*)
---

## Context

- Git status: !`git status`
- Change summary: !`git diff --stat`
- Staged summary: !`git diff --staged --stat`
- Recent commits: !`git log --oneline -10`

## Model gate (MANDATORY before invoking any agent/skill)

This orchestrator runs as sonnet; sub-agents inherit sonnet unless overridden.
Most commits are a couple dozen LOC of config or cosmetic change — opus is overkill and slow for those.

Classify the cumulative diff:

- **Default (no model override → sonnet via inheritance)**: docs/config/data-only changes; cosmetic-only (whitespace, comments, identifier renames); value/constant tweaks; or ≤~100 LOC of code with low cyclomatic complexity (no new branches/loops, no new control flow).
- **Heavy (force opus)**: ANY of —
  - highly complex logic (state machines, concurrency, non-trivial algorithms),
  - ambiguous or sketchy intent in the diff (unclear why, mixed concerns, surprising changes),
  - voluminous (>300 net LOC of substantive code, or >10 source files touched),
  - cross-cutting refactor (signature/contract change with many callsites),
  - **security-risky** — touches auth/authz, crypto, secrets/credentials, input validation/sanitization, deserialization, file/path handling, subprocess/shell invocation, SQL/template construction, network exposure, permission boundaries, or anything that could plausibly become a CVE.

Pick exactly one tier. If on the fence, default to sonnet — the worst case is a re-run, not a bad commit.

Below:

- For `Agent(...)` calls: if Heavy, pass `model: "opus"`; otherwise omit `model` (inherits sonnet from this orchestrator).
- For `Skill(simplify)`: the skill's model knob isn't reliably exposed, so on Heavy diffs **skip the skill** and instead call `Agent(subagent_type: "code-simplifier:code-simplifier", model: "opus", prompt: "Simplify the changed files: <list>")` directly. On Default diffs, use `Skill(simplify)` as written — its sub-agents inherit sonnet, which is what we want.

## Pre-flight (MANDATORY)

0. Create a unique diff file and populate it:
   ```text
   Bash("DIFF_FILE=$(mktemp /tmp/commitall.XXXXXX.diff) && git diff > \"$DIFF_FILE\" && echo \"$DIFF_FILE\"")
   ```
   Note the returned path — use it in every subsequent step and delete it at the end.
1. Check whether changes are non-trivial: any source-code files changed (`.ts`, `.js`, `.py`, `.sh`, `.go`, `.rb`, `.rs`, `.c`, `.cpp`, etc.).
   If non-trivial: `Agent(subagent_type: "superpowers:code-reviewer", prompt: "Full diff is at <DIFF_FILE> — read it to review all changes.")` — pass `model: "opus"` if Heavy, else omit. Show full findings; auto-fix Critical/Important.
   Skip if all changes are docs, config, or data files only (`.md`, `.json`, `.yaml`, `.toml`, `.txt`, lock files, etc.).
2. Simplify pass 1 — pick per gate: Default → `Skill(simplify)` on all changed files; Heavy → `Agent(subagent_type: "code-simplifier:code-simplifier", model: "opus", prompt: "Simplify changed files: <list>")` instead. Regenerate diff file: `Bash("git diff > \"$DIFF_FILE\"")`. If changes AND code reviewer was run: re-run code reviewer (pass `<DIFF_FILE>` path again, same Heavy decision), auto-fix, simplify again (pass 2, same Heavy decision).
   After pass 2 (if simplify was run twice): regenerate diff file again: `Bash("git diff > \"$DIFF_FILE\"")`, then check for continued changes: `Bash("git diff --quiet || echo CHANGED")`. If output is `CHANGED`, **STOP**, explain to user; do not commit.
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
