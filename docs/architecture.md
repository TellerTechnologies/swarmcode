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

The MCP server starts, registers 9 tools, and waits for tool calls over stdin/stdout. It has no timers, no watchers, no threads. When the AI session ends, the process dies. There is nothing to clean up.

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
├── server.ts           MCP server setup. Registers 9 tools with zod schemas.
│                       Entry point: createServer() → startServer()
│
├── git.ts              All git commands go through here. Wraps execFileSync.
│                       17 exported functions. No shell injection (execFileSync, not execSync).
│                       Key detail: getLog() uses a sentinel string to parse --name-only
│                       output reliably (git puts blank lines both within and between commits).
│
├── source-parser.ts    Regex-based export search. 14 languages supported
│                       (JS/TS/Python/Go/Rust/Ruby/PHP/Java/Kotlin/C#/Swift/C++/Elixir/Scala).
│
├── tools/
│   ├── get-team-activity.ts   git log → group by author → work areas, branches
│   ├── check-path.ts          git log + branch diffs → ownership + risk assessment
│   ├── search-team-code.ts    source-parser + git metadata → export search with branch-aware context
│   ├── check-conflicts.ts     branch diffs → overlapping file changes
│   ├── check-all.ts           combines team activity + project context + conflicts
│   ├── get-developer.ts       git log --author → developer profile with fuzzy match
│   ├── auto-push.ts           setInterval + git push → auto-push new commits
│   └── get-project-context.ts  reads docs/, specs/, READMEs → project context
│
├── dashboard/
│   ├── server.ts       HTTP server for live web dashboard. Serves HTML, JSON API, and SSE.
│   └── index.html      Single-page dashboard frontend. Dark theme, 4 panels, no build step.
│
├── types.ts            All type definitions (GitCommit, AuthorActivity, etc.)
├── index.ts            Public exports (VERSION + types)
└── cli.ts              Commander CLI. Default action starts MCP server.
                        `swarmcode status` for terminal use, `swarmcode hook` to install pre-push hook,
                        `swarmcode dashboard` to launch the web dashboard.
```

## The tools

| Tool | When the AI calls it | Core git operations |
|------|---------------------|---------------------|
| `check_all` | Start of session (single call) | Combines `get_team_activity` + `get_project_context` + `check_conflicts` |
| `get_project_context` | Start of session, "what's the plan?" | `readdirSync` + `readFileSync` on doc dirs |
| `get_team_activity` | Start of session, "who's doing what?" | `git log --all --since=X`, `git branch -r` |
| `check_path` | Before creating/modifying a file | `git log --all -- <path>`, `git diff` per branch |
| `search_team_code` | Before implementing something | local source files + `git show branch:path` for remote branches |
| `check_conflicts` | Proactive health check | `git merge-base` + `git diff` per active branch |
| `get_developer` | Drill-down on a teammate | `git log --all --author=X` |
| `enable_auto_push` | Start of session | `git rev-parse HEAD` (poll), `git push` |
| `disable_auto_push` | End of session (optional) | Clears interval |

All tools are read-only. The AI's work is shared when it commits normally.

## Auto-fetch

Tools that read remote state (`get_team_activity`, `check_path`, `check_conflicts`, `search_team_code`) automatically run `git fetch --all --prune` before querying. This is throttled to at most once per 30 seconds so repeated tool calls don't hammer the remote. If the fetch fails (no network, no remote), the tool continues with stale data.

The auto-fetch mechanism lives in `git.ts` as `ensureFresh()`. It tracks a `lastFetchTimestamp` module-level variable and only fetches when the timestamp is older than the staleness threshold (default 30s). The fetch has a 15-second timeout to prevent slow remotes from blocking tool calls.

## Dashboard

`swarmcode dashboard` launches a web dashboard at `http://localhost:3000`. It reuses the same data sources as the MCP tools:

| Panel | Data source |
|-------|------------|
| Team Activity | `getTeamActivity()` — same as `get_team_activity` MCP tool |
| Conflict Radar | `checkConflicts()` — same as `check_conflicts` MCP tool |
| Branch Timeline | `getBranchLog()` + `getBranchAheadBehind()` from `git.ts` |
| Project Context | `getProjectContext()` — same as `get_project_context` MCP tool |

The server uses Node's built-in `http` module (no Express). Live updates are pushed via Server-Sent Events every 30 seconds, riding the same `ensureFresh()` throttle. The frontend is a single HTML file with inlined CSS and JS — no build step, no external dependencies.

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

- **Minimal background activity** — auto-push polls for new commits; auto-fetch is throttled on-demand (not a background process)
- **No manifest files** — no `.swarmcode/` directory
- **No config files** — `swarmcode init` appends to your AI context file but creates no swarmcode-specific config
- **No LLM integration** — git metadata, source analysis, and doc scanning are sufficient
- **No caching** — every tool call queries git/filesystem fresh (~50-200ms, fast enough). Auto-fetch is throttled but that's rate-limiting, not caching.
- **Two write operations** — auto-push runs `git push`; auto-fetch runs `git fetch`. All other tools are read-only.

## Limitations

- **Only sees committed + pushed work.** If a teammate is coding but hasn't pushed, you won't see their changes. AI agents commit frequently, so this gap is usually small.
- **Remote branches required for conflict detection.** `check_conflicts` and `check_path` analyze remote branches. Local-only branches from teammates aren't visible (they need to push).
- **Export search uses regex, not AST.** Covers 14 languages but only common declaration patterns. Unusual or dynamic exports won't be detected.
- **Large repos may be slower.** `git log --all` on repos with thousands of commits could take >200ms. Not a problem in practice since tool calls are infrequent.
