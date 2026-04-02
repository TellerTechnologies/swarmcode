# Swarmcode

**Make your AI coding assistants aware of each other.**

Swarmcode is an MCP server that coordinates AI coding assistants across a team using git and Linear. When one developer's AI is about to create a file, implement a function, or work in a directory — it checks what teammates have already built, checks what's assigned in Linear, and avoids duplication.

## The Problem

When multiple developers use AI coding assistants on the same project, each AI works in isolation:

- Two AIs build the same utility function independently
- Someone's AI creates files in a directory another person is working in
- Merge conflicts that could have been prevented
- No one knows what's assigned, in progress, or done

## How It Works

Swarmcode reads from git and the filesystem on demand — no background processes, no manifests. It also integrates with Linear for project management, so AI agents can claim tickets, log progress, and mark work done autonomously.

```
AI Client (Claude Code / Cursor)
        │
        ├── Git coordination ──→ check_path, check_conflicts, search_team_code
        │                        "Is someone already working here?"
        │
        └── Linear management ──→ linear_start_issue, linear_comment, linear_complete_issue
                                  "Claim ENG-42, log progress, mark done"
```

## Quick Start

### 1. Install

```bash
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode
npm install
npm link
```

### 2. Initialize your project

```bash
cd /path/to/your-project
swarmcode init          # adds coordination rules to CLAUDE.md + MCP config
swarmcode hook          # adds pre-push fetch hook
```

For other AI tools:

```bash
swarmcode init --tool cursor    # writes to .cursorrules
swarmcode init --tool copilot   # writes to .github/copilot-instructions.md
```

Commit the generated files so all teammates get the rules.

### 3. Connect Linear (optional but recommended)

Get a Personal API key from [Linear Settings → API](https://linear.app/settings/api) and add to your shell profile:

```bash
export SWARMCODE_LINEAR_API_KEY=lin_api_xxxxx
export SWARMCODE_LINEAR_TEAM=ENG              # optional — filter by team key
```

With Linear connected, your AI agents can autonomously claim tickets, update status, create issues, and log progress.

### 4. Everyone else does the same

Each teammate: install swarmcode, add the MCP config, set their Linear API key. The `swarmcode init` step only needs to happen once per project.

## Tools

### Git Coordination

| Tool | When | What |
|------|------|------|
| `check_all` | Session start | Team activity + project context + conflict check in one call |
| `check_path` | Before creating/modifying files | Who owns this area? Any pending changes? Risk level? |
| `search_team_code` | Before implementing something | Does this function already exist on any branch? |
| `check_conflicts` | Proactive health check | Files modified on multiple branches that may conflict |
| `get_team_activity` | Session start | Active contributors, branches, work areas |
| `get_developer` | Drill-down | One teammate's commits, branches, files |
| `get_project_context` | Session start | Reads PLAN.md, specs, README, CLAUDE.md |
| `enable_auto_push` | Session start | Pushes new commits to remote automatically |

### Linear Project Management

Available when `SWARMCODE_LINEAR_API_KEY` is set:

| Tool | When | What |
|------|------|------|
| `linear_get_issues` | Session start | Active issues (In Progress + Todo) with assignees |
| `linear_search_issues` | Before creating a ticket | Check if an issue already exists |
| `linear_get_issue` | Before starting work | Full details, comments, sub-issues |
| `linear_start_issue` | Claiming work | Assigns to you + moves to In Progress |
| `linear_complete_issue` | Work is done | Moves to Done |
| `linear_update_issue` | Editing a ticket | Change title, description, priority, assignee |
| `linear_update_status` | Status changes | Move to any workflow state |
| `linear_create_issue` | Found a bug/task | Create a new ticket |
| `linear_create_sub_issue` | Breaking down work | Create a child issue under a parent |
| `linear_comment` | Logging progress | Add a markdown comment to an issue |
| `linear_get_teams` | Resolving IDs | List teams in the workspace |
| `linear_get_users` | Resolving IDs | List users in the workspace |
| `linear_get_workflow_states` | Resolving IDs | List statuses for a team |
| `linear_get_cycles` | Sprint context | Active cycle + recent cycles |
| `linear_get_viewer` | Identity | Who am I? |

## Agent Workflow

With both git and Linear connected, an AI agent's session looks like this:

1. **Start** → `check_all` + `linear_get_issues` — see what's happening and what's available
2. **Claim** → `linear_start_issue("ENG-42")` — take the ticket, move to In Progress
3. **Check** → `check_path`, `search_team_code` — make sure no one else is already doing this
4. **Work** → code, commit frequently — auto-push sends commits to remote within seconds
5. **Log** → `linear_comment("ENG-42", "Implemented auth middleware")` — record progress
6. **Done** → `linear_complete_issue("ENG-42")` — mark it Done

Other agents see your claimed ticket in Linear and your commits via auto-fetch, so they won't duplicate your work.

## Dashboard

```bash
swarmcode dashboard                # http://localhost:3000
swarmcode dashboard --port 8080    # custom port
```

Live web dashboard with four panels:

- **Team Activity** — developer cards with branches, recent commits, work areas
- **Conflict Radar** — files on multiple branches with severity badges
- **Branch Timeline** — 48-hour commit timeline per branch with hover details
- **Linear** — active issues grouped by status (shown when API key is set)
- **Project Context** — rendered markdown from PLAN.md, specs, README

Auto-updates every 30 seconds via SSE.

## CLI

```bash
swarmcode                          # start MCP server (used by AI clients)
swarmcode init                     # add coordination rules to CLAUDE.md
swarmcode init --tool cursor       # write to .cursorrules instead
swarmcode init --tool copilot      # write to .github/copilot-instructions.md
swarmcode hook                     # install pre-push fetch hook
swarmcode status                   # check team activity from terminal
swarmcode status --since 7d        # look back further
swarmcode dashboard                # launch web dashboard
```

## Requirements

- **Node.js 18+**
- **A shared git repository** with a remote all team members can push to
- **An MCP-compatible AI client** (Claude Code, Cursor, VS Code with MCP support)
- **Linear API key** (optional) for project management integration

## Language Support

`search_team_code` detects exports in: TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Java, Kotlin, C#, Swift, C/C++, Elixir, and Scala. Regex-based — covers common patterns reliably.

## Documentation

- [Architecture](docs/architecture.md) — module map, tool details, how git parsing works
- [Design Decisions](docs/design-decisions.md) — why stateless, why MCP, why no config
- [Development Guide](docs/development.md) — setup, testing, adding new tools

## License

MIT
