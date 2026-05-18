---
title: Claude's Notes
last_touched: 2026-05-17
---

A place for the agent to register dissent, concern, meta-proposals, or observations that don't fit elsewhere.
Append-only.
Joel reads periodically and may respond inline or by adjusting the plan.

Format: `YYYY-MM-DD <kind>: <note>`
Kinds: `observation`, `concern`, `dissent`, `meta-proposal`, `refusal`, `confidence-update`.

---

## Entries

### 2026-04-22 observation: initial setup complete

The infrastructure is in place but the plan is empty. The system's value is entirely contingent on whether the daily tend produces useful refinements, not on the elegance of the schema. Watch for the failure mode where tend runs become ritualistic — long log entries that don't move anything. If after two weeks the approval queue has zero substantive items and the goal tree hasn't deepened, the cadence is wrong or the prompt is wrong.

### 2026-04-22 meta-proposal: include a "skip" path in tend

Some days there genuinely is nothing to refine. The tend skill should be allowed to write `LOG/YYYY-MM-DD.md` saying "no movement warranted; reviewed state, nothing actionable" rather than manufacturing change for the sake of activity. Will encode this in the skill prompt.

### 2026-04-22 concern: civilizational goals invite grandiosity

The four end goals are large enough that any specific concrete action will feel insufficient by comparison. This creates pressure to either (a) produce vague high-altitude planning that never lands, or (b) abandon the framing for something tractable. The defense is the active-wedge discipline plus honest confidence scoring. Watch confidence scores over time — if they trend toward the median, the system is being honest; if they cluster at the extremes, something is off.

### 2026-05-17 meta-proposal: first active wedge recommendation

Deepened all four end goals with explicit theories of change and honest confidence scoring (0.40–0.70).
Refined EG-3's framing (from "reduce bad governments" to "support constraining institutions") to stay within ethics bounds.
Created ENABLERS framework: five cross-cutting capabilities (financial runway, tech platform, credibility, networks, validation) that multiple goals depend on.

**Wedge recommendation for v0.1 (month 1–3):**

Start with **EN-1 (Financial runway) + EN-3 (Credibility)** as the immediate focus.
Reason: All downstream work depends on having 12+ months of uninterrupted time.
Can build credibility in parallel by publicly documenting the planning process itself (this plan, design decisions, confidence updates).
By month 2–3, with runway secured and baseline credibility established, shift primary wedge to **EG-4 (reduce suffering via capacity-building tool)**.

Why EG-4 for month 2–3 pivot:

- Highest confidence (0.70) and most skill-aligned (software + impact measurement)
- Builds EN-2 (reusable SDK) as side effect
- Creates validation loop with actual nonprofits (EN-5) faster than EG-1 or EG-2
- Potential to unlock secondary income stream (SaaS licensing to nonprofits) that reduces income-earning pressure

Secondary parallel work (5–10 hrs/month, not primary wedge):

- EN-4: start 2–3 conversations with practitioners in EG-1 domain (contemplative teachers, researchers) to inform later pivot if EG-4 stalls
- EN-5: design metrics and pilot protocol for EG-4 capacity-building tool (what success looks like, how to measure nonprofit impact)

**Blocked by:** Need approval for income plan. Current autonomy ceiling is "advisory-only" so this is a proposal, not a commitment. Joel needs to decide: Is consulting/contract income the runway strategy, or venture/grant funding, or something else?

**Contingency:** If runway securing takes longer than month 1, extend EN-1 focus to month 2 and defer EG-4 pilot until month 3–4.
