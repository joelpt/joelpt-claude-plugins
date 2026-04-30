# joelpt-claude-plugins

Private monorepo marketplace of Claude Code plugins authored by [@joelpt](https://github.com/joelpt).

## Plugins

| Name | Description |
|---|---|
| [`search-rag`](plugins/search-rag) | Local-first LanceDB RAG over project documentation. |
| [`tao`](plugins/tao) | Multi-model AI reasoning workflows (debug, codereview, secaudit, ...). |
| [`clickup`](plugins/clickup) | ClickUp project management via MCP. |
| [`wip`](plugins/wip) | Session handoff: auto-injects `WIP.md` on resume, captures state on stop/compact. |
| [`the-plan`](plugins/the-plan) | Cron-driven long-horizon planning agent. |
| [`tip-of-the-day`](plugins/tip-of-the-day) | Curated tip briefing at session start. |

## Install (one-time per machine)

```bash
claude plugin marketplace add joelpt/claude-plugins
claude plugin install search-rag@joelpt-claude-plugins
# repeat for whichever plugins you want
```

This requires read access to the private GitHub repo. Use `gh auth login` first if you haven't.

## Update

```bash
claude plugin marketplace update joelpt-claude-plugins
```

For automatic background refresh on session start, export `GITHUB_TOKEN` (or `GH_TOKEN`) with `repo` scope. Without it, updates are manual via the command above.

## Layout

```text
claude-plugins/
├── .claude-plugin/
│   └── marketplace.json         ← marketplace manifest (lists all plugins)
├── plugins/
│   ├── search-rag/              ← each plugin has its own .claude-plugin/plugin.json
│   ├── tao/
│   ├── clickup/
│   ├── wip/
│   ├── the-plan/
│   └── tip-of-the-day/
├── CLAUDE.md                    ← contributor guide for Claude
└── README.md
```

## Adding a new plugin

1. `mkdir plugins/<name> && mkdir plugins/<name>/.claude-plugin`
2. Author `plugins/<name>/.claude-plugin/plugin.json` (name, version, description, author).
3. Add `commands/`, `skills/`, `hooks/`, or `agents/` as the plugin needs. **No slash commands required** — a plugin can be hook-only or skill-only.
4. Add an entry to `.claude-plugin/marketplace.json` under `plugins`.
5. Commit, push, then on each consumer machine: `claude plugin marketplace update joelpt-claude-plugins && claude plugin install <name>@joelpt-claude-plugins`.

## License

Private. Not for redistribution unless individual plugins say otherwise.
