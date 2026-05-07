---
description: "Print plan health: active wedge, approval queue depth, recent log entries, open questions count, last review dates."
---

# /plan-status

Read these files and produce a compact status summary:

- `data/STATE.md` — active wedge, period, resource snapshot, health indicators
- `data/APPROVAL_QUEUE.md` — count of pending items
- `data/OPEN_QUESTIONS.md` — count of unanswered questions
- `data/LOG/` — last 3 entries
- `data/REVIEWS/` — most recent weekly, monthly, quarterly, annual

Output format (markdown):

```markdown
## Plan Status — YYYY-MM-DD

**Active wedge:** <name or "(none selected)">
**Resources:** $X budget, Y hrs/week, autonomy=<level>
**Queue:** N pending approvals
**Open questions:** N
**Last tend:** YYYY-MM-DD
**Last weekly review:** YYYY-MM-DD
**Last monthly review:** YYYY-MM-DD
**Health flags:** <any concerns from STATE.md>
```

Do not modify any files. Read-only command.
