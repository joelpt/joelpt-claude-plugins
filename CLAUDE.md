# claude-plugins (joelpt-claude-plugins)

This repo **is** Joel's personal Claude Code plugin marketplace.
The marketplace manifest is `.claude-plugin/marketplace.json`; each plugin lives at `plugins/<name>/`.
Pushed to `https://github.com/joelpt/claude-plugins` (private).

## Repo invariants

- One marketplace, many plugins. Don't fragment into per-plugin repos.
- Marketplace name (`marketplace.json#name`) is `joelpt-claude-plugins`. Don't rename without coordinating consumer-side `claude plugin marketplace add` invocations.
- Each plugin directory must contain `.claude-plugin/plugin.json`. Per-plugin `marketplace.json` files are forbidden — they conflict with the monorepo-level one.
- Plugin source paths in `marketplace.json` are relative (`./plugins/<name>`), never absolute or git URLs. Cross-repo `source` is allowed by Claude Code but defeats the point of the monorepo.
- Don't commit `node_modules/`, `.venv/`, `__pycache__/`, `.pytest_cache/`, `.ruff_cache/`, or per-project index dirs (`.search-rag/`, `.lance-rag/`).
- **Always bump `plugin.json#version` (patch minimum) when any plugin content changes.** The marketplace cache is keyed by version number — it will not re-fetch a version it has already downloaded. Without a version bump, `claude plugin marketplace update` silently serves the stale cache.

## After committing changes — making them live

**Critical**: Claude Code consumers see plugin changes only after the marketplace re-fetches from GitHub. Local commits don't propagate until pushed.

The full loop:

1. Commit changes to a plugin under `plugins/<name>/`.
2. **Push to `origin/main`.** This is non-negotiable — until then, no Claude Code session anywhere (including yours) will pick up the change.
3. On every machine that has the marketplace installed, refresh:

   ```bash
   claude plugin marketplace update joelpt-claude-plugins
   ```

4. **Restart Claude Code.** Plugin code (hooks, skills, commands) is loaded at session start; updating the marketplace mid-session does not hot-reload an active session.

### Can Claude do this automatically?

Partially. From inside a session, Claude **can**:

- Run `git push` after committing.
- Run `claude plugin marketplace update joelpt-claude-plugins` via Bash. This refreshes the cache for *future* sessions.

Claude **cannot** restart the current Claude Code process for the user — that's the user's call. So after Claude pushes and updates, it should tell the user: "pushed; run `/exit` and reopen Claude Code to load the new plugin code." Don't claim a plugin change is live until the user has restarted.

If `GITHUB_TOKEN` (or `GH_TOKEN`) is set in the user's env with `repo` scope, the marketplace also auto-refreshes on session start, so step 3 becomes implicit — but the restart in step 4 is still required.

### Quick recipe Claude should follow after editing a plugin

```bash
cd ~/code/claude-plugins
# Step 1 (REQUIRED): bump version in plugins/<name>/.claude-plugin/plugin.json before staging
git add plugins/<name>
git commit -m "<plugin>: <change>"
git push
claude plugin marketplace update joelpt-claude-plugins
```

Then tell the user: "Pushed and refreshed. Restart Claude Code (`/exit` + reopen) to load the new code."

## Adding a new plugin

1. `mkdir -p plugins/<name>/.claude-plugin`
2. Write `plugins/<name>/.claude-plugin/plugin.json` (`name`, `version`, `description`, `author`).
3. Add whatever surface the plugin exposes:
   - `commands/*.md` for slash commands
   - `skills/<skill-name>/SKILL.md` for skills
   - `hooks/hooks.json` + scripts for hooks
   - `agents/*.md` for subagents
4. Append an entry to `.claude-plugin/marketplace.json` under `plugins`. Match the directory name.
5. Commit, push, refresh, restart (per recipe above).

## Plugin naming

The plugin's *advertised* name (what users type in `@joelpt-claude-plugins`) comes from `plugin.json#name`, not the directory name — but **keep them identical** to avoid confusion. Current alignments:

| Directory | `plugin.json#name` |
|---|---|
| `clickup` | `clickup` |
| `deep-research` | `deep-research` |
| `maestro-downloader` | `maestro-downloader` |
| `plugin-dev` | `plugin-dev` |
| `search-rag` | `search-rag` |
| `tao` | `tao` |
| `the-plan` | `the-plan` |
| `tip-of-the-day` | `tip-of-the-day` |
| `wip` | `wip` |

## History note

Plugins originally lived as standalone dirs under `~/code/<name>` and as entries in a `local` marketplace at `~/.claude/plugins/marketplaces/local/`. They were vendored into this monorepo on 2026-04-30 via `rsync` (no git history preserved — the originals remain at their old paths as backup). `wip-skill` and `the-plan` had separate GitHub remotes (`joelpt/wip-skill`, `joelpt/the-plan`) which are now orphaned and should be archived once you've confirmed everything works here.

## License

Private. See individual plugin dirs for their own license declarations.
