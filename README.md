# joelpt-claude-plugins

Private Claude Code plugin **marketplace index** by [@joelpt](https://github.com/joelpt).
This repo holds only `marketplace.json` — every plugin lives in its own private repo.

## Plugins

| Plugin | Repo |
|---|---|
| `search-rag` | [`joelpt/claude-plugin-search-rag`](https://github.com/joelpt/claude-plugin-search-rag) |
| `tao` | [`joelpt/claude-plugin-tao`](https://github.com/joelpt/claude-plugin-tao) |
| `clickup` | [`joelpt/claude-plugin-clickup`](https://github.com/joelpt/claude-plugin-clickup) |
| `wip` | [`joelpt/claude-plugin-wip`](https://github.com/joelpt/claude-plugin-wip) |
| `the-plan` | [`joelpt/claude-plugin-the-plan`](https://github.com/joelpt/claude-plugin-the-plan) |
| `tip-of-the-day` | [`joelpt/claude-plugin-tip-of-the-day`](https://github.com/joelpt/claude-plugin-tip-of-the-day) |
| `plugin-dev` | [`joelpt/claude-plugin-plugin-dev`](https://github.com/joelpt/claude-plugin-plugin-dev) |
| `academic-research` | [`joelpt/claude-plugin-academic-research`](https://github.com/joelpt/claude-plugin-academic-research) |
| `commit-commands` | [`joelpt/claude-plugin-commit-commands`](https://github.com/joelpt/claude-plugin-commit-commands) |
| `jack` | [`joelpt/jack`](https://github.com/joelpt/jack) (subdir `jack`) |
| `statusline-usage-updater` | [`joelpt/claude-plugin-statusline-usage-updater`](https://github.com/joelpt/claude-plugin-statusline-usage-updater) |

## Install

Requires an SSH key registered with your GitHub account (the `github` source clones over SSH)
and read access to these private repos.

```bash
claude plugin marketplace add joelpt/joelpt-claude-plugins
claude plugin install <name>@joelpt-claude-plugins   # repeat per plugin
# restart Claude Code
```

## Update

```bash
claude plugin marketplace update joelpt-claude-plugins
```

Plugin changes ship from each plugin's own repo (bump its `plugin.json` `version` — the cache is
version-keyed). This index only changes when a plugin is added or removed.

## Migrated from a monorepo (2026-05-18)

Previously a monorepo with plugins under `plugins/`. If you had the old marketplace installed,
the source identity and repo name changed — re-add and reinstall:

```bash
claude plugin marketplace remove joelpt-claude-plugins
claude plugin marketplace add joelpt/joelpt-claude-plugins
claude plugin uninstall <name>@joelpt-claude-plugins && claude plugin install <name>@joelpt-claude-plugins
# restart Claude Code
```

## License

Private. Each plugin repo carries its own license.
