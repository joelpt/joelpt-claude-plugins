---
name: commit
description: Atomic git commit of current session changes with mandatory code review and simplify pre-flight.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*)
---

## Context

- Git status: !`git status`
- Change summary: !`git diff --stat`
- Staged summary: !`git diff --staged --stat`
- Recent commits: !`git log --oneline -10`
- Full diff: !`git diff`

**SCOPE:** Only files changed in the **current session**. Ignore unrelated pre-existing changes — do not review, stage, or commit them.

@${CLAUDE_PLUGIN_ROOT}/shared/commit-workflow.md
