# /reload-joelpt-plugins — Refresh marketplace cache and update installed plugins

Pull the latest manifests from `joelpt-claude-plugins` and update every installed plugin to its
newest published version.

## Step 1 — Pull local marketplace repo

```bash
git -C ~/code/joelpt-claude-plugins pull
```

If the pull fails (network error, merge conflict, etc.), stop and report — do not proceed with
a stale local index.

## Step 2 — Update marketplace index in plugin cache

```bash
claude plugin marketplace update joelpt-claude-plugins
```

This fetches the latest manifests from GitHub into the local plugin cache.
If the command fails, stop and report the error — do not proceed to Step 3 with a stale cache.

## Step 3 — Update each installed plugin

Read `~/code/joelpt-claude-plugins/.claude-plugin/marketplace.json`.

For each entry in `plugins[]`:

- If `source.source != "github"`: note "SKIPPED (SOURCE-TYPE): NAME" and move on.
- If `source.source == "github"`: run `claude plugin update NAME@joelpt-claude-plugins`
  - If the update succeeds: note "UPDATED: NAME"
  - If the plugin is not installed: note "SKIPPED (not installed): NAME"
  - If the update fails for another reason: note "FAILED: NAME — ERROR" and continue

## Step 4 — Print summary

Emit a compact table:

```text
Plugin                      Result
──────────────────────────  ──────────────────────
wip                         UPDATED
tao                         UPDATED
jack                        SKIPPED (git-subdir)
tip-of-the-day              SKIPPED (not installed)
```

End with a reminder:

> Plugin code is loaded at session start. **Restart Claude Code** (or open a new session) for
> updated versions to take effect.
