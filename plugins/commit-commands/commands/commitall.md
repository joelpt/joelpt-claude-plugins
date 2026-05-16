---
name: commitall
description: Commit ALL uncommitted changes as semantically atomic conventional commits with code review and simplify pre-flight. Ignore session-only restriction.
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*)
---

## Context

- Git status: !`git status`
- Change summary: !`git diff --stat`
- Staged summary: !`git diff --staged --stat`
- Recent commits: !`git log --oneline -10`
- Full diff: !`git diff`

**SCOPE:** **ALL** uncommitted changes in the working tree. Ignore any session-only restriction — the loop ends only when `git status` is clean.

@${CLAUDE_PLUGIN_ROOT}/shared/commit-workflow.md
