---
name: clickup-usage
description: Use when interacting with ClickUp for task management, project tracking, searching tasks, creating or updating work items, managing docs, time tracking, or any ClickUp workspace operations
---

# ClickUp Usage Guide

## Overview

This skill guides effective use of ClickUp MCP tools for project management within Claude Code. The plugin wraps the `@taazkareem/clickup-mcp-server` providing full ClickUp workspace access.

## When to Use

- Creating, updating, searching, or managing ClickUp tasks
- Navigating workspaces, spaces, folders, and lists
- Managing ClickUp docs, comments, or chat messages
- Time tracking operations
- Any project management workflow involving ClickUp

## Best Practices

### Search Before Creating

Always search for existing tasks before creating new ones to avoid duplicates:
1. Use the search/query tools to check if a similar task exists
2. Only create a new task if no match is found

### Name Resolution

The server supports intelligent fuzzy search — you can reference items by name rather than ID. Use natural language names for spaces, lists, folders, and tasks when possible.

### Required Context

When creating or updating tasks, ensure you have:
- The target **list** (or space/folder for navigation)
- A clear **task name** and **description**
- Appropriate **status**, **priority**, and **assignee** if relevant

### Working with Hierarchies

ClickUp's hierarchy: **Workspace > Space > Folder > List > Task > Subtask**

- Start broad (list spaces) and narrow down to find the right location
- Use folder and list names for context when searching

### Time Tracking

- Use natural language dates (e.g., "yesterday", "last Monday")
- Start/stop timers or log manual entries
- Filter time entries across workspaces by date ranges

### Comments and Collaboration

- Support for threaded replies
- Rich text with markdown conversion
- User @mentions supported

## Authentication

The plugin requires three environment variables:
- `CLICKUP_API_KEY` — Your ClickUp personal API token (from ClickUp Settings > Apps)
- `CLICKUP_TEAM_ID` — Your workspace ID (the first number in your ClickUp URL after `clickup.com/`)
- `CLICKUP_MCP_LICENSE_KEY` — License key for the MCP server (see upstream docs)

## Troubleshooting

- **Tools not appearing**: Ensure all three env vars are set correctly
- **Authentication errors**: Verify your API key is valid and not expired
- **Team not found**: Double-check the Team ID from your ClickUp URL
- **Permission errors**: Ensure your API key has access to the target workspace/space
