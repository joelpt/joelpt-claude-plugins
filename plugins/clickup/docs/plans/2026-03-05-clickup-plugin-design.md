# ClickUp Claude Code Plugin — Design

## Purpose

Create a Claude Code plugin that integrates with the ClickUp API, wrapping the existing `@taazkareem/clickup-mcp-server` npm package. Provides task management, project tracking, and search capabilities directly within Claude Code.

## Architecture

**Pattern**: MCP Plugin with Skill (stdio transport)

### File Structure

```
clickup-plugin/
├── .claude-plugin/
│   ├── plugin.json              # Metadata + mcpServers config (stdio)
│   └── marketplace.json         # Dev marketplace for local testing
├── skills/
│   └── clickup-usage/
│       └── SKILL.md             # Usage guidance for Claude
├── package.json                 # Dependency: @taazkareem/clickup-mcp-server
├── README.md
└── LICENSE
```

### MCP Server

- **Transport**: stdio (local child process)
- **Upstream**: `@taazkareem/clickup-mcp-server` via npx
- **Auth**: `CLICKUP_API_TOKEN` env var via `${PLUGIN_ENV_CLICKUP_API_TOKEN}`
- **Scope**: All tools the upstream server exposes (tasks, docs, lists, spaces, comments, etc.)

### plugin.json

```json
{
  "name": "clickup",
  "description": "ClickUp project management integration. Create and manage tasks, search projects, update assignments, track progress, and integrate your development workflow with ClickUp.",
  "author": {"name": "Joel Thor"},
  "mcpServers": {
    "clickup": {
      "command": "npx",
      "args": ["-y", "@taazkareem/clickup-mcp-server"],
      "env": {
        "CLICKUP_API_TOKEN": "${PLUGIN_ENV_CLICKUP_API_TOKEN}"
      }
    }
  }
}
```

### Skill

Lightweight `SKILL.md` teaching Claude:
- When to use ClickUp tools
- Best practices (search before creating, include required IDs)
- Common workflows (create task, update status, search across spaces)
- Authentication troubleshooting

### Authentication

Personal API Token flow:
1. User generates token in ClickUp settings
2. Sets `CLICKUP_API_TOKEN` in environment or plugin env config
3. Plugin passes to MCP server process

### Distribution

- Local dev marketplace for testing
- GitHub repo ready for `/plugin marketplace add` distribution

## Comparison with Asana Plugin

| Aspect | Asana | ClickUp (ours) | Reason |
|--------|-------|-----------------|--------|
| Transport | SSE (remote) | stdio (local) | No hosted ClickUp MCP server |
| Auth | OAuth (auto) | API token (env var) | ClickUp API uses personal tokens |
| Dependencies | None | npm package | Wrapping @taazkareem/clickup-mcp-server |
| Skill | None | Yes | Value-add for Claude guidance |
| .mcp.json | Separate file | In plugin.json | Best practice for stdio per plugin docs |

## Decisions

- Wrap existing npm package rather than build from scratch (maintenance leverage)
- Start with all upstream tools, refine later if tool count causes noise
- Personal API token over OAuth (simpler, matches upstream server design)
