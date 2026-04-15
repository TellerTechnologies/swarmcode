<p align="center">
  <img src="https://img.shields.io/badge/MCP_Server-swarmcode-blueviolet?style=for-the-badge" alt="MCP Server" />
  <img src="https://img.shields.io/badge/version-3.1.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License" />
  <img src="https://img.shields.io/badge/node-18+-brightgreen?style=for-the-badge" alt="Node 18+" />
</p>

<h1 align="center">
  <br>
  <code>swarmcode</code>
  <br>
</h1>

<p align="center">
  <strong>Coordinate a swarm of AI coding agents using git.</strong>
  <br>
  One agent is a pair programmer. Three agents are a team, if they can see each other.
</p>

---

## The Problem

LLM coding agents are fast, cheap, and increasingly good. Writing code is no longer the bottleneck. The bottleneck is keeping three of them working in parallel from:

- claiming the same ticket,
- rebuilding what a teammate finished an hour ago,
- overwriting each other's changes in the same file,
- drifting out of sync with Linear so a human cannot tell what is done.

Claude Code, Cursor, and Copilot each know what *they* are doing. None of them know what the others are doing. Swarmcode is the connective tissue.

## How It Works

```
                  ┌─────────────────────────────┐
                  │   Agents work in parallel.   │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │   Each one calls swarmcode   │
                  │   tools over MCP: claim a    │
                  │   ticket, check a file,      │
                  │   search the codebase.       │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │   Swarmcode reads git and    │
                  │   Linear on demand. No       │
                  │   daemons, no caches, no     │
                  │   manifests.                 │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │   Git is the shared state.   │
                  │   Linear is the task queue.  │
                  │   Hooks link them together.  │
                  └──────────────┬──────────────┘
                                 │
                  ┌──────────────▼──────────────┐
                  │   Agents see each other.     │
                  │   Conflicts surface before   │
                  │   they happen.               │
                  └─────────────────────────────┘
```

### The Coordination Layers

```
  ┌─────────────────────────────────────────────────────┐
  │  LINEAR        ████████████████████   the brain     │
  │  Tickets, assignments, projects, status.            │
  ├─────────────────────────────────────────────────────┤
  │  GIT           ████████████████████   the hands     │
  │  Branches, commits, files, conflicts.               │
  ├─────────────────────────────────────────────────────┤
  │  HOOKS         ████████████████████   the glue      │
  │  Branch names link git events to Linear state.      │
  ├─────────────────────────────────────────────────────┤
  │  MCP           ████████████████████   the interface │
  │  Agents call tools, get coordination data.          │
  └─────────────────────────────────────────────────────┘
```

## Install

```bash
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode && npm install && npm link
```

Then in any project:

```bash
cd /path/to/your-project
swarmcode init          # adds CLAUDE.md + MCP config
swarmcode hook          # installs git hooks for Linear integration
```

### Connect Linear

```bash
export SWARMCODE_LINEAR_API_KEY=lin_api_xxxxx
export SWARMCODE_LINEAR_TEAM=ENG              # optional
```

Get your key from [Linear Settings → API](https://linear.app/settings/api). Add to `~/.bashrc` or `~/.zshrc`.

### Other AI tools

```bash
swarmcode init --tool cursor    # .cursorrules
swarmcode init --tool copilot   # .github/copilot-instructions.md
```

## A Day in the Life of an Agent

```
Agent starts session
│
├── start_session ..........> team activity, conflicts, project context, auto-push
├── linear_get_issues ......> what is available to work on?
│
├── pick_issue("ENG-123") ..> claims ticket (optimistic lock), returns branch name
│   └── git checkout -b feat/eng-123-auth-flow
│
├── Commits ................> hooks auto-prepend "ENG-123:" to messages
│   │                          post-commit hook moves ENG-123 to In Progress
│   └── auto-push sends to remote within seconds
│
├── check_path / search_code > pre-write conflict and duplication detection
│
├── log_progress("ENG-123", "Auth done, starting tests")
│
└── complete_issue("ENG-123") > marks Done in Linear
```

## Git Hooks

`swarmcode hook` installs 4 git hooks that wire git events directly into Linear:

| Hook | What it does |
|------|-------------|
| `prepare-commit-msg` | Auto-prepends issue ID from branch name to commits |
| `commit-msg` | Warns if a commit has no issue ID |
| `post-commit` | First commit on branch moves the Linear issue to In Progress |
| `pre-push` | Fetches remote branches before pushing |

Branch naming convention: `feat/eng-123-description`. Hooks parse the ID and handle the rest.

## What It Detects

| Detector | What it surfaces |
|----------|------------------|
| **`check_path`** | Pre-write merge conflict detection via `git merge-tree`, plus ownership and risk |
| **`search_code`** | Does this function already exist on any branch? (14 languages) |
| **`check_conflicts`** | Files modified on multiple branches right now |
| **`pick_issue` lock** | Optimistic lock. Rejects if another agent already claimed the ticket. |
| **`start_session`** | One call returns team activity, context, conflicts, and starts auto-push |

## Tools

### Session & Coordination

| Tool | What |
|------|------|
| `start_session` | One call: activity, context, conflicts, auto-push |
| `check_path` | Ownership, risk, and pre-write merge conflict detection |
| `search_code` | Does this function already exist on any branch? |
| `check_conflicts` | Files modified on multiple branches |
| `get_developer` | One teammate's commits, branches, files |
| `get_project_context` | Reads `PLAN.md`, specs, READMEs, `CLAUDE.md` |

### Linear: Issues

| Tool | What |
|------|------|
| `pick_issue` | Claim a ticket. Optimistic lock prevents double-claims. |
| `complete_issue` | Mark Done |
| `log_progress` | Comment on a ticket (milestones, not every commit) |
| `create_issue` | Found a bug? Create a ticket. |
| `create_sub_issue` | Break work into pieces |
| `search_issues` | Does a ticket already exist? |
| `get_issue` | Full details, comments, sub-issues |
| `update_issue` | Edit title, description, priority, assignee |

### Linear: Projects & Reference

| Tool | What |
|------|------|
| `project_status` | All projects with progress and health |
| `get_project_issues` | Issues in a project |
| `update_project_status` | Post a status update (on track, at risk, off track) |
| `update_project` | Change name, state, target date |
| `get_teams`, `get_users`, `get_viewer`, `get_labels` | ID resolution |

## Dashboard

```bash
swarmcode dashboard                # http://localhost:3000
swarmcode dashboard --port 8080
```

Live web dashboard with five panels:

- **Team Activity**: developer cards with branches, commits, work areas
- **Conflict Radar**: files on multiple branches with severity
- **Branch Timeline**: 48-hour commit timeline per branch
- **Linear**: active issues by status (when API key is set)
- **Project Context**: rendered markdown docs with syntax highlighting

Auto-updates every 30 seconds. No build step, served directly from disk.

## Multi-Agent Testing

Swarmcode ships with a test harness for validating coordination between concurrent agents. Launch N agents on overlapping work and grade how well they cooperate.

```bash
swarmcode test list                                           # scenarios available
swarmcode test run --scenario test/scenarios/overlapping-files.yaml
swarmcode test report <run-id>                                # past results
swarmcode test cleanup                                        # remove orphaned worktrees
```

### Scenario format

```yaml
name: overlapping-files
description: "3 agents modifying shared modules"
agents: 3
base_branch: master
test_command: "npm test"
timeout_minutes: 30

issues:
  - title: "Add feature A"
    agent: typescript-pro      # uses .claude/agents/typescript-pro.md
  - title: "Add feature B"
    agent: test-automator
```

### Scorecard

```
  ┌─────────────────────────────────────────────────────┐
  │  A   ████████████████████   Zero conflicts.         │
  │  Zero duplication. All tests pass.                  │
  ├─────────────────────────────────────────────────────┤
  │  B   ██████████████░░░░░░   Conflicts auto-resolved │
  │  with git merge -X patience.                        │
  ├─────────────────────────────────────────────────────┤
  │  C   ████████░░░░░░░░░░░░   Unresolvable merge      │
  │  conflicts. Human intervention required.            │
  ├─────────────────────────────────────────────────────┤
  │  D   ███░░░░░░░░░░░░░░░░░   Incomplete issues,      │
  │  duplicate claims, or test failures.                │
  └─────────────────────────────────────────────────────┘
```

## CLI Reference

```bash
swarmcode                          # start MCP server (stdio)
swarmcode init                     # add coordination rules to CLAUDE.md / .mcp.json
swarmcode hook                     # install git hooks
swarmcode status                   # team activity from the terminal
swarmcode dashboard                # launch web dashboard
swarmcode test run                 # run a multi-agent test scenario
swarmcode test list                # list available scenarios
swarmcode test report <id>         # reprint a past scorecard
swarmcode test cleanup             # remove orphaned worktrees and test issues
```

## Architecture

Swarmcode is a **stateless MCP server**. Every tool call reads git and the filesystem directly. No manifests, no background sync, no caches to invalidate.

```
swarmcode/
├── bin/
│   └── swarmcode.ts              CLI entry, starts MCP server by default
├── src/
│   ├── server.ts                 MCP server setup, registers tools with zod
│   ├── git.ts                    All git commands (execFileSync, no shell injection)
│   ├── source-parser.ts          Export search across 14 languages
│   ├── tools/                    One file per MCP tool
│   ├── dashboard/                HTTP server + single-page dashboard
│   ├── test/                     Multi-agent test harness
│   └── types.ts                  Shared type definitions
└── docs/                         Architecture, design decisions, dev guide
```

Built with `@linear/sdk` for typed Linear access. No raw GraphQL.

See [`docs/`](docs/) for architecture details, design decisions, and the development guide.

## Requirements

- **Node.js 18+**
- **Shared git repository** with a remote
- **MCP-compatible AI client**: Claude Code, Cursor, VS Code, or anything speaking the protocol
- **Linear API key** (optional) for project management integration

## How It Compares

| Project | Approach | What it coordinates |
|---------|----------|---------------------|
| CLAUDE.md | Static config | What you tell one agent |
| aider | Single-agent pair programming | One agent, your repo |
| GitHub Copilot Workspace | Cloud-hosted agent | One agent, one task |
| **swarmcode** | **Git + Linear as shared state** | **A team of agents, working in parallel** |

Every existing tool scales one agent. This one scales the team.

## License

MIT

---

<p align="center">
  Built by <a href="https://github.com/tellertech">TellerTech</a>
</p>
