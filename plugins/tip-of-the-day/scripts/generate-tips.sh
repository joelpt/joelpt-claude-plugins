#!/usr/bin/env bash
set -euo pipefail

# Allow sourcing for testing individual functions
if [[ "${1:-}" == "--source-only" ]]; then
  :
else
  MAIN_ENABLED=true
fi

discover_local_plugins() {
  local plugins_dir="${1:-$HOME/.claude/plugins}"
  local results="[]"
  while IFS= read -r plugin_json; do
    local name desc version
    name=$(jq -r '.name // "unknown"' "$plugin_json" 2>/dev/null || echo "unknown")
    desc=$(jq -r '.description // ""' "$plugin_json" 2>/dev/null || echo "")
    version=$(jq -r '.version // ""' "$plugin_json" 2>/dev/null || echo "")
    results=$(echo "$results" | jq \
      --arg name "$name" \
      --arg desc "$desc" \
      --arg version "$version" \
      --arg path "$plugin_json" \
      '. + [{"name": $name, "description": $desc, "version": $version, "path": $path}]')
  done < <(find "$plugins_dir" -name "plugin.json" -path "*/.claude-plugin/*" \
    -not -path "*/node_modules/*" 2>/dev/null || true)
  echo "$results"
}

discover_local_skills() {
  local plugins_dir="${1:-$HOME/.claude/plugins}"
  local results="[]"
  while IFS= read -r skill_md; do
    local name desc
    name=$(awk '/^---$/{if(f){exit}else{f=1;next}} f && /^name:/{sub(/^name: */,""); print}' "$skill_md" 2>/dev/null || echo "")
    desc=$(awk '/^---$/{if(f){exit}else{f=1;next}} f && /^description:/{sub(/^description: */,""); print}' "$skill_md" 2>/dev/null || echo "")
    if [ -z "$name" ]; then
      name=$(basename "$(dirname "$skill_md")")
    fi
    results=$(echo "$results" | jq \
      --arg name "$name" \
      --arg desc "$desc" \
      --arg path "$skill_md" \
      '. + [{"name": $name, "description": $desc, "path": $path}]')
  done < <(find "$plugins_dir" -name "SKILL.md" \
    -not -path "*/node_modules/*" 2>/dev/null || true)
  echo "$results"
}

build_generation_context() {
  local plugins="$1"
  local skills="$2"
  local user_profile="$3"
  local tips_file="$4"

  local existing_tips="[]"
  if [ -f "$tips_file" ]; then
    existing_tips=$(jq '[.tips[] | {id, content, category, keywords}]' "$tips_file")
  fi

  jq -n \
    --argjson plugins "$plugins" \
    --argjson skills "$skills" \
    --arg user_profile "$user_profile" \
    --argjson existing_tips "$existing_tips" \
    '{
      plugins: $plugins,
      skills: $skills,
      user_profile: $user_profile,
      existing_tips: $existing_tips
    }'
}

merge_new_tips() {
  local tips_file="$1"
  local new_tips_json="$2"

  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local enriched_tips
  enriched_tips=$(echo "$new_tips_json" | jq --arg now "$now" '
    [.[] | . + {
      created_at: (.created_at // $now),
      shown_at: (.shown_at // null),
      show_count: (.show_count // 0),
      value_score: (.value_score // 0.5),
      user_relevance_score: (.user_relevance_score // 0.5)
    }]
  ')

  jq --argjson new_tips "$enriched_tips" '
    .tips += $new_tips
    | .metadata.total_tips_generated += ($new_tips | length)
  ' "$tips_file" > "${tips_file}.tmp" && mv "${tips_file}.tmp" "$tips_file"
}

build_user_profile() {
  local profile="General Claude Code user"
  local projects_dir="$HOME/.claude/projects"
  if [ -d "$projects_dir" ]; then
    local recent_projects
    recent_projects=$(find "$projects_dir" -maxdepth 1 -type d -mtime -14 2>/dev/null | head -10 | while read -r d; do basename "$d" 2>/dev/null; done | tr '\n' ', ' | sed 's/,$//')
    if [ -n "$recent_projects" ]; then
      profile="Works on projects: $recent_projects"
    fi
  fi
  echo "$profile"
}

extract_claude_output() {
  local input
  input=$(cat)
  # Claude Code CLI 2.x wraps responses in a JSON envelope: {"type":"result","result":"..."}
  # Object with .result → unwrap to inner text. Object without .result → error envelope, suppress.
  # Non-object input (array, plain text) passes through — defensive for callers without --output-format json.
  if echo "$input" | jq -e 'type == "object"' >/dev/null 2>&1; then
    echo "$input" | jq -r '.result // empty'
  else
    echo "$input"
  fi
}

fetch_online_sources() {
  local config_file="$1"
  if [ ! -f "$config_file" ]; then
    echo "[]"
    return
  fi
  jq -r '.sources[] | "\(.name)|\(.url)|\(.priority)"' "$config_file"
}

# Main execution
if [ "${MAIN_ENABLED:-false}" = true ]; then
  DATA_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/data}"
  CONFIG_DIR="${2:-$(cd "$(dirname "$0")/.." && pwd)/config}"
  TIPS_FILE="$DATA_DIR/tips.json"
  CONFIG_FILE="$CONFIG_DIR/sources.json"
  PLUGINS_DIR="$HOME/.claude/plugins"
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

  mkdir -p "$DATA_DIR"

  # Create empty DB if missing
  if [ ! -f "$TIPS_FILE" ]; then
    jq -n '{schema_version:1,tips:[],metadata:{last_generation_run:null,last_curation_run:null,total_tips_generated:0,total_tips_retired:0,user_profile_summary:""}}' > "$TIPS_FILE"
  fi

  echo "TOTD: Starting tip generation pipeline..." >&2

  # Phase 1: Local discovery
  LOCAL_PLUGINS=$(discover_local_plugins "$PLUGINS_DIR")
  LOCAL_SKILLS=$(discover_local_skills "$PLUGINS_DIR")
  echo "TOTD: Found $(echo "$LOCAL_PLUGINS" | jq 'length') plugins, $(echo "$LOCAL_SKILLS" | jq 'length') skills" >&2

  # Phase 2: User profiling
  USER_PROFILE=$(build_user_profile)
  echo "TOTD: User profile: $USER_PROFILE" >&2

  # Phase 3: Build context and generate tips via Claude
  CONTEXT=$(build_generation_context "$LOCAL_PLUGINS" "$LOCAL_SKILLS" "$USER_PROFILE" "$TIPS_FILE")
  ONLINE_SOURCES=$(fetch_online_sources "$CONFIG_FILE")

  GENERATE_PROMPT=$(cat "$SCRIPT_DIR/prompt-generate.md")

  echo "TOTD: Generating new tips via Claude CLI..." >&2
  NEW_TIPS=$(printf '%s\n\n## Online Sources to Check\n%s\n\n---\n\n%s' \
    "$CONTEXT" "$ONLINE_SOURCES" "$GENERATE_PROMPT" \
    | claude -p --output-format json --max-turns 3 --allowedTools "WebFetch,Read" 2>/dev/null \
    | extract_claude_output || echo '[]')

  # Validate and merge
  if echo "$NEW_TIPS" | jq -e 'type == "array"' >/dev/null 2>&1; then
    TIP_COUNT=$(echo "$NEW_TIPS" | jq 'length')
    echo "TOTD: Generated $TIP_COUNT new tips" >&2
    if [ "$TIP_COUNT" -gt 0 ]; then
      merge_new_tips "$TIPS_FILE" "$NEW_TIPS"
    fi
  else
    echo "TOTD: Warning - Claude did not return valid tip array, skipping merge" >&2
  fi

  # Phase 4: Curation via Claude
  CURATE_PROMPT=$(cat "$SCRIPT_DIR/prompt-curate.md")
  MAX_TIPS=$(jq -r '.generation.max_tips // 200' "$CONFIG_FILE" 2>/dev/null || echo 200)

  echo "TOTD: Curating tip database via Claude CLI..." >&2
  CURATED_DB=$(printf '## Current Tip Database\n\n%s\n\n## User Profile\n%s\n\n## Configuration\nmax_tips: %s\n\n---\n\n%s' \
    "$(cat "$TIPS_FILE")" "$USER_PROFILE" "$MAX_TIPS" "$CURATE_PROMPT" \
    | claude -p --output-format json --max-turns 1 2>/dev/null \
    | extract_claude_output || echo '')

  NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if echo "$CURATED_DB" | jq -e '.tips' >/dev/null 2>&1; then
    echo "$CURATED_DB" | jq --arg now "$NOW" '
      .metadata.last_generation_run = $now
      | .metadata.last_curation_run = $now
      | del(.curation_report)
    ' > "$TIPS_FILE"
    echo "TOTD: Curation complete" >&2
  else
    jq --arg now "$NOW" '.metadata.last_generation_run = $now' "$TIPS_FILE" > "${TIPS_FILE}.tmp" && mv "${TIPS_FILE}.tmp" "$TIPS_FILE"
    echo "TOTD: Curation skipped (invalid output), timestamps updated" >&2
  fi

  echo "TOTD: Pipeline complete. $(jq '.tips | length' "$TIPS_FILE") total tips." >&2
fi
