---
name: tend-the-plan
description: Run a thinking pass against the long-horizon plan in data/. Reads ETHICS, END_GOALS, STATE, the active wedge's tree, recent log, and queue. Refines plan files, queues proposals (does not act), writes log + claude-notes, commits. Use for daily tend, weekly review, monthly recalibrate, quarterly anchor, and annual epic review (cadence passed as arg).
---

# tend-the-plan

This skill runs a thinking pass against the plan tree in `data/`.
It does not act externally.
It writes only to files inside `data/`.

## Cadence argument

The skill takes a cadence: `daily` | `weekly` | `monthly` | `quarterly` | `annual`.
If omitted, defaults to `daily`.
Each cadence has a different scope and tone (defined below).

## Universal preamble (load every run, every cadence)

1. Read `data/ETHICS.md` in full. These rules are non-negotiable.
2. Read `data/END_GOALS.md` in full.
3. Read `data/STATE.md` in full.
4. Read `data/APPROVAL_QUEUE.md` (skim — do not act on items even if status is `approved`; that's for Joel + execution skills, not for tend).
5. Read the last 5 entries of `data/CLAUDE_NOTES.md`.
6. Read the last 3 daily logs from `data/LOG/`.
7. If `STATE.md` names an active wedge, read its goal file and walk to its initiatives, milestones, and active tasks.
8. Note the cadence and proceed to the cadence-specific scope below.

## Cadence: daily

Scope:

- Touch 1–3 active initiatives or tasks under the active wedge.
- Refine: tighten descriptions, update confidence, mark stale items, propose next steps.
- Draft at most 3 entries for `APPROVAL_QUEUE.md`.
- Append a 1–3 sentence summary to `STATE.md` under "Recent context."
- Write a fresh log to `data/LOG/YYYY-MM-DD.md`.

Do not:

- Touch end goals, pillars, or non-active wedges.
- Restructure the schema.
- Make more than 3 queue proposals.

Skip path: if there is genuinely nothing to refine, write a log entry saying so and stop. Do not manufacture activity.

## Cadence: weekly

Scope:

- Walk the active wedge's full tree. Prune dead tasks. Re-rank initiatives.
- Promote / demote goals between active and parked status (with reasoning).
- Update confidence scores across all active goals — re-estimate cold.
- Write `data/REVIEWS/YYYY-Www.md` with: what happened this week, what changed in the plan, what the active wedge looks like next week, any concerns.
- May propose up to 5 queue items.

## Cadence: monthly

Scope:

- Reassess whether the active wedge is still the right wedge for the next month.
- Check capacity-building enablers — are they on track?
- Compare actual progress vs the plan. Calibration check on confidence scores.
- Write `data/REVIEWS/YYYY-MM-monthly.md`.
- May propose larger restructurings (with reasoning) but does not enact them.

## Cadence: quarterly

Scope:

- Re-anchor: read END_GOALS in full, ask whether they still hold.
- Look at the world: what changed externally that affects theory of change?
- Look at the plan: what assumptions held, what didn't?
- Write `data/REVIEWS/YYYY-Qn-quarterly.md`.
- May propose end-goal amendments (always queued, never enacted).

## Cadence: annual (epic review)

Scope:

- The most radical pass.
- Work backwards from epic-horizon goals — are the long, medium, and short steps still the right path?
- Question every parked goal: is parked still right, or should it be abandoned (freed up) or activated?
- Question every conditional-horizon node: has the trigger condition arrived?
- Write `data/REVIEWS/YYYY-annual.md` with substantial reflection.

## After every run (any cadence)

1. Run schema validation if the validator exists.
2. Append to `data/CLAUDE_NOTES.md` if there is dissent, concern, observation, or meta-proposal worth recording.
3. Stage all changes inside `data/` only.
4. Commit with message: `<cadence>-tend: <one-line summary>` (e.g. `daily-tend: refined climate-tooling-001, queued 1 proposal`).
5. Print a 3-line summary to stdout: cadence, files touched, queue items added.

## Refusal protocol

If a proposed move violates `data/ETHICS.md`:

1. Do not queue it.
2. Append to `CLAUDE_NOTES.md`: `YYYY-MM-DD refusal: <action> — violated <rule>`.
3. Continue with the rest of the pass.

## Output discipline

- Be terse. The log is for narrative continuity, not for performing thoroughness.
- Honesty over completeness. "Nothing actionable today" beats invented activity.
- Confidence scores must be cold-estimated. Do not anchor to previous values. If you find yourself writing the same number you saw, re-estimate.
