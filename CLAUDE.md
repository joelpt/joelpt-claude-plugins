# joelpt-claude-plugins (marketplace index)

This repo is Joel's personal Claude Code plugin **marketplace index — and nothing else**.
It contains `.claude-plugin/marketplace.json`, this file, and `README.md`. **No plugin content
lives here.** Each plugin lives in its own private GitHub repo.

GitHub: `https://github.com/joelpt/joelpt-claude-plugins` (private). Marketplace name
(`marketplace.json#name`): `joelpt-claude-plugins`.

> History: this was a monorepo until 2026-05-18, when every plugin was extracted to its own
> `joelpt/claude-plugin-<name>` repo and this repo was reduced to the index. The old invariant
> "don't fragment into per-plugin repos" is **reversed** — fragmentation is now the model.

## Repo model

- **One index, many external plugin repos.** Each plugin = one repo `joelpt/claude-plugin-<name>`,
  with a working copy at `~/code/claude-plugin-<name>`. Plugin lives at that repo's **root**.
- Every plugin entry in `marketplace.json` uses an external `source`
  (`{"source":"github","repo":"joelpt/claude-plugin-<name>"}`), never a relative `./` path.
- This index changes **only** when a plugin is added or removed. Editing a plugin's behaviour
  happens in *its own repo*, not here.

### Exceptions (do not rename / do not fold in)

| Plugin | Repo | `source` |
|---|---|---|
| `jack` | `joelpt/iloom-inside` (plugin at `jack/`) | `{"source":"git-subdir","url":"https://github.com/joelpt/iloom-inside.git","path":"jack","ref":"main"}` |

`maestro-downloader` is **not** a Claude Code plugin and must **never** appear in this
marketplace in any form. Its repo `joelpt/maestro-downloader` is unrelated to this index.

## Distribution mechanism (important, non-obvious)

Claude Code clones a `github` source over **SSH** (`git@github.com:owner/repo`). For these
private repos to install, an **SSH key must be registered with the GitHub account**
(`gh ssh-key add`; key at `~/.ssh/github-joelpt`, `~/.ssh/config` routes `github.com` to it).
HTTPS-only auth will fail with `Permission denied (publickey)`.

- Do **not** "fix" this with `git-subdir` + `path:"."` — that sparse-checkout (`/*` + `!/*/`)
  silently drops every subdirectory and installs a hollow plugin that reports success.
- `claude plugin install` **recurses submodules** automatically — the wrapper plugins rely on
  this (see below).

## Wrapper plugins (`plugin-dev`, `deep-research`)

Thin wrappers over a pinned third-party upstream, vendored as a git **submodule** at
`upstream/` in their own repo. Wrapper bodies reference it as
`${CLAUDE_PLUGIN_ROOT}/upstream/...` (portable; resolves in the install cache). Clone for dev
with `git clone --recurse-submodules`. Re-pin by updating the submodule + bumping the version.

## Editing / shipping a plugin (in its own repo)

1. `cd ~/code/claude-plugin-<name>`, make the change.
2. **Bump `.claude-plugin/plugin.json#version` (patch minimum).** The marketplace cache is keyed
   by version — without a bump, `claude plugin marketplace update` serves the stale cache.
3. `/commit` (raw `git commit` is banned except a brand-new repo's first commit), `git push`.
4. On each consumer machine: `claude plugin marketplace update joelpt-claude-plugins`, then
   `/exit` + reopen Claude Code (plugin code loads at session start; no hot reload).

No change to *this* repo is needed for plugin edits.

## Adding a new plugin

1. `gh repo create joelpt/claude-plugin-<name> --private`; working copy
   `~/code/claude-plugin-<name>`; plugin at root with `.claude-plugin/plugin.json`,
   `README.md`, `LICENSE`, `.gitignore`. `git init`, commit, push.
2. Append an entry to `.claude-plugin/marketplace.json`:
   `{"name":"<name>","source":{"source":"github","repo":"joelpt/claude-plugin-<name>"},"description":"…"}`.
3. `/commit` + push this index repo.
4. Consumers: `claude plugin marketplace update joelpt-claude-plugins`,
   `claude plugin install <name>@joelpt-claude-plugins`, restart.

## Removing a plugin

Delete its entry here, `/commit`, push. Optionally archive its repo. Consumers
`claude plugin uninstall <name>@joelpt-claude-plugins`.

## Consumer note — source identity changed

Plugins moved from in-tree (`./plugins/...`) to external repos, and this repo/marketplace was
renamed to `joelpt-claude-plugins`. A plain `marketplace update` is **not** enough. Each machine:

```bash
claude plugin marketplace remove joelpt-claude-plugins
claude plugin marketplace add joelpt/joelpt-claude-plugins
# for each plugin you use:
claude plugin uninstall <name>@joelpt-claude-plugins
claude plugin install  <name>@joelpt-claude-plugins
# then restart Claude Code
```

## License

Private. Each plugin repo carries its own license.
