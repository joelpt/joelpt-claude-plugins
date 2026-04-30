#!/usr/bin/env bash
set -euo pipefail

# Consume hook input from stdin (unused but must be drained)
cat /dev/stdin >/dev/null 2>&1 || true

# Resolve directories
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$PLUGIN_DIR/data}"
CONFIG_DIR="${CONFIG_DIR:-$PLUGIN_DIR/config}"
TIPS_FILE="$DATA_DIR/tips.json"

# Ensure data directory exists
mkdir -p "$DATA_DIR"

# If no tips database, create an empty one and exit silently
if [ ! -f "$TIPS_FILE" ]; then
  jq -n '{
    schema_version: 1,
    tips: [],
    metadata: {
      last_generation_run: null,
      last_curation_run: null,
      total_tips_generated: 0,
      total_tips_retired: 0,
      user_profile_summary: ""
    }
  }' > "$TIPS_FILE"
  exit 0
fi

# Read tips count
TIP_COUNT=$(jq '.tips | length' "$TIPS_FILE")

# If no tips, exit silently
if [ "$TIP_COUNT" -eq 0 ]; then
  exit 0
fi

# Count unshown tips
UNSHOWN_COUNT=$(jq '[.tips[] | select(.shown_at == null)] | length' "$TIPS_FILE")

if [ "$UNSHOWN_COUNT" -gt 0 ]; then
  # Pick highest weighted unshown tip (weight = value_score * user_relevance_score)
  SELECTED=$(jq '[.tips[] | select(.shown_at == null)] | sort_by(-(.value_score * .user_relevance_score)) | .[0]' "$TIPS_FILE")
else
  # All tips shown - pick least recently shown
  SELECTED=$(jq '.tips | sort_by(.shown_at) | .[0]' "$TIPS_FILE")
fi

SELECTED_ID=$(echo "$SELECTED" | jq -r '.id')
SELECTED_CONTENT=$(echo "$SELECTED" | jq -r '.content')

# Mark tip as shown: update shown_at and increment show_count
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq --arg id "$SELECTED_ID" --arg now "$NOW" '
  .tips = [.tips[] |
    if .id == $id then
      .shown_at = $now | .show_count = (.show_count + 1)
    else . end
  ]
' "$TIPS_FILE" > "${TIPS_FILE}.tmp" && mv "${TIPS_FILE}.tmp" "$TIPS_FILE"

# Output hookSpecificOutput JSON
jq -n --arg content "$SELECTED_CONTENT" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ("Tip of the Day: Present the following tip to the user in a nicely formatted block at the start of the conversation:\n\n" + $content)
  }
}'

# --- Generation Trigger Check ---
CONFIG_FILE="$CONFIG_DIR/sources.json"
LOW_WATERMARK=5
STALENESS_HOURS=24

if [ -f "$CONFIG_FILE" ]; then
  LOW_WATERMARK=$(jq -r '.generation.low_watermark // 5' "$CONFIG_FILE")
  STALENESS_HOURS=$(jq -r '.generation.staleness_hours // 24' "$CONFIG_FILE")
fi

SHOULD_GENERATE=false

# Check 1: unshown tips below watermark (re-read after marking shown)
REMAINING_UNSHOWN=$(jq '[.tips[] | select(.shown_at == null)] | length' "$TIPS_FILE")
if [ "$REMAINING_UNSHOWN" -lt "$LOW_WATERMARK" ]; then
  SHOULD_GENERATE=true
fi

# Check 2: staleness
LAST_GEN=$(jq -r '.metadata.last_generation_run // "null"' "$TIPS_FILE")
if [ "$LAST_GEN" = "null" ]; then
  SHOULD_GENERATE=true
else
  LAST_GEN_EPOCH=$(date -jf "%Y-%m-%dT%H:%M:%SZ" "$LAST_GEN" +%s 2>/dev/null || date -d "$LAST_GEN" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  STALENESS_SECONDS=$((STALENESS_HOURS * 3600))
  if [ $((NOW_EPOCH - LAST_GEN_EPOCH)) -gt "$STALENESS_SECONDS" ]; then
    SHOULD_GENERATE=true
  fi
fi

if [ "$SHOULD_GENERATE" = true ]; then
  GENERATE_CMD="${GENERATE_SCRIPT:-$PLUGIN_DIR/scripts/generate-tips.sh}"
  if [ -x "$GENERATE_CMD" ]; then
    "$GENERATE_CMD" "$DATA_DIR" "$CONFIG_DIR" &
  fi
fi
