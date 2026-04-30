---
name: tao
description: "Advanced reasoning workflows using Claude model tiers. Usage: /tao <mode> [args]. Modes: thinkdeep, debug, codereview, secaudit, analyze, planner, think, vet, challenge, skeptic, requirements, synthesize, consensus, refactor, precommit, docgen, testgen, tracer, chat, clink, apilookup"
---

# Tao - Advanced Reasoning Workflows

Multi-model reasoning workflows that route to optimal Claude model tiers (Opus/Sonnet/Haiku) for each task type. Zero external API dependencies — uses Claude Max subscription exclusively.

## Mode Routing

When the user invokes `/tao <mode>`, dispatch to the appropriate agent using the Agent tool with the specified model tier:

| Mode | Agent | Model | Description |
|------|-------|-------|-------------|
| thinkdeep | `tao:deep-reasoner` | opus | Deep reasoning for complex problems |
| debug | `tao:debug-investigator` | opus | Systematic debugging with hypothesis-driven investigation |
| codereview | `tao:code-reviewer` | opus | Comprehensive code quality and security analysis |
| secaudit | `tao:security-auditor` | opus | Security and compliance assessment |
| analyze | `tao:architecture-analyst` | opus | Architecture and strategic code analysis |
| planner | `tao:task-planner` | opus | Structured task planning with phases |
| think | `tao:thinker` | opus | Deep reasoning with rigorous vetting via sub-agents |
| vet | `tao:proposal-vetting-judge` | opus | Multi-perspective proposal vetting and validation |
| challenge | `tao:challenge-assessor` | sonnet | Evidence-based critical reassessment of claims |
| skeptic | `tao:senior-skeptic-reviewer` | opus | Constructive skeptical evaluation of decisions |
| requirements | `tao:requirements-architect` | sonnet | Requirements discovery and technical translation |
| synthesize | `tao:perspective-synthesizer` | sonnet | Reconcile multiple viewpoints into unified strategy |
| consensus | (special) | opus/sonnet/haiku | Multi-perspective decision analysis (see below) |
| refactor | `tao:refactoring-advisor` | sonnet | Code smell detection and refactoring strategy |
| precommit | `tao:precommit-validator` | sonnet | Git change validation before commit |
| docgen | `tao:doc-generator` | sonnet | Documentation generation |
| testgen | `tao:test-generator` | sonnet | Test suite generation with edge cases |
| tracer | `tao:execution-tracer` | sonnet | Code flow and dependency tracing |
| chat | `tao:chat-assistant` | sonnet | Collaborative thinking and discussion |
| clink | `tao:clink-assistant` | sonnet | External CLI integration bridging |
| apilookup | (inline) | - | API research guidance |

## Argument Handling

Arguments can be passed in two ways:

1. **Natural language** (preferred): Just write what you need after the mode. Examples:
   - `/tao debug my server is crashing on startup`
   - `/tao challenge we don't need integration tests for this module`
   - `/tao think should we use SQLite or Postgres?`
   - `/tao vet the proposed caching strategy using Redis pub/sub`

2. **Explicit flags**: For precision or when combining multiple arguments:
   - `--thinking` or `thinking` → Tell agent to use extended thinking `[[ ultrathink ]]`
   - `--files=<paths>` or `--file-paths=<paths>` → Comma-separated file/directory paths for the agent to analyze
   - `--focus-areas=<areas>` → Comma-separated areas to focus on
   - `--question=<text>` → Decision question (consensus mode)
   - `--issue=<text>` → Bug description (debug mode)
   - `--problem=<text>` → Problem statement (thinkdeep, think modes)
   - `--task=<text>` → Task description (planner mode)
   - `--statement=<text>` → Statement to challenge (challenge mode)
   - `--proposal=<text>` → Proposal to vet (vet mode)
   - `--query=<text>` → API/library to research (apilookup mode)
   - `--prompt=<text>` → Custom prompt (chat, docgen, secaudit, tracer, clink modes)
   - `--error-logs=<text>` → Error logs (debug mode)
   - `--cli-name=<name>` → Target CLI (clink mode)

When using natural language, the entire text after the mode name is passed as the primary argument to the agent (e.g., as the issue for debug, statement for challenge, problem for think/thinkdeep, proposal for vet, etc.).

## Dispatch Instructions

### Standard Modes (Single Agent)

For most modes, invoke the Agent tool like this:

```
Agent(
  subagent_type="tao:<agent-name>",
  model="<model-tier>",
  prompt="<compiled prompt with all arguments and context>"
)
```

Include in the agent prompt:
1. The mode-specific arguments (issue, problem, files, etc.)
2. Whether thinking mode is enabled
3. Any file paths the agent should read using Read/Grep tools
4. The focus areas if specified

### Consensus Mode (Parallel Agents)

Consensus mode requires special handling — dispatch 3 agents in PARALLEL, then synthesize:

**Step 1**: Launch 3 agents simultaneously in a single message:
```
Agent(subagent_type="tao:consensus-advocate", model="opus",
      prompt="Argue FOR: <question>")
Agent(subagent_type="tao:consensus-critic", model="sonnet",
      prompt="Argue AGAINST: <question>")
Agent(subagent_type="tao:consensus-analyst", model="haiku",
      prompt="Provide NEUTRAL analysis: <question>")
```

**Step 2**: After all 3 complete, launch the synthesizer:
```
Agent(subagent_type="tao:consensus-synthesizer", model="opus",
      prompt="Synthesize these perspectives: <all 3 responses> on question: <question>")
```

### Inline Modes (No Agent Needed)

#### apilookup mode
Output this research guidance, then use web search tools to research the query:

```
RESEARCH GUIDANCE for: <query>

1. Identify official documentation site
2. Verify current version and check for breaking changes
3. Search for: "[query] official documentation", "[query] latest examples [current-year]"
4. Locate: installation, quick start, API reference, common patterns
5. Capture: core concepts, key functions, auth requirements, common pitfalls
```

Then use WebSearch/WebFetch to actually look up the information.

## Extended Thinking

When `--thinking` is specified, include this in the agent prompt:
"Extended thinking is enabled. Use [[ ultrathink ]] for each analysis step. Budget 16,000-32,000 thinking tokens per step for thorough reasoning."

## Notes

- All agents have access to Read, Grep, Glob, Bash, and other Claude Code tools
- Agents maintain full context across their multi-step workflows (no truncation)
- No external API keys, rate limiting, or cost tracking needed — Claude Max handles everything
- For file analysis modes, the agent should use Read/Grep tools directly rather than receiving file content in the prompt
