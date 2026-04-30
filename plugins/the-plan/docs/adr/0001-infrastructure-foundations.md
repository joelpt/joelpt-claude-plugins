# ADR-0001: Infrastructure Foundations

- Status: accepted
- Date: 2026-04-22
- Decider: Joel (with Claude)

## Context

We are building a long-horizon planning system intended to develop and gradually execute a multi-decade plan toward four civilizational end goals (awakening, climate, governance, suffering reduction).
The system must be useful at small scale ($1000 budget, 10–29 hrs/week of one person) and remain useful as resources grow.
The system must persist plan state across sessions, support iterative refinement by an LLM agent, allow human review before any external action, and degrade gracefully if Claude is replaced or temporarily unavailable.

## Decisions

### D1: Storage — git-tracked markdown tree with YAML frontmatter

Plan content lives in `data/**/*.md` as markdown files with YAML frontmatter on every node.
Rejected alternatives: SQLite database (loses diff narrative), JSON tree (less human-editable), commercial planning tools (vendor lock-in, weak LLM affordances), web app first (premature ceremony).

Rationale: grep-able, diff-able, LLM-friendly, human-editable, narrative-preserving via git history, works offline, zero infra cost.

### D2: Scheduling primitive — plain cron + `claude -p`, not Claude Routines

Routines run in Anthropic-managed cloud with a *fresh git clone each firing*; they cannot maintain mutable state in a local directory across runs.
Our entire model is "read plan files, think, write plan files" — that requires persistent local FS.
Plain `cron` invoking `claude -p --permission-mode auto` in the project directory satisfies the requirement.

Routines remain available later for tasks where state lives externally and persistence-across-runs isn't needed (news ingestion, webhook responses, etc.).

### D3: Distribution — Claude Code plugin with future self-marketplace

The thinking machinery (commands, skills, schema) is packaged as a Claude Code plugin (`.claude-plugin/plugin.json`).
The plan content (`data/`) is mutable user state that lives alongside the plugin during local development; on future marketplace install the two will be split (plugin code read-only, data writable).

Rationale: portability, versioning, eventual reuse on other machines or by future collaborators.

### D4: Action separation — thinking is not acting

The `tend-the-plan` skill writes only to files inside `data/`.
Anything that spends money, sends external messages, calls APIs with side effects, or commits Joel's time goes into `data/APPROVAL_QUEUE.md` for explicit user approval before execution.
A separate (yet-to-be-built) approval-and-execution path drains the queue.

Rationale: makes the system safe to leave running unattended, matches Joel's "wait to implement" instinct, contains blast radius if the model misbehaves.

### D5: Ethics as a loaded file, not ambient

`data/ETHICS.md` is prepended to every cron run prompt and every skill invocation that proposes actions.
It contains hard refusals, borderline-cases-to-escalate, and a written refusal protocol.
Claude cannot amend `ETHICS.md` autonomously.

Rationale: turns "don't do bad things" from a vibe into a repeatable discipline, gives the model a definite check rather than relying on training-distribution intuition.

### D6: Single active wedge

`data/STATE.md` names exactly one active wedge.
Other goals are visible but parked.
Rotation is allowed at any review boundary.

Rationale: $1000 + 10–29 hrs/week against four civilizational goals demands ruthless prioritization; equal weight produces a beautiful index and zero movement.

### D7: Layered review cadences (one cron entry each)

- Daily tend (~10 min): refresh state, touch 1–3 active items, draft ≤3 proposals.
- Weekly prune: re-rank, write weekly review.
- Monthly recalibrate: reassess wedge, calibration check.
- Quarterly re-anchor: revisit end goals against reality.
- Annual epic review: radical top-down rethink.

Each cadence uses the same skill with a different cadence argument.

### D8: Claude has a voice

`data/CLAUDE_NOTES.md` is a real file the agent writes to for dissent, concern, observation, meta-proposals.
This honors Joel's invitation of judgment and creates an audit trail when the model refuses or flags a risk.

### D9: Defaults adopted on Joel's open-questions list

Pending future change in this ADR or a successor:

- Visibility: local-only (no GitHub remote yet).
- Autonomy ceiling: advisory-only (queue everything; lift later).
- Scope discipline: single active wedge enforced.
- Claude's voice: yes, `CLAUDE_NOTES.md` exists.

### D10: Web UI is v2, not v0.1

A Flask-based viewer/editor patterned on `~/code/dailyplanner/` is planned for v2.
Not started until v0.1 (manual + tend) and v0.2 (cron automation) prove out.
Trigger condition: queue depth or plan-tree complexity exceeds what's pleasant to manage in raw markdown, or Joel asks for it.

## Consequences

- The system is operable from day one with no infra dependencies beyond Claude Code, git, and macOS cron.
- The plugin can be extracted and shared (or self-served via a future marketplace) without disturbing user data.
- The system is degradation-safe: even if the agent is unavailable, the markdown tree remains human-readable and editable.
- The strict no-act discipline means early progress will feel slow. This is a feature, not a bug.

## Future ADRs

- ADR-0002 (next): Markdown tree schema details — frontmatter spec, ID conventions, parent-child rules.
- Future: GitHub remote — when, with what visibility.
- Future: Autonomy ceiling lift — what triggers a move from advisory to small-autonomous-spends.
- Future: Approval-token scheme for v1.0 hardening.
