# ADR-0002: Markdown Tree Schema

- Status: accepted
- Date: 2026-04-22
- Decider: Joel (with Claude)

## Context

The plan tree must be readable by humans, parseable by LLMs, validatable mechanically, and stable enough that we don't churn the schema every week.

## Schema

### Node types

| Type | Directory | Purpose |
|---|---|---|
| `end-goal` | `data/END_GOALS/` (also summarized in `data/END_GOALS.md`) | Civilizational anchors. Change rarely. |
| `pillar` | `data/PILLARS/` | Thematic groupings under end goals. |
| `goal` | `data/GOALS/` | Strategic goals with a horizon. |
| `initiative` | `data/INITIATIVES/` | Time-bounded efforts under goals. |
| `milestone` | `data/MILESTONES/` | Dated checkpoints with success criteria. |
| `task` | `data/TASKS/` | Atomic, actionable items. |
| `enabler` | `data/ENABLERS/` | Capacity-building (money, skills, tools, allies). First-class — not a detour. |

### Frontmatter (every node)

```yaml
---
id: <type>-<topic>-<seq>
type: end-goal | pillar | goal | initiative | milestone | task | enabler
parent: <id>            # null for end-goals
horizon: short | medium | long | epic | conditional
status: draft | active | parked | done | abandoned
confidence: 0.0 - 1.0   # Claude's honest probability of success
last_touched: YYYY-MM-DD
needs_approval: true | false
tags: [list]
---
```

Conditional horizon: body must specify the trigger condition. Skill checks at annual review.

### ID conventions

- Format: `<type>-<topic-slug>-<3-digit-seq>`. Example: `goal-climate-tooling-001`.
- IDs are immutable once created. If a node is replaced, the new node gets a new ID and the old one is marked `status: abandoned` with a `superseded_by:` field added.
- Sequence numbers are scoped per `<type>-<topic-slug>` prefix.

### Parent-child rules

- `pillar.parent` ∈ end-goals
- `goal.parent` ∈ pillars or end-goals
- `initiative.parent` ∈ goals
- `milestone.parent` ∈ initiatives
- `task.parent` ∈ initiatives or milestones
- `enabler.parent` ∈ end-goals, pillars, goals, or null (cross-cutting)

A node's `status` cannot be `active` if its parent is `parked` or `abandoned`.

### File naming

`<id>.md` inside the appropriate directory.
Example: `data/GOALS/goal-climate-tooling-001.md`.

### Body structure (suggested, not enforced)

```markdown
# <Human title>

## Why

<Theory of change for this node — how it serves its parent.>

## Success criteria

<What does done / progress look like, concretely?>

## Open questions

<Things that block this node.>

## Notes

<Free-form. Tend may append dated notes here.>
```

## Validation (deferred to v0.2)

A Python validator (`scripts/validate_schema.py`, TDD-built) will check:

- All required frontmatter fields present and well-typed.
- All `parent:` references resolve to existing IDs.
- Status invariants (no active under parked/abandoned).
- ID uniqueness.
- Conditional-horizon nodes have a trigger condition in body.

Until v0.2, validation is by inspection + manual care.

## Consequences

- The schema is verbose but legible. Frontmatter on every file is friction worth paying.
- ID immutability + supersedes lets the plan evolve without losing history.
- The "enabler" node type prevents capacity-building from feeling like a betrayal of the mission when it consumes most early effort.
