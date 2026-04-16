<p align="center">
  <img src="https://img.shields.io/badge/MCP_Server-swarmcode-blueviolet?style=for-the-badge" alt="MCP Server" />
  <img src="https://img.shields.io/badge/version-3.1.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge" alt="AGPL-3.0 License" />
  <img src="https://img.shields.io/badge/node-18+-brightgreen?style=for-the-badge" alt="Node 18+" />
</p>

<h1 align="center">
  <br>
  <code>swarmcode</code>
  <br>
</h1>

<p align="center">
  <strong>Shared context for humans and AI agents working in the same repo.</strong>
  <br>
  Linear tickets, git branches, live conflict detection, and a team dashboard, all over MCP.
</p>

---

## What it is

Swarmcode is an MCP server that gives AI coding agents (and their humans) a shared picture of the work. It pulls Linear tickets, branches, commits, and team activity into one coordination surface, and prevents agents from claiming the same ticket, editing the same file blindly, or rebuilding what a teammate just finished.

Works for a solo dev with one agent, a team of developers, a swarm of agents, or any mix.

## Quick start

```bash
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode && npm install && npm link
```

In any project:

```bash
cd /path/to/your-project
swarmcode init          # adds CLAUDE.md + .mcp.json
swarmcode hook          # installs git hooks that sync commits to Linear
```

Connect Linear (strongly recommended, powers most features):

```bash
export SWARMCODE_LINEAR_API_KEY=lin_api_xxxxx
export SWARMCODE_LINEAR_TEAM=ENG              # optional
```

### Cursor

```bash
swarmcode init --tool cursor
```

This creates two files:

- `.cursorrules` with the same coordination rules (call `check_path` before editing, call `search_code` before implementing, etc.)
- `.cursor/mcp.json` with the swarmcode MCP server configured over stdio

Cursor picks up both automatically. The 35 MCP tools will appear in Cursor's tool list, and the git hooks work regardless of which editor you use.

### GitHub Copilot

```bash
swarmcode init --tool copilot    # .github/copilot-instructions.md
```

## Features

### Ticket-aware branches

`pick_issue` claims a Linear ticket under an optimistic lock (two agents cannot claim the same one), assigns it to you, moves it to In Progress, and returns a branch name like `feat/eng-123-auth-flow`. Agents check out that branch and start working.

### Git hooks that keep Linear in sync

Four hooks installed by `swarmcode hook`:

| Hook | Effect |
|------|--------|
| `prepare-commit-msg` | Prepends the issue ID from the branch name to every commit |
| `commit-msg` | Warns if a commit has no issue ID |
| `post-commit` | First commit on a branch moves the Linear issue to In Progress |
| `pre-push` | Fetches remotes before push to avoid surprise conflicts |

Commits become traceable to tickets automatically. No one has to remember.

### Pre-write conflict detection

`check_path` runs `git merge-tree` against every active branch in the repo and tells the agent *before* it writes whether the file it is about to edit will merge cleanly. Conflicts surface seconds after a teammate pushes, not at PR time.

### Cross-branch code search

`search_code` parses exports from every branch in 14 languages (JS/TS, Python, Go, Rust, Ruby, PHP, Java, Kotlin, C#, Swift, C++, Elixir, Scala) and answers: *does this function already exist somewhere?* Agents stop rebuilding what a teammate already wrote.

### Auto-push

Once enabled, swarmcode pushes new commits to the remote every few seconds. Teammates and the dashboard see work live, not on PR.

### Live team dashboard

```bash
swarmcode dashboard                 # http://localhost:3000
```

Five panels, auto-refreshing every 30 seconds:

- **Team Activity**: developer cards with branches, commits, work areas
- **Conflict Radar**: files modified on multiple branches, ranked by severity
- **Branch Timeline**: 48-hour commit timeline per branch
- **Linear**: active issues grouped by status
- **Project Context**: rendered markdown from `docs/`, `PLAN.md`, `README.md`, `CLAUDE.md` with syntax highlighting

### Multi-agent test harness

Run N agents concurrently against a scenario and grade how well they coordinate:

```bash
swarmcode test list
swarmcode test run --scenario test/scenarios/overlapping-files.yaml
swarmcode test report <run-id>
```

Each run produces a scorecard (A = clean, D = conflicts or duplicate claims). The harness uses `git merge -X patience` to auto-resolve recoverable conflicts.

### Full Linear control

Swarmcode is a superset of the official Linear MCP. Agents can create and update tickets, manage sub-issues, link relations (`blocks`, `duplicate`, `relates-to`), check off description checkboxes, manage labels, and update project status, all from inside a coding session.

## Tools

**Git and coordination (9)**
`start_session` · `check_path` · `search_code` · `check_conflicts` · `get_developer` · `get_project_context` · `get_team_activity` · `enable_auto_push` · `disable_auto_push`

**Linear issues (13)**
`linear_get_issues` · `pick_issue` · `complete_issue` · `log_progress` · `search_issues` · `get_issue` · `create_issue` · `create_sub_issue` · `update_issue` · `archive_issue` · `check_item` · `create_issue_relation` · `get_issue_relations`

**Linear projects (5)**
`project_status` · `get_project_issues` · `update_project_status` · `update_project` · `add_issue_to_project`

**Linear labels, states, workspace (8)**
`get_labels` · `add_label` · `remove_label` · `get_workflow_states` · `get_teams` · `get_users` · `get_viewer` (+ `update_project` shared above)

See `docs/architecture.md` for how each one maps to git and Linear operations.

## CLI

```bash
swarmcode                          # start MCP server (stdio)
swarmcode init [--tool ...]        # add coordination rules and MCP config
swarmcode hook                     # install git hooks
swarmcode status                   # team activity in the terminal
swarmcode dashboard [--port N]     # launch web dashboard
swarmcode test list                # list test scenarios
swarmcode test run --scenario ...  # run a multi-agent test
swarmcode test report <id>         # reprint a past scorecard
swarmcode test cleanup             # remove orphaned worktrees and test issues
```

## Architecture

Stateless MCP server. No daemons, no manifests, no caches. Every tool call reads git and the Linear API on demand, which means the data is always current and there is nothing to invalidate.

```
swarmcode/
├── bin/swarmcode.ts          CLI entry
├── src/
│   ├── server.ts             MCP server, registers 35 tools
│   ├── git.ts                All git commands (execFileSync, no shell injection)
│   ├── linear.ts             Typed Linear client built on @linear/sdk
│   ├── source-parser.ts      Cross-branch export search, 14 languages
│   ├── tools/                One file per git-side tool
│   ├── dashboard/            HTTP server + single-page dashboard
│   └── test/                 Multi-agent test harness
└── docs/                     Architecture, design decisions, dev guide
```

## Requirements

- Node.js 18+
- A shared git repository with a remote
- An MCP-compatible AI client (Claude Code, Cursor, VS Code, or any MCP client)
- A Linear account and API key (strongly recommended)

## License

AGPL-3.0 — same license Linear uses. See [LICENSE](LICENSE) for the full text.

---

<p align="center">
  Built by <a href="https://github.com/TellerTechnologies">TellerTechnologies</a>
</p>
