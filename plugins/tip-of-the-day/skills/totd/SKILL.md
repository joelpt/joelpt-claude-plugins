---
name: totd
description: Show tip of the day, browse tips, request topic-specific tips, force regeneration, or view stats. Use when user asks about tips, wants productivity advice, or says /totd.
---

# Tip of the Day

You have access to the tip-of-the-day plugin's data files.

## Data Location

- Tips database: `${CLAUDE_PLUGIN_ROOT}/data/tips.json`
- Sources config: `${CLAUDE_PLUGIN_ROOT}/config/sources.json`
- Generation script: `${CLAUDE_PLUGIN_ROOT}/scripts/generate-tips.sh`

## Commands

Based on what the user asks, do one of the following:

### Show Current Tip (default)

Read the tips database, pick a random unshown tip (or least-recently-shown if all shown), and present it:

```
+-----------------------------------------------+
| Tip of the Day                                |
|                                               |
| [tip content here]                            |
|                                               |
| Category: [category] | Source: [source]       |
+-----------------------------------------------+
```

After presenting, update the tip's `shown_at` to the current timestamp and increment `show_count` in the database.

### List Recent Tips

If the user asks to "list tips", "show recent tips", or "what tips have I seen":

Read the database and show the last 10 shown tips (sorted by shown_at descending) with their dates and categories.

### Topic-Specific Tip

If the user asks for a tip about a specific topic (e.g., "tip about git", "tip about plugins", "totd web"):

Filter tips by keywords matching the topic. Pick the best unshown one matching that topic. If none unshown, pick least-recently-shown.

### Force Regeneration

If the user asks to "regenerate tips", "refresh tips", or "update tips":

Run the generation pipeline:
```bash
"${CLAUDE_PLUGIN_ROOT}/scripts/generate-tips.sh" "${CLAUDE_PLUGIN_ROOT}/data" "${CLAUDE_PLUGIN_ROOT}/config"
```

Report what happened (how many tips generated, curated, etc.) by reading stderr output or comparing tip counts before/after.

### Tip Stats

If the user asks for "tip stats", "how many tips", or "tip status":

Read the database and report:
- Total tips in database
- Unshown tips remaining
- Total times tips have been shown
- Last generation run timestamp
- Last curation run timestamp
- Top 5 categories by count
- User profile summary (if set)
