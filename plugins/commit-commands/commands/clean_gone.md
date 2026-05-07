---
name: clean_gone
description: Delete local git branches marked [gone] (remote-deleted) and their worktrees.
---

## Context

- Branch state: !`git branch -v`
- Worktrees: !`git worktree list`

## Task

Run this script in one Bash call to clean up all [gone] branches and their worktrees:

```bash
git fetch --prune 2>/dev/null
gone=$(git branch -v | grep '\[gone\]' | sed 's/^[+* ]*//' | awk '{print $1}')
if [ -z "$gone" ]; then
  echo "No [gone] branches to clean up."
  exit 0
fi
echo "Cleaning gone branches: $gone"
while IFS= read -r b; do
  wt=$(git worktree list | grep "\[$b\]" | awk '{print $1}')
  if [ -n "$wt" ] && [ "$wt" != "$(git rev-parse --show-toplevel)" ]; then
    echo "  Removing worktree: $wt"
    git worktree remove --force "$wt"
  fi
  echo "  Deleting branch: $b"
  git branch -D "$b"
done <<< "$gone"
echo "Done."
```

Report which branches and worktrees were removed, or confirm none needed cleaning.
