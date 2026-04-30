#!/usr/bin/env bats

load test_helper

HOOK_SCRIPT="$PLUGIN_ROOT/hooks/session-start.sh"

@test "outputs a tip when tips database has unshown tips" {
  create_sample_tips_db 2
  output=$(echo '{}' | "$HOOK_SCRIPT")
  # Must be valid JSON with hookSpecificOutput.hookEventName = "SessionStart"
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "selected tip content appears in additionalContext" {
  create_sample_tips_db 1
  output=$(echo '{}' | "$HOOK_SCRIPT")
  context=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')
  # The single tip content should appear in additionalContext
  [[ "$context" == *"Sample tip number 1"* ]]
}

@test "exits silently with no tips database" {
  # No tips.json exists - should create empty DB and produce no output
  rm -f "$TEST_DATA_DIR/tips.json"
  output=$(echo '{}' | "$HOOK_SCRIPT")
  [ -z "$output" ]
  # Should have created an empty tips.json
  [ -f "$TEST_DATA_DIR/tips.json" ]
}

@test "exits silently with empty tips array" {
  create_empty_tips_db
  output=$(echo '{}' | "$HOOK_SCRIPT")
  [ -z "$output" ]
}

@test "marks selected tip as shown with timestamp" {
  create_sample_tips_db 1
  echo '{}' | "$HOOK_SCRIPT" > /dev/null
  shown_at=$(jq -r '.tips[0].shown_at' "$TEST_DATA_DIR/tips.json")
  [ "$shown_at" != "null" ]
}

@test "increments show_count when tip is shown" {
  create_sample_tips_db 1
  echo '{}' | "$HOOK_SCRIPT" > /dev/null
  show_count=$(jq -r '.tips[0].show_count' "$TEST_DATA_DIR/tips.json")
  [ "$show_count" -eq 1 ]
}

@test "picks least recently shown tip when all tips are shown" {
  # Create 2 tips, both already shown, with different shown_at timestamps
  create_tips_json '{
    "schema_version": 1,
    "tips": [
      {
        "id": "tip-recent",
        "content": "Recently shown tip",
        "category": "workflow",
        "source": "test",
        "keywords": ["test"],
        "created_at": "2026-03-01T00:00:00Z",
        "shown_at": "2026-03-05T12:00:00Z",
        "show_count": 1,
        "value_score": 0.5,
        "user_relevance_score": 0.5
      },
      {
        "id": "tip-old",
        "content": "Oldest shown tip",
        "category": "workflow",
        "source": "test",
        "keywords": ["test"],
        "created_at": "2026-03-01T00:00:00Z",
        "shown_at": "2026-03-03T12:00:00Z",
        "show_count": 1,
        "value_score": 0.5,
        "user_relevance_score": 0.5
      }
    ],
    "metadata": {
      "last_generation_run": null,
      "last_curation_run": null,
      "total_tips_generated": 0,
      "total_tips_retired": 0,
      "user_profile_summary": ""
    }
  }'
  output=$(echo '{}' | "$HOOK_SCRIPT")
  context=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')
  # Should pick the least recently shown (tip-old, shown_at 2026-03-03)
  [[ "$context" == *"Oldest shown tip"* ]]
}

@test "triggers generation when unshown tips below watermark" {
  create_sample_tips_db 3
  # Create a mock generate script that touches a flag file
  export GENERATE_SCRIPT="$TEST_DATA_DIR/mock-generate.sh"
  cat > "$GENERATE_SCRIPT" << 'MOCK'
#!/bin/bash
touch "$1/generation_triggered"
MOCK
  chmod +x "$GENERATE_SCRIPT"
  echo '{}' | "$HOOK_SCRIPT" > /dev/null
  # Wait briefly for background process
  sleep 0.5
  [ -f "$TEST_DATA_DIR/generation_triggered" ]
}

@test "triggers generation when last run was over 24 hours ago" {
  create_sample_tips_db 10
  # Set last_generation_run to 25 hours ago
  old_time=$(date -u -v-25H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "25 hours ago" +"%Y-%m-%dT%H:%M:%SZ")
  jq --arg t "$old_time" '.metadata.last_generation_run = $t' "$TEST_DATA_DIR/tips.json" > "$TEST_DATA_DIR/tips.json.tmp"
  mv "$TEST_DATA_DIR/tips.json.tmp" "$TEST_DATA_DIR/tips.json"

  export GENERATE_SCRIPT="$TEST_DATA_DIR/mock-generate.sh"
  cat > "$GENERATE_SCRIPT" << 'MOCK'
#!/bin/bash
touch "$1/generation_triggered"
MOCK
  chmod +x "$GENERATE_SCRIPT"
  echo '{}' | "$HOOK_SCRIPT" > /dev/null
  sleep 0.5
  [ -f "$TEST_DATA_DIR/generation_triggered" ]
}

@test "does not trigger generation when tips are fresh and sufficient" {
  create_sample_tips_db 10
  # Set last_generation_run to 1 hour ago
  recent_time=$(date -u -v-1H +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "1 hour ago" +"%Y-%m-%dT%H:%M:%SZ")
  jq --arg t "$recent_time" '.metadata.last_generation_run = $t' "$TEST_DATA_DIR/tips.json" > "$TEST_DATA_DIR/tips.json.tmp"
  mv "$TEST_DATA_DIR/tips.json.tmp" "$TEST_DATA_DIR/tips.json"

  export GENERATE_SCRIPT="$TEST_DATA_DIR/mock-generate.sh"
  cat > "$GENERATE_SCRIPT" << 'MOCK'
#!/bin/bash
touch "$1/generation_triggered"
MOCK
  chmod +x "$GENERATE_SCRIPT"
  echo '{}' | "$HOOK_SCRIPT" > /dev/null
  sleep 0.5
  [ ! -f "$TEST_DATA_DIR/generation_triggered" ]
}
