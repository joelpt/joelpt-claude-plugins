# /bumpall — Sync versions and push all marketplace plugins

Visit every plugin listed in `~/code/joelpt-claude-plugins/.claude-plugin/marketplace.json`,
ensure version numbers are current with the commit history, and push any unpushed commits.

## Step 1 — Parse the plugin list

Read `~/code/joelpt-claude-plugins/.claude-plugin/marketplace.json`.

For each entry in `plugins[]`:
- If `source.source == "github"`: derive local dir as `~/code/<repo-leaf>` where `<repo-leaf>` is
  the last segment of `source.repo` (e.g. `joelpt/claude-plugin-wip` → `~/code/claude-plugin-wip`).
- If `source.source == "git-subdir"`: skip — note "SKIPPED (git-subdir): <name>" and move on.
- Other source types: skip with a note.

## Step 2 — Process each derived directory

Run through each plugin directory. For each one, do **Steps 2a through 2c** in order.

### 2a — Existence check
If the directory does not exist: note "MISSING: <name> at <dir>" and skip to the next plugin.

### 2b — Dirty-state check
```bash
git -C <dir> status --porcelain
```
If output is non-empty: note "DIRTY: <name> — skipping (uncommitted changes)" and skip to next.

### 2c — Version-currency check (only if clean)

Find the last commit that touched `.claude-plugin/plugin.json`:
```bash
git -C <dir> log --oneline -1 -- .claude-plugin/plugin.json
```

Count commits on HEAD since that commit (i.e., newer work that has not yet been accompanied by a version bump):
```bash
git -C <dir> log --oneline <last_version_commit_hash>..HEAD | wc -l | tr -d ' '
```

**Edge case:** if there is no prior version commit at all (the log line is empty), treat the full
commit count as the "since" count — a bump is definitely needed.

If the count is **zero**: version is current, note "OK: <name>" and proceed to Step 2d.

If the count is **> 0**: a bump is required.

#### Computing the new CalVer version

1. Get today's UTC date: `date -u +%Y.%m.%d`
2. Read the current version from `.claude-plugin/plugin.json`:
   ```bash
   python3 -c "import json; print(json.load(open('<dir>/.claude-plugin/plugin.json'))['version'])"
   ```
3. If the current version already starts with `YYYY.MM.DD.` (today's prefix):
   extract N from the last `.`-delimited segment and use N+1.
   Otherwise use N=1.
4. New version = `YYYY.MM.DD.N` (zero-padded month and day).

#### Writing the bump

Use Python to update the file in-place (preserve all other fields):
```bash
python3 -c "
import json, pathlib
p = pathlib.Path('<dir>/.claude-plugin/plugin.json')
d = json.loads(p.read_text())
d['version'] = '<new_version>'
p.write_text(json.dumps(d, indent=2) + '\n')
"
```

Commit **only** `.claude-plugin/plugin.json` — no code review, no simplify, no pre-commit hooks:
```bash
git -C <dir> add .claude-plugin/plugin.json
git -C <dir> commit --no-verify -m "chore(version): bump to <new_version>"
```

Note "BUMPED: <name> → <new_version>".

### 2d — Push check (only if tree is clean; run after any bump from 2c)

```bash
git -C <dir> status -b --porcelain | head -1
```

If the output contains `[ahead` (i.e., local branch is ahead of origin):
```bash
git -C <dir> push
```
Note "PUSHED: <name>".

If already up-to-date: note "UP-TO-DATE: <name>".

## Step 3 — Handle the marketplace index repo itself

```bash
git -C ~/code/joelpt-claude-plugins status --porcelain
```

- **Dirty**: tell the user which files are modified and recommend running `/commit` or `/commitall`
  to commit them before pushing.
- **Clean, unpushed commits** (check `git -C ~/code/joelpt-claude-plugins status -b --porcelain | head -1`
  for `[ahead`): run `git -C ~/code/joelpt-claude-plugins push` and note "PUSHED: marketplace index".
- **Clean and up-to-date**: note "UP-TO-DATE: marketplace index".

## Step 4 — Print summary

Emit a compact table of all plugins processed:

```
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
