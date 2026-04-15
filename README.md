# Swarmcode

> **Coordinate a swarm of AI coding agents using git.**
> One agent is a pair programmer. Three agents are a team — if they can see each other.

Swarmcode is an MCP server that makes AI coding assistants aware of each other. It uses **git** for real-time coordination (who's touching what, where are the conflicts) and **Linear** for project management (what's assigned, what's done, what's blocked). Agents claim tickets, branch, commit, log progress, and mark them done — autonomously, without stepping on each other's work.

```
   ┌─ agent A ─┐          ┌──────────┐          ┌─ agent C ─┐
   │ ENG-123   │──┐    ┌──│ swarmcode│──┐    ┌──│ ENG-125   │
   └───────────┘  ├────┤  │   (MCP)  │  ├────┤  └───────────┘
                  │    │  └──────────┘  │    │
                  │    │  git + Linear  │    │
                  │    │    as truth    │    │
                  │    └────────────────┘    │
                  │      ┌─ agent B ─┐       │
                  └──────│ ENG-124   │───────┘
                         └───────────┘
```

---

## Why

LLM coding agents are fast, cheap, and increasingly good. The bottleneck is no longer *writing* code — it's making sure three of them working in parallel don't:

- claim the same ticket,
- rebuild what a teammate finished an hour ago,
- overwrite each other's changes in the same file,
- or drift out of sync with Linear so a human can't tell what's done.

Swarmcode is the connective tissue. Git is the **shared state** (no manifests, no extra daemons — `git log` is authoritative). Linear is the **task queue**. Agents get a single coordination surface: "what's happening, what's mine, what conflicts, what's next."

---

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

### Connect Linear

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

---

## A Day in the Life of an Agent

```
Agent starts session
│
├── start_session ──────→ team activity + conflicts + project context + auto-push
├── linear_get_issues ──→ what's available to work on?
│
├── pick_issue("ENG-123") ──→ claims ticket (optimistic lock), returns branch name
│   └── git checkout -b feat/eng-123-auth-flow
│
├── Commits ──→ hooks auto-prepend "ENG-123:" to messages
│   │          post-commit hook moves ENG-123 → In Progress
│   └── auto-push sends to remote within seconds
│
├── check_path / search_code ──→ pre-write conflict & duplication detection
│
├── log_progress("ENG-123", "Auth done, starting tests")
│
└── complete_issue("ENG-123") ──→ marks Done in Linear
```

---

## Git Hooks

`swarmcode hook` installs 4 git hooks that wire git events directly into Linear:

| Hook | What it does |
|------|-------------|
| `prepare-commit-msg` | Auto-prepends issue ID from branch name to commits |
| `commit-msg` | Warns if commit has no issue ID |
| `post-commit` | First commit on branch → moves Linear issue to In Progress |
| `pre-push` | Fetches remote branches before pushing |

Branch naming: `feat/eng-123-description`. The hooks parse the ID and handle the rest.

---

## Tools

### Session & Coordination

| Tool | What |
|------|------|
| `start_session` | One call: activity, context, conflicts, auto-push |
| `check_path` | Ownership + risk + **pre-write merge conflict detection via `git merge-tree`** |
| `search_code` | Does this function already exist on any branch? |
| `check_conflicts` | Files modified on multiple branches |
| `get_developer` | One teammate's commits, branches, files |
| `get_project_context` | Reads `PLAN.md`, specs, READMEs, `CLAUDE.md` |

### Linear — Issues

| Tool | What |
|------|------|
| `pick_issue` | Claim a ticket. **Optimistic lock** — rejects if already claimed by another agent. |
| `complete_issue` | Mark Done |
| `log_progress` | Comment on a ticket (milestones, not every commit) |
| `create_issue` | Found a bug? Create a ticket |
| `create_sub_issue` | Break work into pieces |
| `search_issues` | Does a ticket already exist? |
| `get_issue` | Full details, comments, sub-issues |
| `update_issue` | Edit title, description, priority, assignee |

### Linear — Projects & Reference

| Tool | What |
|------|------|
| `project_status` | All projects with progress and health |
| `get_project_issues` | Issues in a project |
| `update_project_status` | Post a status update (on track / at risk / off track) |
| `update_project` | Change name, state, target date |
| `get_teams` / `get_users` / `get_viewer` / `get_labels` | ID resolution |

---

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
- **Project Context** — rendered markdown docs with syntax highlighting

Auto-updates every 30 seconds. No build step — served directly from disk.

---

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

| Grade | Meaning |
|-------|---------|
| **A** | Zero conflicts, zero duplication, all tests pass |
| **B** | Conflicts auto-resolved with `git merge -X patience` |
| **C** | Unresolvable merge conflicts |
| **D** | Incomplete issues, duplicate claims, or test failures |

### Conflict prevention built in

- **Optimistic lock on `pick_issue`** — two agents can't claim the same issue
- **Pre-write detection** — `check_path` runs `git merge-tree` against active branches before you edit
- **Auto-resolution** — the harness retries failed merges with patience strategy

---

## CLI

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

---

## Architecture

- **Linear is the brain** — tickets, assignments, status, projects
- **Git is the hands** — branches, commits, files, conflicts
- **Hooks are the glue** — branch names link git events to Linear state
- **MCP is the interface** — agents call tools, get coordination data

Built with `@linear/sdk` for typed Linear access. Stateless server — every tool call reads directly from git and the filesystem on demand. No manifests, no background sync, no caches to invalidate.

See [`docs/`](docs/) for deeper architecture notes, design decisions, and the development guide.

---

## Requirements

- **Node.js 18+**
- **Shared git repository** with a remote
- **MCP-compatible AI client** — Claude Code, Cursor, VS Code, or anything speaking the protocol
- **Linear API key** (optional) for project management integration

## License

MIT
