# Swarmcode

**Coordinate AI coding agents with git and Linear.**

Swarmcode is an MCP server that makes AI coding assistants aware of each other. It uses git for real-time coordination (who's touching what files, where are conflicts) and Linear for project management (what's assigned, what's done, what's blocked). AI agents claim tickets, work them, log progress, and mark them done — autonomously.

## Quick Start

```bash
# Install
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode && npm install && npm link

# In your project
cd /path/to/your-project
swarmcode init          # adds CLAUDE.md + MCP config
swarmcode hook          # installs git hooks for Linear integration
```

### Connect Linear (recommended)

```bash
export SWARMCODE_LINEAR_API_KEY=lin_api_xxxxx
export SWARMCODE_LINEAR_TEAM=ENG              # optional
```

Get your key from [Linear Settings → API](https://linear.app/settings/api). Add to `~/.bashrc` or `~/.zshrc`.

### For other AI tools

```bash
swarmcode init --tool cursor    # .cursorrules
swarmcode init --tool copilot   # .github/copilot-instructions.md
```

## How It Works

```
Agent starts session
│
├── start_session ──→ team activity + conflicts + project context + auto-push
├── linear_get_issues ──→ what's available to work on?
│
├── pick_issue("ENG-123") ──→ claims ticket, returns branch name
│   └── git checkout -b feat/eng-123-auth-flow
│
├── Commits ──→ hooks auto-prepend "ENG-123:" to messages
│   │           post-commit hook moves ENG-123 to In Progress
│   └── auto-push sends to remote within seconds
│
├── check_path / search_code ──→ avoid conflicts and duplication
│
├── log_progress("ENG-123", "Auth done, starting tests")
│
└── complete_issue("ENG-123") ──→ marks Done in Linear
```

## Git Hooks

`swarmcode hook` installs 4 git hooks that link git and Linear automatically:

| Hook | What it does |
|------|-------------|
| `prepare-commit-msg` | Auto-prepends issue ID from branch name to commits |
| `commit-msg` | Warns if commit has no issue ID |
| `post-commit` | First commit on branch → moves Linear issue to In Progress |
| `pre-push` | Fetches remote branches before pushing |

Branch naming convention: `feat/eng-123-description`. The hooks parse the issue ID and handle the rest.

## Tools

### Session & Coordination

| Tool | What |
|------|------|
| `start_session` | Everything at session start: activity, context, conflicts, auto-push |
| `check_path` | Who owns this area? Pending changes? Risk level? |
| `search_code` | Does this function already exist on any branch? |
| `check_conflicts` | Files modified on multiple branches |
| `get_developer` | One teammate's commits, branches, files |
| `get_project_context` | Read PLAN.md, specs, README, CLAUDE.md |

### Linear — Issues

| Tool | What |
|------|------|
| `pick_issue` | Claim ticket + get branch name (assigns + In Progress) |
| `complete_issue` | Mark Done |
| `log_progress` | Comment on a ticket (milestones, not every commit) |
| `create_issue` | Found a bug? Create a ticket |
| `create_sub_issue` | Break work into pieces |
| `search_issues` | Does a ticket already exist? |
| `get_issue` | Full details, comments, sub-issues |
| `update_issue` | Edit title, description, priority, assignee |

### Linear — Projects

| Tool | What |
|------|------|
| `project_status` | All projects with progress and health |
| `get_project_issues` | Issues in a project |
| `update_project_status` | Post a status update (on track / at risk / off track) |
| `update_project` | Change name, state, target date |

### Linear — Reference

| Tool | What |
|------|------|
| `get_teams` | Resolve team IDs |
| `get_users` | Resolve user IDs |
| `get_viewer` | Who am I? |
| `get_labels` | Available labels |

## Dashboard

```bash
swarmcode dashboard                # http://localhost:3000
swarmcode dashboard --port 8080
```

Live web dashboard with five panels:
- **Team Activity** — developer cards with branches, commits, work areas
- **Conflict Radar** — files on multiple branches with severity
- **Branch Timeline** — 48-hour commit timeline per branch
- **Linear** — active issues by status (when API key is set)
- **Project Context** — rendered markdown docs

Auto-updates every 30 seconds.

## CLI

```bash
swarmcode                          # start MCP server
swarmcode init                     # add coordination rules
swarmcode hook                     # install git hooks
swarmcode status                   # team activity from terminal
swarmcode dashboard                # launch web dashboard
```

## Requirements

- **Node.js 18+**
- **Shared git repository** with a remote
- **MCP-compatible AI client** (Claude Code, Cursor, VS Code)
- **Linear API key** (optional) for project management

## Architecture

- **Linear is the brain** — tickets, assignments, status, projects
- **Git is the hands** — branches, commits, files, conflicts
- **Hooks are the glue** — branch names link git events to Linear state
- **MCP is the interface** — AI agents call tools, get coordination data

Built with `@linear/sdk` for typed Linear API access. No raw GraphQL.

See [docs/](docs/) for architecture details, design decisions, and development guide.

## License

MIT
