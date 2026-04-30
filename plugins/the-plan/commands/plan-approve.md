---
description: Walk the approval queue interactively. Show each pending item; prompt user for approve/reject/defer + notes; update the file.
---

# /plan-approve

Read `data/APPROVAL_QUEUE.md` and walk each pending item with the user.

For each pending entry:

1. Display the entry (action, motivation, cost, risks, alternatives, recommendation).
2. Ask the user: approve / reject / defer / skip.
3. If approve: ask for any caveats; update the entry's `Status:` to `approved` and add caveats; if appropriate, create a corresponding task file in `data/TASKS/` with `needs_approval: false`.
4. If reject: ask for a brief reason; update `Status:` to `rejected`.
5. If defer: ask for next-review date; update `Status:` to `deferred-until-YYYY-MM-DD`.
6. If skip: leave as `pending`.

After the walk:

- Move all decided items from "Pending" to "Decided (most recent first)" in `APPROVAL_QUEUE.md`.
- Commit via `/commit` (do not commit directly).

Do not approve anything autonomously. Every decision requires explicit user input.
