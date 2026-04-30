#!/usr/bin/env bats

load test_helper

setup() {
  export TEST_DATA_DIR="$(mktemp -d)"
  export DATA_DIR="$TEST_DATA_DIR"
  # Create mock plugin directory
  export MOCK_PLUGINS_DIR="$TEST_DATA_DIR/mock-plugins"
  mkdir -p "$MOCK_PLUGINS_DIR/test-plugin/.claude-plugin"
  echo '{"name":"test-plugin","description":"A test plugin","version":"1.0.0"}' \
    > "$MOCK_PLUGINS_DIR/test-plugin/.claude-plugin/plugin.json"
  mkdir -p "$MOCK_PLUGINS_DIR/test-plugin/skills/cool-skill"
  cat > "$MOCK_PLUGINS_DIR/test-plugin/skills/cool-skill/SKILL.md" << 'EOF'
---
name: cool-skill
description: Use when you need to do cool things
---
# Cool Skill
Does cool stuff.
EOF
}

teardown() {
  rm -rf "$TEST_DATA_DIR"
}

GENERATE_SCRIPT="$PLUGIN_ROOT/scripts/generate-tips.sh"

@test "discover_local_plugins finds plugin.json files" {
  source "$GENERATE_SCRIPT" --source-only
  result=$(discover_local_plugins "$MOCK_PLUGINS_DIR")
  echo "$result" | jq -e 'length > 0'
  echo "$result" | jq -e '.[0].name == "test-plugin"'
}

@test "discover_local_plugins extracts description and version" {
  source "$GENERATE_SCRIPT" --source-only
  result=$(discover_local_plugins "$MOCK_PLUGINS_DIR")
  echo "$result" | jq -e '.[0].description == "A test plugin"'
  echo "$result" | jq -e '.[0].version == "1.0.0"'
}

@test "discover_local_plugins returns empty array for empty dir" {
  source "$GENERATE_SCRIPT" --source-only
  empty_dir="$TEST_DATA_DIR/empty"
  mkdir -p "$empty_dir"
  result=$(discover_local_plugins "$empty_dir")
  echo "$result" | jq -e 'length == 0'
}

@test "discover_local_skills finds SKILL.md files" {
  source "$GENERATE_SCRIPT" --source-only
  result=$(discover_local_skills "$MOCK_PLUGINS_DIR")
  echo "$result" | jq -e 'length > 0'
  echo "$result" | jq -e '.[0].name == "cool-skill"'
}

@test "discover_local_skills extracts description" {
  source "$GENERATE_SCRIPT" --source-only
  result=$(discover_local_skills "$MOCK_PLUGINS_DIR")
  echo "$result" | jq -e '.[0].description == "Use when you need to do cool things"'
}

@test "discover_local_skills returns empty array for empty dir" {
  source "$GENERATE_SCRIPT" --source-only
  empty_dir="$TEST_DATA_DIR/empty"
  mkdir -p "$empty_dir"
  result=$(discover_local_skills "$empty_dir")
  echo "$result" | jq -e 'length == 0'
}

@test "build_generation_context creates valid JSON context" {
  source "$GENERATE_SCRIPT" --source-only
  create_empty_tips_db
  result=$(build_generation_context \
    '[{"name":"test-plugin","description":"A test"}]' \
    '[{"name":"cool-skill","description":"Does stuff"}]' \
    "User works on web development" \
    "$TEST_DATA_DIR/tips.json")
  echo "$result" | jq -e '.plugins[0].name == "test-plugin"'
  echo "$result" | jq -e '.skills[0].name == "cool-skill"'
  echo "$result" | jq -e '.user_profile == "User works on web development"'
  echo "$result" | jq -e '.existing_tips | type == "array"'
}

@test "merge_new_tips adds tips to existing database" {
  source "$GENERATE_SCRIPT" --source-only
  create_sample_tips_db 2
  new_tips='[{"id":"tip-new-001","content":"Brand new tip","category":"workflow","source":"test","keywords":["new"],"value_score":0.8,"user_relevance_score":0.7}]'
  merge_new_tips "$TEST_DATA_DIR/tips.json" "$new_tips"
  count=$(jq '.tips | length' "$TEST_DATA_DIR/tips.json")
  [ "$count" -eq 3 ]
}

@test "merge_new_tips sets created_at on new tips" {
  source "$GENERATE_SCRIPT" --source-only
  create_empty_tips_db
  new_tips='[{"id":"tip-new-001","content":"A new tip","category":"workflow","source":"test","keywords":["new"],"value_score":0.5,"user_relevance_score":0.5}]'
  merge_new_tips "$TEST_DATA_DIR/tips.json" "$new_tips"
  created_at=$(jq -r '.tips[0].created_at' "$TEST_DATA_DIR/tips.json")
  [ "$created_at" != "null" ]
  [ -n "$created_at" ]
}

@test "merge_new_tips increments total_tips_generated" {
  source "$GENERATE_SCRIPT" --source-only
  create_empty_tips_db
  new_tips='[{"id":"tip-1","content":"Tip 1","category":"workflow","source":"test","keywords":["new"],"value_score":0.5,"user_relevance_score":0.5},{"id":"tip-2","content":"Tip 2","category":"workflow","source":"test","keywords":["new"],"value_score":0.5,"user_relevance_score":0.5}]'
  merge_new_tips "$TEST_DATA_DIR/tips.json" "$new_tips"
  total=$(jq '.metadata.total_tips_generated' "$TEST_DATA_DIR/tips.json")
  [ "$total" -eq 2 ]
}

@test "fetch_online_sources returns source info from config" {
  source "$GENERATE_SCRIPT" --source-only
  config_file="$TEST_DATA_DIR/sources.json"
  echo '{"sources":[{"name":"Test Blog","url":"https://example.com","type":"blog","priority":"high"}],"generation":{"low_watermark":5,"staleness_hours":24,"max_tips":200,"target_unshown":30}}' > "$config_file"
  result=$(fetch_online_sources "$config_file")
  [ -n "$result" ]
  [[ "$result" == *"Test Blog"* ]]
}

@test "build_user_profile returns non-empty string" {
  source "$GENERATE_SCRIPT" --source-only
  result=$(build_user_profile)
  [ -n "$result" ]
}
