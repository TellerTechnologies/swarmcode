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
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode
npm install
npm link
```

### 2. Initialize (once per project)

In your project directory:

```bash
swarmcode init
```

This appends team coordination rules to your `CLAUDE.md`. Your AI will know to check what teammates are building before creating files or implementing functions.

For other AI tools:

```bash
swarmcode init --tool cursor    # writes to .cursorrules
swarmcode init --tool copilot   # writes to .github/copilot-instructions.md
```

The init command only needs to run once — commit the context file so all teammates get the rules.

### 3. Add to your AI client's MCP config

**Claude Code** (`~/.claude/settings.json` or project `.mcp.json`):
```json
{
  "mcpServers": {
    "swarmcode": {
      "command": "swarmcode"
    }
  }
}
```

**Cursor** (MCP settings):
```json
{
  "mcpServers": {
    "swarmcode": {
      "command": "swarmcode"
    }
  }
}
```

### 4. Everyone else does the same

Each teammate: install swarmcode, add the MCP config. The `swarmcode init` step only needs to happen once per project — the context file is committed to git so everyone gets it.

## Tools

Your AI calls these automatically based on server instructions and context file rules:

| Tool | When it's called | What it does |
|------|-----------------|-------------|
| `get_team_activity` | Start of session | Shows active contributors, their branches, and work areas |
| `check_path` | Before creating/modifying a file | Returns who owns this area, pending changes, risk assessment |
| `search_team_code` | Before implementing something | Finds existing exports (functions, classes, types) across the codebase |
| `check_conflicts` | Proactive health check | Detects files modified on multiple branches that may conflict |
| `get_developer` | Drill-down on a teammate | Shows a developer's recent commits, branches, and work areas |
| `enable_auto_push` | Start of session | Automatically pushes new commits so teammates see your work immediately |
| `disable_auto_push` | End of session (optional) | Stops auto-push and reports how many pushes were made |

All read tools are **read-only**. Auto-push is the only write operation — it runs `git push`, never `git commit` or `git push --force`.

## Auto-Push

The biggest limitation of git-based coordination is the gap between committing and pushing. If your AI commits locally but doesn't push, teammates can't see your work.

Auto-push closes this gap. When enabled, swarmcode watches for new local commits and pushes them to the remote within seconds. Your AI calls `enable_auto_push` at the start of every session (the CLAUDE.md rules tell it to).

**What it does:**
- Polls for new commits every 5 seconds (configurable)
- Pushes to the current branch's remote tracking branch
- Creates the remote tracking branch automatically for new local branches
- Skips protected branches (main, master, develop)

**What it doesn't do:**
- Never creates commits — only pushes existing ones
- Never force-pushes
- Never pulls or rebases
- Never touches other branches

## CLI

```bash
# Start MCP server (used by AI clients, not typically run manually)
swarmcode

# Add coordination rules to your AI context file
swarmcode init
swarmcode init --tool cursor
swarmcode init --tool copilot

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
- **No config files** — no `.swarmcode/` directory or `config.yaml`
- **No file injection** — MCP replaces CLAUDE.md/.cursorrules injection
- **No LLM integration** — git metadata and source analysis are sufficient
- **`swarmcode init` is back** — but instead of creating config directories, it just appends one markdown section to your AI context file

See [docs/design-decisions.md](docs/design-decisions.md) for the reasoning behind these changes.

## Language Support

The `search_team_code` tool detects exports and definitions in these languages:

| Language | Extensions | What it finds |
|----------|-----------|--------------|
| TypeScript | `.ts`, `.tsx` | `export function`, `export class`, `export interface`, `export type`, `export const` |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | Same as TypeScript |
| Python | `.py` | Top-level `def`, `class` |
| Go | `.go` | `func`, `type ... struct/interface` |
| Rust | `.rs` | `pub fn`, `pub struct`, `pub enum`, `pub trait` |
| Ruby | `.rb` | Top-level `def`, `class`, `module` |
| PHP | `.php` | `function`, `class`, `interface`, `trait` |
| Java | `.java` | `class`, `interface`, `enum`, `public` methods |
| Kotlin | `.kt`, `.kts` | `fun`, `class`, `object`, `interface` |
| C# | `.cs` | `public class/interface/struct/enum`, `public` methods |
| Swift | `.swift` | `func`, `class`, `struct`, `protocol`, `enum` |
| C/C++ | `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cxx` | `struct`, `class`, top-level functions |
| Elixir | `.ex`, `.exs` | `defmodule`, `def` |
| Scala | `.scala`, `.sc` | `def`, `class`, `object`, `trait` |

All matching is regex-based (no AST parsing). It covers common declaration patterns reliably but won't catch unusual or dynamic exports.

## Limitations

- **Only sees committed + pushed work.** If a teammate hasn't pushed yet, their changes aren't visible. Auto-push closes this gap when enabled.
- **Remote branches required.** Conflict detection and path checking analyze remote branches — local-only branches from teammates aren't visible.

## Documentation

- [Architecture](docs/architecture.md) — module map, tool details, how git parsing works
- [Design Decisions](docs/design-decisions.md) — why stateless, why MCP, why no config
- [Development Guide](docs/development.md) — setup, testing, adding new tools

## License

MIT
