# Common test setup for all bats tests

# Plugin root for testing
export PLUGIN_ROOT="$(cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd)"

# Use a temp data directory for tests (isolated from real data)
setup() {
  export TEST_DATA_DIR="$(mktemp -d)"
  export DATA_DIR="$TEST_DATA_DIR"
}

teardown() {
  rm -rf "$TEST_DATA_DIR"
}

# Helper: create a tips.json with given content
create_tips_json() {
  local content="$1"
  echo "$content" > "$TEST_DATA_DIR/tips.json"
}

# Helper: create an empty tips database
create_empty_tips_db() {
  create_tips_json '{
    "schema_version": 1,
    "tips": [],
    "metadata": {
      "last_generation_run": null,
      "last_curation_run": null,
      "total_tips_generated": 0,
      "total_tips_retired": 0,
      "user_profile_summary": ""
    }
  }'
}

# Helper: create tips.json with N sample tips
create_sample_tips_db() {
  local count="${1:-3}"
  local tips="[]"
  for i in $(seq 1 "$count"); do
    tips=$(echo "$tips" | jq \
      --arg id "tip-$(printf '%03d' "$i")" \
      --arg content "Sample tip number $i" \
      --arg created "2026-03-01T00:00:00Z" \
      '. + [{
        "id": $id,
        "content": $content,
        "category": "workflow",
        "source": "test",
        "keywords": ["test"],
        "created_at": $created,
        "shown_at": null,
        "show_count": 0,
        "value_score": 0.5,
        "user_relevance_score": 0.5
      }]')
  done
  create_tips_json "$(jq -n \
    --argjson tips "$tips" \
    '{
      schema_version: 1,
      tips: $tips,
      metadata: {
        last_generation_run: "2026-03-05T12:00:00Z",
        last_curation_run: "2026-03-05T12:00:00Z",
        total_tips_generated: 0,
        total_tips_retired: 0,
        user_profile_summary: ""
      }
    }')"
}
