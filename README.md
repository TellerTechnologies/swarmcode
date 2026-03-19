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

Each team member runs a Swarmcode agent on their laptop. The agents automatically discover each other on the local network and share metadata about what each person's AI is building. That metadata gets injected directly into your AI tool's context file — so your AI *knows* what your teammates are doing.

```
Your laptop                          Teammate's laptop
+-----------------+                  +-----------------+
| Claude Code     |                  | Cursor          |
|   reads from    |                  |   reads from    |
|   CLAUDE.md  <--+---- Swarmcode ---+--> .cursorrules  |
|                 |    mesh (LAN)    |                 |
+-----------------+                  +-----------------+
```

**What gets shared:** Function names, file paths, who's working where, and what they're building. **Not** actual source code — just enough context for the AIs to coordinate.

**What doesn't get shared:** Your files. Git still handles that. Swarmcode shares the *map* (who's building what), not the *territory* (the actual code).

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

This creates a `.swarmcode/config.yaml` file. The defaults work out of the box.

### 3. Start

```bash
swarmcode start
```

That's it. Swarmcode discovers your teammates automatically via the local network. You'll see:

```
Starting swarmcode as "Jared"...
Swarmcode started
  Name: Jared
  Peers: 2
  Watching: /path/to/your/project
  Context: CLAUDE.md
```

Now open your AI tool and start coding. Your AI's context file will automatically include what your teammates are working on.

### 4. Everyone else does the same

Each teammate clones the project, runs `swarmcode init --name "Their Name"`, and `swarmcode start`. The agents find each other automatically — no configuration needed. Just be on the same network.

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
| `swarmcode zones` | Show which directories each person owns |
| `swarmcode log` | Stream team activity |
| `swarmcode stop` | Stop the agent |

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
- **Same local network** — all team members must be on the same LAN or VPN for automatic discovery
- **An AI coding tool** that reads a context file (Claude Code, Cursor, Copilot, etc.)

## FAQ

**Does this replace git?**
No. Git still handles all file merging and version control. Swarmcode prevents conflicts *before* they reach git by keeping AIs coordinated.

**Does it sync my files?**
No. It only shares metadata — function names, file paths, and summaries. Your actual source code stays on your machine until you push to git.

**What if someone goes offline?**
Their last-known state is preserved. When they reconnect, they automatically get a full sync. No manual steps needed.

**Does everyone need to use the same AI tool?**
No. Each person can use whatever they prefer. Swarmcode writes to the right context file for each tool.

**How does it find my teammates?**
mDNS (the same technology that lets you find printers on your network). No server, no configuration, no accounts.

## License

MIT
