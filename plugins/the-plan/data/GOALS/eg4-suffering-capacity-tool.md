---
id: goal-eg4-capacity-001
type: goal
parent: eg4-reduce-suffering
horizon: medium
status: draft
confidence: 0.70
last_touched: 2026-05-17
needs_approval: false
tags: [capacity-building, tool, nonprofits]
---

# EG-4.1: Build a nonprofit capacity-building tool

## Summary

Design and pilot a tool that helps suffering-reducer organizations (GiveWell Top Charities, animal-welfare nonprofits, etc.) reduce operational overhead and redirect dollars to direct work.

**Link to end goal:** Enables faster iteration on the "give effectively now + build capacity for later" theory of change under EG-4.

## Theory of Change

**Bottleneck:** Nonprofits spend 15–40% of budget on operations (grant management, impact measurement, donor reporting, staff coordination). Many have no engineering resources.

**Lever:** A lightweight, opinionated SaaS tool (or open-source + support model) that handles 2–3 of the highest-ROI operations problems can save orgs $10k–100k/year depending on scale.

**Mechanism:** Savings → redirect to direct work. 50 orgs × $20k saved × 80% direct-work allocation = $800k additional impact capacity annually.

**Why it works at our scale:**

- One tool, reusable across many orgs (not one-off consulting)
- Joel has deep software expertise
- Builds EN-2 (reusable SDK) as side effect
- Creates revenue optionality (SaaS licensing, support services)

## Open Questions (pre-pilot)

1. **Which 2–3 operations problems are most universal?** (Grant management? Impact measurement? Donor reporting?)
2. **What's the actual willingness to pay?** (Can we validate with 5 conversations with nonprofit leaders?)
3. **How much engineering is required for MVP?** (4 weeks? 12 weeks?)

## Success Criteria (6-month horizon)

1. **Pilot launched:** Tool in use by 3–5 nonprofits (real, live usage, not just beta signups)
2. **Measurement in place:** Baseline costs + post-implementation audit showing $5k+ savings per org
3. **Confidence updated:** Score revised based on pilot data (expect 0.65–0.75 if successful, 0.40–0.50 if issues surface)
4. **Reusable components shipped:** At least one SDK component (e.g., impact measurement framework) is documented and open-source

## Dependencies & Blockers

- **EN-1 (runway):** Cannot start serious dev until month 2 (month 1 = income/credibility focus)
- **EN-4 (networks):** Need 2–3 nonprofit relationships to identify target problem. Initiate conversations in month 1.
- **EN-5 (validation):** Need tight feedback loop. Pilot requires monthly check-ins with early users.

## Milestones (draft; to be refined by tend)

### Milestone 1: Problem validation (month 1–2, 10–15 hrs)

- [ ] Interview 5 nonprofit leaders; identify top 2 operations pain points
- [ ] Research competitor tools; define unique angle
- [ ] Draft functional spec for MVP (scope, timeline, tech stack)
- [ ] Move to "active" if problem is real and MVP is scoped realistically

### Milestone 2: MVP design & architecture (month 2–3, 20–30 hrs)

- [ ] Finalize tech architecture (cloud platform, data model, auth)
- [ ] Create clickable prototype / wireframes
- [ ] Get feedback from 2 early-user orgs
- [ ] Estimate engineering effort (go/no-go decision point)

### Milestone 3: MVP build (month 3–5, 40–60 hrs, primary wedge)

- [ ] Core feature set shipped
- [ ] 3 alpha users in live pilot
- [ ] Feedback loop live (monthly review calls)

### Milestone 4: Measurement & iteration (month 5–6, 20–30 hrs)

- [ ] Impact audit (cost savings quantified)
- [ ] Confidence update based on pilot results
- [ ] Decision: scale, pivot, or wind down?

---

## Notes

- If this goal stalls (runway takes longer, nonprofit interest is low), pivot to EG-1 (contemplative coaching) which has similar structure but may have clearer early validation
- Keep this goal tightly scoped: one tool, one job it does well. Avoid mission creep.
- Publish results (blog post, talk, open-source repo) to feed EN-3 (credibility) as you go
