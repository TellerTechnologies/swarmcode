# Swarmcode

**Make your AI coding assistants aware of each other.**

Swarmcode is a lightweight tool that runs in the background while your team codes with AI assistants (Claude Code, Cursor, Copilot, etc.). It automatically tells each person's AI what the rest of the team is building — so they stop duplicating work, avoid conflicts, and stay coordinated without any extra effort from you.

## The Problem

When multiple developers use AI coding assistants on the same project, each AI works in isolation. They don't know what the other AIs are building. This leads to:

- Two people's AIs building the same utility function independently
- Someone's AI creating a file in a directory another person is actively working in
- Merge conflicts that could have been prevented
- Wasted time rebuilding things a teammate already built

## How It Works

Each team member runs a Swarmcode agent. The agent watches your files, extracts metadata (function names, exports, imports), and writes it to a manifest file at `.swarmcode/peers/<your-name>.json`. Git syncs these manifests automatically every 30 seconds — commit, pull, push. Each agent reads its teammates' manifests and injects a coordination summary directly into your AI tool's context file.

```
Your laptop                                        Teammate's laptop
+-----------------+                               +-----------------+
| Claude Code     |                               | Cursor          |
|   reads from    |                               |   reads from    |
|   CLAUDE.md  <--+--[generated locally]          |   .cursorrules  |
|                 |                               |                 |
| Swarmcode  -----+--> git push manifest --> shared repo           |
|                 |                               |                 |
|                 |    shared repo <-- git pull manifest <-- Swarmcode
+-----------------+                               +-----------------+
```

**What gets shared:** Function names, file paths, who's working where, and what they're building — written as JSON manifests in `.swarmcode/peers/`. **Not** actual source code.

**What doesn't get shared:** Your files. Git still handles that. Swarmcode shares the *map* (who's building what), not the *territory* (the actual code).

**Only manifests are auto-committed.** Swarmcode only stages and commits files under `.swarmcode/peers/`. Your own code commits are left entirely to you.

**Works anywhere git works:** LAN, VPN, remote teams, CI — no ports, no network configuration, no accounts.

## Quick Start

### 1. Install

```bash
npm install -g swarmcode
```

Or clone and link locally:

```bash
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode
npm install
npm link
```

### 2. Initialize (once per project)

In your project directory:

```bash
swarmcode init --name "Your Name"
```

This creates a `.swarmcode/config.yaml` file and the `.swarmcode/peers/` directory. The defaults work out of the box.

After initializing, follow the printed instructions:

- Commit `.swarmcode/peers/` to git so teammates can receive your manifest.
- Add your context file (e.g., `CLAUDE.md`) to `.gitignore` — it is generated locally and should not be committed.

### 3. Start

```bash
swarmcode start
```

That's it. Swarmcode writes your manifest, syncs it via git, reads your teammates' manifests, and keeps your AI's context file up to date. You'll see:

```
Starting swarmcode as "Jared"...
Swarmcode started
  Name: Jared
  Watching: /path/to/your/project
  Context: CLAUDE.md
  Sync: every 30s
```

Now open your AI tool and start coding. Your AI's context file will automatically include what your teammates are working on.

### 4. Everyone else does the same

Each teammate clones the project, runs `swarmcode init --name "Their Name"`, and `swarmcode start`. No network configuration needed — if everyone can push and pull from the shared git remote, it just works.

## What Your AI Sees

Swarmcode adds a section to your AI's context file (e.g., `CLAUDE.md`) that looks like this:

```markdown
## Swarmcode Team Context

The following teammates are working on this project.
DO NOT rebuild what they have already built. Import from their modules instead.

### Sarah (online)
- Working in: src/auth/ — DO NOT create files in this directory without coordinating.
- Intent: Building JWT-based authentication
- Files already built:
  - src/auth/login.ts exports: login, logout — import from here, do not rebuild.
  - src/auth/middleware.ts exports: requireAuth — import from here, do not rebuild.

### Mike (online)
- Working in: src/components/
- Files already built:
  - src/components/Dashboard.tsx exports: Dashboard, StatCard
```

Your AI reads this and knows not to rebuild `login()` or create files in `src/auth/`.

## Configuration

Edit `.swarmcode/config.yaml`:

```yaml
# Your display name (shown to teammates)
name: "Jared"

# Which AI tool you use — determines which context file gets updated
# Options: claude-code, cursor, copilot, custom
ai_tool: "claude-code"

# Files/directories to ignore (won't be tracked or shared)
ignore:
  - node_modules
  - dist
  - .git

# How often to sync manifests via git and refresh the context file (seconds)
sync_interval: 30

# How often to generate AI summaries of your work (seconds)
# Requires an LLM API key (see below)
tier2_interval: 60
tier3_interval: 300

# Optional: LLM enrichment for richer context
# Without this, Swarmcode still works — it just shares function names
# and file paths instead of human-readable summaries
enrichment:
  provider: "none"          # "anthropic", "openai", or "none"
  api_key_env: ""           # env var name containing your API key
  tier2_model: ""           # model for 60s summaries
  tier3_model: ""           # model for 5min cross-team analysis
```

### AI Tool Context Files

| AI Tool | Context File | Set With |
|---------|-------------|----------|
| Claude Code | `CLAUDE.md` | `ai_tool: "claude-code"` |
| Cursor | `.cursorrules` | `ai_tool: "cursor"` |
| GitHub Copilot | `.github/copilot-instructions.md` | `ai_tool: "copilot"` |
| Other | Any path | `context_file: "your/path.md"` |

## Optional: Team Planning

Create a `PLAN.md` in your project root before you start coding:

```markdown
# Project Plan

## Features
- **Auth system** - Jared
- **Dashboard** - Sarah
- **API endpoints** - Mike

## Shared Types
- User: { id, email, name, role }
```

Swarmcode reads this on startup and uses it to warn AIs when they stray outside their assigned areas. No special format required — just markdown.

## CLI Commands

| Command | What it does |
|---------|-------------|
| `swarmcode init` | Set up Swarmcode in current project |
| `swarmcode start` | Start the agent (runs in foreground) |
| `swarmcode start --name "Name"` | Start with a specific display name |
| `swarmcode status` | Show who's online and what they're working on |

## How Updates Work

Swarmcode uses three tiers of updates, from fast to deep:

| Tier | Speed | What it shares | How |
|------|-------|---------------|-----|
| **Tier 1** | ~100ms | File names, function signatures, imports | AST parsing (instant, no API needed) |
| **Tier 2** | 60s | "What is this person building?" summaries | LLM call (needs API key) |
| **Tier 3** | 5min | "Are there duplications or conflicts across the team?" | LLM analysis (needs API key) |

**Tier 1 works without any API key.** Your AI will know what functions exist and who created them. Tiers 2 and 3 add richer context if you configure an LLM provider.

## Requirements

- **Node.js 18+**
- **A shared git repository** with a remote that all team members can push to and pull from

## FAQ

**Does this replace git?**
No. Git still handles all file merging and version control. Swarmcode uses git as its sync layer for manifests, and prevents conflicts *before* they reach your code by keeping AIs coordinated.

**Does it sync my files?**
No. It only shares metadata — function names, file paths, and summaries. Your actual source code stays on your machine until you push to git as you normally would.

**What if someone goes offline?**
Their last-known manifest is preserved in git. When they come back online and push a new manifest, everyone picks it up on the next sync. No manual steps needed.

**Does everyone need to use the same AI tool?**
No. Each person can use whatever they prefer. Swarmcode writes to the right context file for each tool.

**Do we need to be on the same network?**
No. Swarmcode uses git as its transport layer, so it works wherever git works: same LAN, VPN, remote teams, or even CI environments.

**What gets committed to git?**
Only the manifest files under `.swarmcode/peers/`. Swarmcode never touches your source code commits — those are always left to you.

**What should I add to `.gitignore`?**
Your AI context file (e.g., `CLAUDE.md`, `.cursorrules`) — it is generated locally from peer manifests and will differ per machine. The `.swarmcode/peers/` directory should be tracked by git.

## License

MIT
