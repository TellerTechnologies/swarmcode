# Swarmcode

**Make your AI coding assistants aware of each other.**

Swarmcode is an MCP server that coordinates AI coding assistants across a team using git. When one developer's AI is about to create a file, implement a function, or work in a directory — it checks what teammates have already built and avoids duplication.

## The Problem

When multiple developers use AI coding assistants on the same project, each AI works in isolation. They don't know what the other AIs are building. This leads to:

- Two people's AIs building the same utility function independently
- Someone's AI creating a file in a directory another person is actively working in
- Merge conflicts that could have been prevented
- Wasted time rebuilding things a teammate already built

## How It Works

Swarmcode is a stateless MCP server. Your AI client (Claude Code, Cursor, etc.) spawns it as a subprocess. It reads directly from git and the filesystem on demand — no background processes, no config files, no manifests.

```
Your AI client                         Swarmcode MCP Server
+------------------+                   +------------------+
| Claude Code /    |  ---- stdio ----> | Reads git log    |
| Cursor / etc.    |                   | Reads branches   |
|                  |  <--- JSON -----  | Reads source     |
| "Should I create |                   | Returns answer   |
|  auth/login.ts?" |                   +------------------+
+------------------+
```

**The key insight:** AI agents commit frequently. Git already knows who's working on what, which files are changing on which branches, and what functions exist. Swarmcode just makes that information available to your AI at the right time.

## Quick Start

### 1. Install

```bash
npm install -g swarmcode
```

### 2. Add to your AI client's MCP config

**Claude Code** (`~/.claude/settings.json` or project `.mcp.json`):
```json
{
  "mcpServers": {
    "swarmcode": {
      "command": "npx",
      "args": ["swarmcode"]
    }
  }
}
```

**Cursor** (MCP settings):
```json
{
  "mcpServers": {
    "swarmcode": {
      "command": "npx",
      "args": ["swarmcode"]
    }
  }
}
```

That's it. No `init` command, no config files, no setup. The server starts when your AI session starts and stops when it ends.

### 3. Everyone else does the same

Each teammate installs swarmcode and adds it to their AI client config. As long as everyone pushes to the shared git remote, coordination happens automatically.

## The 5 Tools

Your AI calls these tools automatically based on server instructions:

| Tool | When it's called | What it does |
|------|-----------------|-------------|
| `get_team_activity` | Start of session, "who's doing what?" | Shows active contributors, their branches, and work areas |
| `check_path` | Before creating/modifying a file | Returns who owns this area, pending changes on other branches, risk assessment |
| `search_team_code` | Before implementing something | Finds existing exports (functions, classes, types) across the codebase |
| `check_conflicts` | Proactive health check | Detects files modified on multiple branches that may conflict |
| `get_developer` | Drill-down on a teammate | Shows a developer's recent commits, branches, and work areas |

All tools are **read-only**. Your work is shared when you commit and push as you normally would.

## CLI

```bash
# Start MCP server (used by AI clients, not typically run manually)
swarmcode

# Check team activity from the terminal
swarmcode status
swarmcode status --since 7d
```

## What Your AI Sees

When your AI is about to create `src/auth/login.ts`, it calls `check_path` and gets back:

```json
{
  "path": "src/auth/login.ts",
  "primary_author": "Sarah",
  "total_commits": 12,
  "risk": "high",
  "reason": "File is actively owned by Sarah with recent changes on branch feat/auth"
}
```

Your AI now knows to import from Sarah's work instead of rebuilding it.

## Requirements

- **Node.js 18+**
- **A shared git repository** with a remote that all team members can push to
- **An MCP-compatible AI client** (Claude Code, Cursor, VS Code with MCP support)

## How It Differs from v1

The previous version used a background agent that watched files, wrote JSON manifests, synced them via git every 30 seconds, and injected markdown into CLAUDE.md/.cursorrules. That's all gone. The v2 architecture:

- **No background processes** — purely reactive to AI tool calls
- **No manifest files** — no `.swarmcode/` directory
- **No config files** — no `swarmcode init` needed
- **No file injection** — MCP replaces CLAUDE.md/.cursorrules injection
- **No LLM integration** — git metadata and source analysis are sufficient

See [docs/design-decisions.md](docs/design-decisions.md) for the reasoning behind these changes.

## Limitations

- **Only sees committed + pushed work.** If a teammate hasn't pushed yet, their changes aren't visible. AI agents commit frequently, so this gap is usually small.
- **Export search covers JS/TS/Python.** Other languages return no results from `search_team_code`.
- **Remote branches required.** Conflict detection and path checking analyze remote branches — local-only branches from teammates aren't visible.

## Documentation

- [Architecture](docs/architecture.md) — module map, tool details, how git parsing works
- [Design Decisions](docs/design-decisions.md) — why stateless, why MCP, why no config
- [Development Guide](docs/development.md) — setup, testing, adding new tools

## License

MIT
