# Auto-Push and Init Command Design

## Overview

Two additions to swarmcode that close the "committed but not pushed" blind spot and make setup easier:

1. **Auto-push**: A background process that watches for new local commits and pushes them to the remote automatically, so teammates see your work within seconds of committing.
2. **`swarmcode init`**: A command that appends a team coordination snippet to your AI tool's context file (CLAUDE.md, .cursorrules, etc.), reinforcing when and how to use swarmcode's tools.

## Motivation

Swarmcode's coordination depends on git being up to date. In practice:
- Developers forget to push WIP branches
- AI agents commit locally but don't always push
- New branches created by AI agents have no remote tracking branch
- There's always a gap between "first commit" and "first push"

The result: teammates' AIs can't see work that exists locally. Auto-push eliminates this gap entirely.

Separately, the MCP server sends tool instructions on connect, but they're hints — not directives. A CLAUDE.md section makes the coordination workflow mandatory rather than suggested, and lets teams customize the behavior.

## Auto-Push

### Tool interface

**`enable_auto_push`**

Registered in `server.ts`. Starts a background interval that pushes new commits.

```
Input:  { interval?: number }   // seconds between checks, default 5
Output: {
  enabled: true,
  branch: "feat/auth",
  interval: 5,
  protected_branches: ["main", "master", "develop"]
}
```

If already enabled, returns current status with `already_enabled: true`. Not an error — idempotent.

Returns an error if:
- On a protected branch (`main`, `master`, `develop`)
- No `origin` remote configured

**`disable_auto_push`**

```
Input:  {}
Output: { enabled: false, pushes_made: 12 }
```

Returns push count for the session. If not enabled, returns `{ enabled: false, pushes_made: 0 }`.

### Implementation: `src/tools/auto-push.ts`

Exports `enableAutoPush()` and `disableAutoPush()`.

Core loop (runs on `setInterval`):

```
Every N seconds:
  1. git rev-parse HEAD → current SHA
  2. Compare to last-known SHA
  3. If different:
     a. Check current branch name (git rev-parse --abbrev-ref HEAD)
     b. If protected branch → skip
     c. If no upstream → git push -u origin <branch>
     d. If has upstream → git push
     e. Update last-known SHA
     f. Increment push counter
     g. Log success/failure to stderr
  4. If same → do nothing
```

### Edge cases

**Push fails (diverged remote):** Normal `git push` — if it fails, log to stderr, retry next cycle. Never force-push. After 3 consecutive failures on the same branch, stop retrying and include the failure in the next tool response.

**No remote:** `enable_auto_push` returns an error immediately: "No origin remote found."

**Detached HEAD:** Auto-push does nothing. Resumes when a branch is checked out.

**Branch switches mid-session:** The interval checks the current branch on every tick. Adapts automatically — pushes the new branch, respects the protected branch list.

**New branches (no upstream):** Uses `git push -u origin <branch>` to create the remote tracking branch on first push. Subsequent pushes use `git push`. This is the most common case — AI agents create local branches constantly.

**Multiple swarmcode instances:** Each pushes independently. Git handles concurrent pushes to different branches. If two instances are on the same branch, normal push semantics apply — second push fails if behind, triggers retry.

### What auto-push does NOT do

- Never commits (only pushes existing commits)
- Never force-pushes
- Never pulls or rebases
- Never touches branches other than the current one

### Server instructions update

Add to the existing instructions string in `server.ts`:

```
- At the start of a session → call enable_auto_push so teammates see your work immediately
```

## Init Command

### CLI interface

```
swarmcode init [--tool claude-code|cursor|copilot]
```

Defaults to `claude-code` if `--tool` is not specified.

### Behavior

1. Determine the target context file based on `--tool`:
   - `claude-code` → `CLAUDE.md`
   - `cursor` → `.cursorrules`
   - `copilot` → `.github/copilot-instructions.md`
2. If the file exists and already contains `## Team Coordination (Swarmcode)` → print "Swarmcode section already exists in <file>" and exit
3. If the file exists → append the snippet (with a leading newline separator)
4. If the file doesn't exist → create it with just the snippet
5. Print what was done: "Added swarmcode team coordination to <file>"

### The snippet

```markdown
## Team Coordination (Swarmcode)

This project uses swarmcode for AI team coordination.

- At the start of every session, call `enable_auto_push` and `get_team_activity`
- Before creating or modifying any file, call `check_path`
- Before implementing a function/type/component, call `search_team_code`
- Never rebuild something a teammate already built — import it
- If check_path returns high risk, stop and ask the developer before proceeding
```

### Implementation

Add a new `init` subcommand in `src/cli.ts` using Commander. The logic is straightforward file I/O — read, check for existing section, append or create.

## README Updates

The README Quick Start section should be rewritten to include the full setup flow:

### Updated Quick Start

```
### 1. Install

git clone + npm install + npm link (unchanged)

### 2. Initialize (once per project)

swarmcode init

  - Explain what this does (appends coordination rules to CLAUDE.md)
  - Show --tool flag for Cursor/Copilot users
  - Show the snippet that gets added

### 3. Add to your AI client's MCP config

  - Claude Code and Cursor JSON configs (unchanged)

### 4. Everyone else does the same

  - Each teammate: install, init, add MCP config
  - Mention that init only needs to run once per project (the CLAUDE.md snippet is committed to git so everyone gets it)
```

### New sections to add

**Auto-Push section** (after The 5 Tools, which becomes "The 7 Tools" or rename to just "Tools"):

Explain what auto-push does, that it's called automatically at session start, and that it solves the "forgot to push" problem. Mention:
- Only pushes commits, never creates them
- Handles new branches automatically
- Never force-pushes
- Skips protected branches (main, master, develop)

**Update the CLI table** to include `swarmcode init`.

**Update the "How It Differs from v1" section** — note that `swarmcode init` is back but simpler (one-line append vs directory creation + config files).

## Files to create or modify

| File | Action |
|------|--------|
| `src/tools/auto-push.ts` | Create — enableAutoPush, disableAutoPush |
| `tests/tools/auto-push.test.ts` | Create — unit tests |
| `src/server.ts` | Modify — register 2 new tools, update instructions |
| `src/cli.ts` | Modify — add init subcommand |
| `tests/integration/mcp-server.test.ts` | Modify — add auto-push integration tests |
| `src/types.ts` | Modify — add AutoPushState type |
| `README.md` | Modify — updated Quick Start, new auto-push section, updated CLI table |
| `docs/architecture.md` | Modify — add auto-push to module map and tool table |
| `docs/development.md` | Modify — mention auto-push in test structure |
