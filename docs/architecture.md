# Swarmcode Architecture

## What it is

A stateless MCP server that coordinates AI coding assistants across a team using git history and source analysis. No background processes, no state files, no manifests. Every tool call reads directly from git and the filesystem on demand.

## How it runs

The AI client (Claude Code, Cursor, etc.) spawns swarmcode as a subprocess via stdio:

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

The MCP server starts, registers 5 tools, and waits for tool calls over stdin/stdout. It has no timers, no watchers, no threads. When the AI session ends, the process dies. There is nothing to clean up.

## Key design decision: git IS the shared state

Previous versions maintained JSON manifest files per developer, synced via a custom git loop. That's gone. The git repository itself is the coordination layer:

- `git log --all` tells you who's active and what they're working on
- `git diff` between branches reveals potential conflicts
- `git log --author` gives you a developer's full history
- Source files on disk contain the actual exports

This works because AI agents commit frequently. The window of "invisible uncommitted work" is small, and the data from git is always authoritative (no stale caches).

## Module map

```
src/
├── server.ts           MCP server setup. Registers 5 tools with zod schemas.
│                       Entry point: createServer() → startServer()
│
├── git.ts              All git commands go through here. Wraps execFileSync.
│                       12 exported functions. No shell injection (execFileSync, not execSync).
│                       Key detail: getLog() uses a sentinel string to parse --name-only
│                       output reliably (git puts blank lines both within and between commits).
│
├── source-parser.ts    Regex-based export search. Supports JS/TS/Python.
│                       Used by search_team_code tool to find matching exports.
│
├── tools/
│   ├── get-team-activity.ts   git log → group by author → work areas, branches
│   ├── check-path.ts          git log + branch diffs → ownership + risk assessment
│   ├── search-team-code.ts    source-parser + git metadata → export search with context
│   ├── check-conflicts.ts     branch diffs → overlapping file changes
│   └── get-developer.ts       git log --author → developer profile with fuzzy match
│
├── types.ts            All type definitions (GitCommit, AuthorActivity, etc.)
├── index.ts            Public exports (VERSION + types)
└── cli.ts              Commander CLI. Default action starts MCP server.
                        `swarmcode status` subcommand for terminal use.
```

## The 5 tools

| Tool | When the AI calls it | Core git operations |
|------|---------------------|---------------------|
| `get_team_activity` | Start of session, "who's doing what?" | `git log --all --since=X`, `git branch -r` |
| `check_path` | Before creating/modifying a file | `git log --all -- <path>`, `git diff` per branch |
| `search_team_code` | Before implementing something | grep source files + `git log -1` per file |
| `check_conflicts` | Proactive health check | `git merge-base` + `git diff` per active branch |
| `get_developer` | Drill-down on a teammate | `git log --all --author=X` |

All tools are read-only. The AI's work is shared when it commits normally.

## Server instructions

The MCP server sends `instructions` to the AI client on connect:

```
You have access to team coordination tools. Use them:
- Before creating files in a new directory → call check_path
- Before implementing a function that might already exist → call search_team_code
- At the start of complex tasks → call get_team_activity
- When something conflicts or breaks unexpectedly → call check_conflicts
Do not rebuild what a teammate has already built. Import from their work instead.
```

This replaces the old approach of injecting markdown into CLAUDE.md/.cursorrules.

## How git.ts parses log output

This was the trickiest part. `git log --name-only` produces output like:

```
<header line>
                        ← blank line (within commit, between header and files)
file1.ts
file2.ts
                        ← blank line (between commits)
<next header line>
...
```

Splitting on blank lines doesn't work because there are blank lines both within and between commits. The solution: prepend a sentinel string (`---SWARMCODE_COMMIT---`) to the format string, then split on that sentinel. This reliably separates commits regardless of blank lines.

## What's NOT here

- **No background processes** — the server is purely reactive
- **No manifest files** — no `.swarmcode/` directory
- **No config files** — no `swarmcode init` needed
- **No LLM integration** — git metadata and source analysis are sufficient
- **No caching** — every tool call queries git fresh (~50-200ms, fast enough)
- **No write operations** — all tools are read-only

## Limitations

- **Only sees committed + pushed work.** If a teammate is coding but hasn't pushed, you won't see their changes. AI agents commit frequently, so this gap is usually small.
- **Remote branches required for conflict detection.** `check_conflicts` and `check_path` analyze remote branches. Local-only branches from teammates aren't visible (they need to push).
- **Export search only covers JS/TS/Python.** The regex patterns in source-parser.ts handle common export patterns. Other languages return no results.
- **Large repos may be slower.** `git log --all` on repos with thousands of commits could take >200ms. Not a problem in practice since tool calls are infrequent.
