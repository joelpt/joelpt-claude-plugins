---
description: Run a thinking pass against the plan in data/. Optional arg sets cadence (daily|weekly|monthly|quarterly|annual). Default daily.
---

# /plan-tend

Invoke the `tend-the-plan` skill against the current plan.

If `$ARGUMENTS` contains `daily`, `weekly`, `monthly`, `quarterly`, or `annual`, pass that as the cadence.
Otherwise default to `daily`.

After the run, summarize for the user in 3 lines: cadence, files touched, queue items added.
Do not run `git push` (the autonomy ceiling does not authorize it).
Do not modify anything outside `data/`.
