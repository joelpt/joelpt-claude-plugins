---
name: commit-push-pr
description: Commit current changes, push branch, and open a GitHub PR — with code review and simplify pre-flight.
---

## Context

- Git status: !`git status`
- Unstaged changes: !`git diff`
- Staged changes: !`git diff --staged`
- Current branch: !`git branch --show-current`
- Branch history: !`git log --oneline -20`

## Phase 1: Code Review (MANDATORY)

Invoke `Agent` with `subagent_type: "superpowers:code-reviewer"` to review the changes above.

Present ALL findings. Auto-fix Critical/Important issues. For Minor/Suggestions: `AskUserQuestion`.

## Phase 1b: Simplify

Invoke the `simplify` skill on changed files. At most 2 passes. Stop and explain if still changing after pass 2.

## Phase 2: Commit

**IMMUTABLE RULES:**

- Stage files individually by name — NEVER `git add .`, `-A`, `--all`, or `commit -a`
- NEVER `--no-verify`
- No AI attribution — no Co-Authored-By, no emojis, no links in message
- Message: focus on WHY, not WHAT

**Workflow:**

1. If on `main`/`master`: create a new feature branch (`git checkout -b <type>/<short-description>`)
2. `git status` — confirm state after review/simplify
3. `git add <file1> <file2> ...` — stage by name
4. `git diff --staged` — verify
5. `git commit -m "type: Subject"` — conventional commit format
6. `git log -1` — confirm

## Phase 3: Push and PR

1. `git push -u origin <branch>`
2. Analyze ALL commits on this branch vs main for the PR description
3. Create PR with `gh pr create` using a HEREDOC body:

```text
## Summary
<1-3 bullet points — focus on WHY, not WHAT>

## Test plan
<bulleted checklist of what to test>
```

No AI attribution, emojis, or links in the PR body.

Return the PR URL.
