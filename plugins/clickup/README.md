# ClickUp Plugin for Claude Code

A Claude Code plugin that integrates with ClickUp for project management. Wraps the [`@taazkareem/clickup-mcp-server`](https://www.npmjs.com/package/@taazkareem/clickup-mcp-server) MCP server.

## Features

- Task management (create, update, search, delete, duplicate, link)
- Workspace navigation (spaces, folders, lists)
- Document management (create, read, append)
- Time tracking (timers, manual entries, filtering)
- Chat and comments with threaded replies
- Intelligent fuzzy search across all entities
- Natural language date support

## Prerequisites

1. **ClickUp API Key** — Go to [ClickUp Settings > Apps](https://app.clickup.com/settings/apps) and generate an API token.

2. **ClickUp Team ID** — Open ClickUp in your browser. The URL looks like `https://app.clickup.com/1234567/...` — the first number (`1234567`) is your Team ID.

3. **MCP Server License Key** — The upstream server requires a license. See the [upstream docs](https://www.npmjs.com/package/@taazkareem/clickup-mcp-server) for details.

## Installation

### From this repository

```bash
# Add the dev marketplace
/plugin marketplace add /path/to/clickup-plugin

# Install the plugin
/plugin install clickup@clickup-dev
```

### Set environment variables

Configure the required environment variables for the plugin. You can set them in your shell profile or via Claude Code's plugin environment configuration:

```bash
export CLICKUP_API_KEY="your-api-key"
export CLICKUP_TEAM_ID="your-team-id"
export CLICKUP_MCP_LICENSE_KEY="your-license-key"
```

Then restart Claude Code.

## Usage

Once installed, ClickUp tools are available directly in Claude Code. Examples:

- "Search for tasks assigned to me in the Engineering space"
- "Create a task in the Sprint Backlog list called 'Fix login bug'"
- "Update task status to 'In Progress'"
- "Show me all tasks due this week"
- "Log 2 hours on task 'API refactor' for yesterday"

## License

MIT
