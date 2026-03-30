# Swarmcode MCP Server Design

## Overview

Replace swarmcode's file-injection architecture with a stateless MCP server that coordinates AI coding assistants using git history and source analysis. No watchers, no manifests, no sync loops, no background processes. Every tool call reads directly from git and the filesystem on demand.

## Motivation

The current architecture was designed around file injection: a continuously running agent watches files, extracts metadata, writes JSON manifests, syncs them via git, and injects formatted markdown into AI context files (CLAUDE.md, .cursorrules). This approach has fundamental problems:

- **Stale data** — the AI sees a 30-second-old snapshot, not current state
- **Parallel state** — JSON manifests duplicate information already in git
- **Operational overhead** — requires a background agent process, init step, config files, and a `.swarmcode/` directory
- **Fragile output** — marker-based file injection conflicts with manual edits and varies across AI tools

With MCP as the interface, none of this is needed. The git repo is already the shared state. AI agents commit frequently. The MCP server can query git and source files on demand and return fresh, targeted answers.

## Architecture

```
Claude Code spawns: swarmcode (MCP server, stdio)
┌────────────────────────────────────────────┐
│  No background processes. No state.        │
│  Pure on-demand analysis of:               │
│    - git log / branches / diffs            │
│    - source files (exports, functions)     │
│    - local working tree                    │
│                                            │
│  Tools:                                    │
│    get_team_activity  → git log analysis   │
│    check_path         → ownership + risk   │
│    search_team_code   → exports + context  │
│    check_conflicts    → branch divergence  │
│    get_developer      → one person's work  │
└────────────────────────────────────────────┘
```

The MCP server is a single stdio process spawned by the AI client. It has no background threads, no timers, no file watchers, no state files. Each tool call runs git commands and/or reads source files, computes an answer, and returns it.

Communication between team members happens through normal git operations (commit, push, pull). No separate sync mechanism.

## Project Structure

```
src/
├── server.ts              # MCP server setup, stdio transport, tool registration
├── tools/
│   ├── get-team-activity.ts
│   ├── check-path.ts
│   ├── search-team-code.ts
│   ├── check-conflicts.ts
│   └── get-developer.ts
├── git.ts                 # Thin wrapper: runs git commands, parses output
├── source-parser.ts       # Extracts exports/imports from source files
└── cli.ts                 # Simplified: just `swarmcode` (MCP) and `swarmcode status`
```

### Deleted

All of the following are removed entirely:

- `src/agent.ts` — no background agent
- `src/watcher.ts` — no file watching
- `src/manifest/` (reader + writer) — no JSON manifests
- `src/injector/` (injector + formatter) — no context file injection
- `src/sync/git-sync.ts` — no git sync loop
- `src/extractor/rich.ts` — no LLM-based extraction
- `src/llm/` (all providers) — no LLM integration
- `src/plan/parser.ts` — no PLAN.md parsing
- `src/config.ts` — no config files needed
- `src/types.ts` — rewritten for new model

### Dependency Changes

**Added:** `@modelcontextprotocol/sdk`

**Removed:** `chokidar`, `yaml`, `@anthropic-ai/sdk`, `openai`

## MCP Server Setup

```typescript
new McpServer({
  name: "swarmcode",
  instructions: `You have access to team coordination tools. Use them:
    - Before creating files in a new directory → call check_path
    - Before implementing a function that might already exist → call search_team_code
    - At the start of complex tasks → call get_team_activity
    - When something conflicts or breaks unexpectedly → call check_conflicts
    Do not rebuild what a teammate has already built. Import from their work instead.`
});
```

The `instructions` field replaces the injected CLAUDE.md block. It is delivered to the AI client via the MCP protocol when the server connects.

Transport: stdio (standard for Claude Code MCP servers).

## Tool Designs

### get_team_activity

**Purpose:** Overview of recent work across all contributors. "What's the team doing?"

**Input:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `since` | string | `"24h"` | How far back to look (git date format) |

**Git commands:**
```
git log --all --since=<since> --format="%H|%an|%ae|%at|%s" --name-only --no-merges
git branch -r --sort=-committerdate
```

**Processing:**
1. Parse log output, group commits by author
2. For each author: collect active branches, touched files/directories, most recent timestamp
3. Infer primary work area from most common directory prefix
4. Exclude the local user (matched via `git config user.name`)

**Returns:** Array of team members, each with:
- `name` — git author name
- `active_branches` — branches with their commits in the window
- `work_areas` — directories they've been working in (by frequency)
- `recent_files` — files they've modified
- `last_active` — most recent commit timestamp
- `recent_commits` — last few commit messages for context

---

### check_path

**Purpose:** Safety check before touching a path. "Who owns this area, and is it risky?"

**Input:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | File or directory path to check |

**Git commands:**
```
git log --all --since=7d --format="%an|%at|%s" -- <path>
git status -- <path>
```
For each recently active remote branch:
```
git diff --name-only <merge-base>..<remote-branch> -- <path>
```
(Where merge-base is computed via `git merge-base <current-branch> <remote-branch>`, so we see only changes introduced on the remote branch, not the full symmetric difference.)

**Processing:**
1. Parse log to find who has modified this path recently and how often
2. Check each active remote branch for changes introduced to this path since divergence
3. Check local working tree for uncommitted changes
4. Compute risk level based on overlap

**Returns:**
- `recent_authors` — who modified this path, with frequency and recency
- `primary_owner` — most active recent author
- `pending_changes` — branches with uncommitted changes to this path (with branch name and author)
- `locally_modified` — whether the path has local uncommitted changes
- `risk` — `"safe"`, `"caution"`, or `"conflict_likely"` with explanation

---

### search_team_code

**Purpose:** Anti-duplication search. "Does this already exist? Should I import instead of build?"

**Input:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Function, type, or component name to search for |
| `path` | string | no | Narrow search to a directory |

**Implementation:**
1. Grep the codebase for export patterns matching `query` — reuse regex logic from the current FastExtractor but in search mode. Patterns to match:
   - `export function <query>`, `export class <query>`, `export const <query>`, etc.
   - `export default function <query>`, `export default class <query>`
   - `module.exports` patterns containing `query`
   - Python: top-level `def <query>`, `class <query>`
2. For each match, annotate with git metadata:
   ```
   git log -1 --format="%an|%at" -- <file>
   ```
3. Check if the file has changes on other active branches

**Returns:** Array of matches, each with:
- `file` — file path
- `name` — export name
- `signature` — full signature (e.g., `export function login(user: string): Promise<Token>`)
- `last_modified_by` — git author who last changed this file
- `last_modified_at` — when
- `in_flux` — whether the file is being changed on another active branch

---

### check_conflicts

**Purpose:** Proactive health check. "Are there any brewing merge conflicts?"

**Input:** none

**Git commands:**
```
git branch -r --sort=-committerdate
```
For each recently active remote branch (committed within last 48h):
```
git merge-base <current-branch> <remote-branch>
git diff --name-only <merge-base>..<remote-branch>
```
Also: `git diff --name-only` for local uncommitted changes.

**Processing:**
1. Collect files changed on each active remote branch
2. Find files that appear in multiple branches' change sets
3. Cross-reference with local uncommitted changes
4. Classify severity

**Returns:**
- `conflicts` — array of potential conflicts, each with:
  - `file` — the contested file path
  - `branches` — which branches modify it (with author names)
  - `local` — whether local uncommitted changes also touch it
  - `severity` — `"low"` (same directory, different files), `"high"` (same file on multiple branches)
- `summary` — plain-language overview ("2 files at risk of conflict between your branch and feat/auth")

---

### get_developer

**Purpose:** Drill-down on one teammate. "What has Sarah been working on?"

**Input:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Developer name (fuzzy matched against git authors) |

**Git commands:**
```
git log --all --author=<name> --since=7d --format="%H|%at|%s" --name-only
git branch -r --contains <their-recent-commits>
```

**Processing:**
1. Fuzzy match `name` against known git authors (`git log --all --format="%an" | sort -u`)
2. Collect their commits, group by branch
3. Compute top directories by commit frequency

**Returns:**
- `name` — resolved author name
- `recent_commits` — commits with messages, timestamps, and files changed
- `active_branches` — branches they're working on
- `work_areas` — top directories by activity
- `files` — all files they've touched in the window

## git.ts — Git Query Layer

A thin wrapper around `child_process.execSync` (or `execFileSync` for safety). Responsible for:

- Running git commands and returning parsed output
- Detecting the repo root (`git rev-parse --show-toplevel`)
- Getting the current user (`git config user.name`)
- Getting the current branch (`git rev-parse --abbrev-ref HEAD`)
- Listing active remote branches
- Handling errors gracefully (no remote, empty repo, not a git repo)

All git commands use `execFileSync` (not `execSync`) to avoid shell injection from user-provided paths/names.

## source-parser.ts — Export Search

Carries over the regex logic from the current `FastExtractor` but adapted for search:

- Given a query string, constructs regex patterns to find matching exports
- Supports TypeScript/JavaScript and Python
- Returns matches with full signatures
- Language detection by file extension

This is not a full AST parser — regex-based extraction is fast and good enough for function/class/type/const declarations. The current FastExtractor tests validate this approach.

## CLI Changes

**`swarmcode`** (no subcommand, or `swarmcode mcp`) — starts the MCP server on stdio. This is what the AI client spawns.

**`swarmcode status`** — prints team activity to the terminal (calls the same logic as `get_team_activity` but formats for human display). Useful for quick terminal checks outside of an AI session.

**Removed:** `swarmcode init`, `swarmcode start`

## User Setup

Add to your AI client's MCP configuration:

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

That's it. No init, no config files, no `.swarmcode/` directory.

## Testing Strategy

### Unit tests: git.ts

Mock `child_process.execFileSync`. Verify:
- Git commands are constructed correctly from inputs
- Output parsing handles edge cases: empty repos, no remote, single contributor, malformed output, detached HEAD

### Unit tests: tool handlers

Mock `git.ts` functions, feed canned git output. Verify:
- `get_team_activity` groups commits by author, infers work areas, excludes local user
- `check_path` classifies risk levels correctly across scenarios
- `search_team_code` matches export patterns, annotates with git blame
- `check_conflicts` detects overlapping changes, classifies severity
- `get_developer` fuzzy-matches author names, summarizes work

### Unit tests: source-parser.ts

Carry over existing FastExtractor tests adapted for the search interface. Verify export pattern matching for TypeScript, JavaScript, and Python.

### Integration tests

Spin up a temporary git repo with:
- Multiple authors (configured via `git -c user.name`)
- Multiple branches with overlapping changes
- Source files with various export patterns

Start the MCP server, call tools via the MCP client SDK, verify end-to-end responses against known repo state. Real git commands against real repos — no mocking git in integration tests.

## What This Design Does Not Include

- **Write operations** — all tools are read-only. The AI's work is shared when it commits to git normally.
- **LLM enrichment** — no AI-generated summaries or intent detection. Git commit messages and source code provide the context.
- **In-progress visibility** — only committed and pushed work is visible to teammates. This is an intentional trade-off: simpler architecture, authoritative data, and AI agents commit frequently enough that the gap is small.
- **Caching** — every tool call queries git fresh. Git commands are fast enough (~50-200ms) that caching is unnecessary and would reintroduce staleness.
