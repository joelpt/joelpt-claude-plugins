# /bumpall — Sync versions and push all marketplace plugins

Visit every plugin listed in `~/code/joelpt-claude-plugins/.claude-plugin/marketplace.json`,
ensure version numbers are current with the commit history, and push any unpushed commits.

## Step 1 — Pull latest marketplace JSON

Pull the local marketplace index so the plugin list is current before processing:

```bash
git -C ~/code/joelpt-claude-plugins pull
```

If the pull fails, stop and report — do not proceed with a stale plugin list.

Then read `~/code/joelpt-claude-plugins/.claude-plugin/marketplace.json`.

For each entry in `plugins[]`:

- If `source.source == "github"`: derive local dir as `~/code/REPO-LEAF` where `REPO-LEAF` is
  the last segment of `source.repo` (e.g. `joelpt/claude-plugin-wip` → `~/code/claude-plugin-wip`).
- If `source.source == "git-subdir"`: skip — note "SKIPPED (git-subdir): NAME" and move on.
- Other source types: skip with a note.

## Step 2 — Process each derived directory

Run through each plugin directory. For each one, do **Steps 2a through 2c** in order.

### 2a — Existence check

If the directory does not exist: note "MISSING: NAME at DIR" and skip to the next plugin.

### 2b — Dirty-state check

```bash
git -C DIR status --porcelain
```

If output is non-empty: note "DIRTY: NAME — skipping (uncommitted changes)" and skip to next.

### 2c — Version-currency check (only if clean)

Find the last commit SHA that touched `.claude-plugin/plugin.json`:

```bash
git -C DIR log -1 --format=%H -- .claude-plugin/plugin.json
```

Count commits since that SHA:

- If the log returned **a SHA**: `git -C DIR rev-list --count SHA..HEAD`
- If the log returned **nothing** (no prior version commit): `git -C DIR rev-list --count HEAD`

**Edge case:** an empty log output means the file has never been committed with a version bump —
treat the full commit count as the "since" count (a bump is definitely needed).

If the count is **zero**: version is current, note "OK: NAME" and proceed to Step 2d.

If the count is **> 0**: a bump is required.

#### Computing the new CalVer version

1. Get today's UTC date: `date -u +%Y.%m.%d`
2. Read the current version from `.claude-plugin/plugin.json`:
   ```bash
   python3 -c "import json; print(json.load(open('DIR/.claude-plugin/plugin.json'))['version'])"
   ```
3. If the current version already starts with `YYYY.MM.DD.` (today's prefix):
   extract N from the last `.`-delimited segment; if N is not a valid integer, use N=1.
   Otherwise use N=1.
4. New version = `YYYY.MM.DD.N` (zero-padded month and day).

#### Writing the bump

Use Python to update the file in-place (preserve all other fields):

```bash
python3 -c "
import json, pathlib
p = pathlib.Path('DIR/.claude-plugin/plugin.json')
d = json.loads(p.read_text())
d['version'] = 'NEW_VERSION'
p.write_text(json.dumps(d, indent=2) + '\n')
"
```

Commit **only** `.claude-plugin/plugin.json`.
`--no-verify` is used here because this is a retroactive batch-recovery tool; pre-commit hooks
cannot run non-interactively in this context. This is a pre-authorized exception to the global
no-`--no-verify` rule.

```bash
git -C DIR add .claude-plugin/plugin.json
git -C DIR commit --no-verify -m "chore(version): bump to NEW_VERSION"
```

Note "BUMPED: NAME → NEW_VERSION".

### 2d — Push check (only if tree is clean; run after any bump from 2c)

```bash
git -C DIR status -b --porcelain | head -1
```

If the output contains `[ahead` (i.e., local branch is ahead of origin):

```bash
git -C DIR push
```

Note "PUSHED: NAME".

If already up-to-date: note "UP-TO-DATE: NAME".

## Step 3 — Handle the marketplace index repo itself

```bash
git -C ~/code/joelpt-claude-plugins status --porcelain
```

- **Dirty**: tell the user which files are modified and recommend running `/commit` or `/commitall`
  to commit them before pushing.
  Note "DIRTY: marketplace index" and **skip Step 5** — the updated manifests are not yet
  published and reloading would pull stale versions.
- **Clean, unpushed commits** (check `git -C ~/code/joelpt-claude-plugins status -b --porcelain | head -1`
  for `[ahead`): run `git -C ~/code/joelpt-claude-plugins push` and note "PUSHED: marketplace index".
- **Clean and up-to-date**: note "UP-TO-DATE: marketplace index".

## Step 4 — Print summary

Emit a compact table of all plugins processed:

```text
Plugin                      Status
──────────────────────────  ──────────────────────────────────
wip                         BUMPED 2026.05.21.1 → PUSHED
tao                         OK → UP-TO-DATE
commit-commands             DIRTY (skipped)
jack                        SKIPPED (git-subdir)
...
marketplace index           PUSHED
```

If anything was DIRTY or MISSING, call out a recommended next action per item.

## Step 5 — Refresh local plugin cache

(Only if Step 3 reported the marketplace index as CLEAN.)

After all pushes complete, invoke `/reload-joelpt-plugins` to pull the updated manifests and
update installed plugin versions in the local cache.
