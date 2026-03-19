# Swarmcode Design Spec

**Date:** 2026-03-19
**Status:** Draft

## Problem

Teams using AI coding assistants face collaboration challenges that existing tools don't address:

1. **File conflicts** — two people edit the same file and overwrite each other
2. **Interface breakage** — someone changes a shared API without others knowing
3. **Merge conflict overhead** — resolving conflicts slows teams down
4. **Duplicated effort** — confusion about who's working on what
5. **AI duplication** — each person's AI assistant has no awareness of what the others are building, so it reinvents the same features independently

Git solves file-level merging but doesn't capture intent and only detects conflicts reactively (after the fact). The AI duplication problem is entirely unaddressed by existing tools. As teams increasingly rely on AI agents for code generation, the coordination gap between independent AI sessions becomes the primary source of wasted effort and integration pain.

## Solution

**Swarmcode** is a P2P mesh agent that makes AI coding assistants team-aware. Each team member runs a local agent on their laptop. The agents discover each other on the local network, form a mesh, and continuously share metadata about what each person's AI is building. This metadata is injected into each AI tool's context file so every AI assistant on the team always knows what the others are building — without syncing a single source file.

**Key mental model:** Swarmcode syncs the **map** (who's building what, where, and why), not the **territory** (the actual files). Git handles the territory when it's ready.

## Architecture

### Agent Components

Each Swarmcode agent has five core components:

**1. File Watcher**
- Monitors the local workspace for file creates, edits, and deletes
- Uses OS-level file system events (inotify on Linux, FSEvents on macOS) for near-instant detection
- Debounces rapid changes (~500ms of quiet before processing) to avoid processing half-written files during AI generation
- Ignores noise: `node_modules`, `.git`, build artifacts, configurable via `.swarmcode/config.yaml`

**2. Intent Extractor**
- Operates in two modes corresponding to the tiered update cadence (see below)
- **Fast mode (AST):** Uses tree-sitter for multi-language AST parsing. Extracts exported functions, classes, types, and their signatures. ~50-100ms per file. Language-agnostic — supports JS/TS/Python/Go/Rust and more out of the box.
- **Rich mode (LLM):** Uses an LLM to generate intent summaries, interface descriptions, and cross-team analysis. Batches changes over a window for higher quality summaries. Provider-agnostic (see LLM Configuration).

**3. Mesh Broadcaster**
- Publishes metadata updates to all peers via ZMQ PUB/SUB
- Handles fan-out natively — no per-peer HTTP calls
- Built-in reconnection and message buffering via ZMQ

**4. Query Responder**
- Runs a ZMQ REP socket for point-to-point queries from peers
- Answers structured queries about local workspace: export signatures, file existence, dependency lists, interface file contents
- Scoped to exports, interfaces, and structural metadata — does not expose full file contents arbitrarily
- Responds in ~50ms for local file reads

**5. Context Injector**
- Takes the combined team state from all peers and writes it into the local AI tool's context file
- Adapter-based: Claude Code → `CLAUDE.md`, Cursor → `.cursorrules`, configurable for other tools
- Owns a delimited section (between `<!-- SWARMCODE START -->` and `<!-- SWARMCODE END -->` markers) — never touches the rest of the file
- Only rewrites when content would actually change (diffs against last write)
- Writes in imperative tone optimized for AI comprehension (e.g., "Do NOT create authentication utilities. Jared has built an auth module at `/api/auth/` exporting `login()`, `logout()`, and `refreshToken()`. Import from there.")

### Mesh Networking

**Discovery:** mDNS (Bonjour/Avahi). Each agent announces itself as `_swarmcode._tcp.local`. Peers are discovered automatically — no IP addresses or server configuration needed.

**Transport:** ZMQ over TCP.

| Channel | ZMQ Pattern | Purpose |
|---------|-------------|---------|
| Updates | PUB/SUB | Broadcast metadata (Tiers 1-3) |
| Queries | REQ/REP | Point-to-point questions, immediate answers |

Each agent runs:
- One PUB socket (publishes its own updates)
- SUB sockets connected to every discovered peer (receives their updates)
- One REP socket (answers queries from peers)

**State sync:**
- **On connect:** New peer receives a full state dump from any existing peer
- **Heartbeat:** Every 5 seconds, agents ping each other. If a peer goes silent for 15 seconds, it's marked offline (last-known state preserved)
- **Rejoin:** Automatic via mDNS re-discovery. Full state sync on reconnect. No manual intervention needed.

### Metadata Schema

Each broadcast update contains:

```
SwarmUpdate {
  peer_id:        unique agent identifier
  dev_name:       human-readable name ("Jared")
  timestamp:      when the change happened

  // What changed
  event_type:     "file_created" | "file_modified" | "file_deleted" | "intent_updated"
  file_path:      relative path in the project

  // Fast layer (AST-extracted, immediate)
  exports:        list of exported functions/classes/types with signatures
  imports:        what this file depends on
  work_zone:      directory/module area being actively worked in

  // Rich layer (LLM-enriched, arrives later)
  intent:         "Building JWT-based auth middleware"
  summary:        "Exposes login(), logout(), refreshToken(). Uses bcrypt for hashing."
  interfaces:     shared contracts other devs should code against

  // Conflict signals
  touches:        list of files modified in the last N minutes
}
```

### Three-Tier Update Cadence

| Tier | Interval | What | How |
|------|----------|------|-----|
| 1 | ~100ms (debounced to 500ms) | File signals, export signatures, work zone changes | AST parsing via tree-sitter. Fires on every debounced file change. |
| 2 | 60 seconds | Intent summaries, interface contract descriptions | LLM call batching all changes in the window into one summary. Produces higher quality intent than per-file summaries. |
| 3 | 5 minutes | Full cross-team analysis, duplication detection, missing integration warnings | LLM sweep across full team state. Catches patterns individual updates miss. |

Context injection only rewrites the AI's context file when something meaningfully changed, regardless of tier frequency.

### Conflict Detection

Three levels, from proactive to reactive:

**Level 1: Work Zone Warnings (proactive, Tier 1)**
When a dev's AI creates or edits files in a directory another dev is actively working in, a `zone_overlap` signal is broadcast immediately. The context injector adds a warning to the offending AI's context.

**Level 2: Interface Conflicts (Tier 2)**
The 60-second intent sweep compares exports across all peers. Duplicate function names, overlapping purpose, or conflicting type definitions are flagged and injected into both devs' AI context.

**Level 3: Pre-merge Analysis (Tier 3)**
The 5-minute sweep performs deeper cross-team analysis:
- Files that would conflict in a git merge
- Divergent implementations of similar logic
- Missing integrations (frontend calls an endpoint that doesn't exist or has a different signature)

**Resolution philosophy:** Swarmcode surfaces conflicts clearly and early. It does not auto-resolve them. The team decides how to resolve — whether that's a quick message, a conversation, or letting one dev's AI refactor to use the other's implementation.

### Planning Layer

An optional lightweight planning layer for pre-coding coordination:

- The team writes a simple `PLAN.md` at the project root — a few bullet points describing features and who's tackling what. No special format, just markdown.
- On startup, Swarmcode ingests `PLAN.md` as baseline context for zone awareness and team intent.
- Zones are also inferred organically from actual file activity, with or without a plan.
- If a dev's AI starts working outside their planned zone, the warning appears in their AI context as an instruction the AI follows.
- Shared contracts mentioned in `PLAN.md` (e.g., "User type has id, email, name, role") are treated as baseline contracts that Tier 2/3 checks against.
- No new commands or CLI workflow required.

## LLM Configuration

Swarmcode uses an LLM internally for Tier 2/3 enrichment. This is separate from whatever AI tool the dev codes with.

```yaml
enrichment:
  provider: "anthropic"        # or "openai", "ollama", "none"
  api_key_env: "ANTHROPIC_API_KEY"
  tier2_model: "claude-haiku-4-5-20251001"
  tier3_model: "claude-sonnet-4-6"
```

- Each dev configures their own provider — the mesh shares the *output* (text summaries), not the LLM calls
- Provider differences are invisible to peers
- Fallback: no API key → AST-only mode (Tier 1 works fully, lose intent summaries)
- Explicit opt-out: `provider: "none"`

## Tech Stack

| Component | Library | Rationale |
|-----------|---------|-----------|
| Runtime | Node.js / TypeScript | Target users are web devs; `npm install -g` distribution |
| File watching | `chokidar` | Cross-platform, handles debouncing |
| mDNS discovery | `bonjour-service` | Zero-config peer discovery on LAN |
| Messaging | `zeromq` (zeromq.js) | PUB/SUB + REQ/REP, built-in reconnection |
| AST parsing | `tree-sitter` | Fast, multi-language, incremental parsing |
| LLM enrichment | Anthropic SDK / OpenAI SDK | Provider-agnostic, configurable |
| CLI | `commander` | Standard CLI framework |
| Config | `yaml` | Parse `.swarmcode/config.yaml` |

## Developer Experience

**Installation:**
```
npm install -g swarmcode
```

**Starting a session:**
```
cd my-project
swarmcode init          # creates .swarmcode/ config directory
swarmcode start --name "Jared"
```

Agent runs in background. mDNS discovers teammates automatically:
```
Connected to mesh (3 peers)
  - Jared (you)
  - Sarah (192.168.1.42)
  - Mike (192.168.1.67)
```

**During coding:** No interaction required. AI context stays updated automatically. Conflict warnings appear in the AI's context and optionally as terminal notifications.

**CLI commands:**
- `swarmcode status` — who's online, what everyone's working on
- `swarmcode log` — stream of team activity
- `swarmcode query <peer> <file>` — manually query a peer's exports
- `swarmcode zones` — see who owns what directories
- `swarmcode stop` — leave the mesh

**Configuration (`.swarmcode/config.yaml`):**
```yaml
name: "Jared"
ai_tool: "claude-code"
context_file: "CLAUDE.md"     # auto-detected from ai_tool
ignore:
  - node_modules
  - dist
  - .git
tier2_interval: 60            # seconds
tier3_interval: 300           # seconds
enrichment:
  provider: "anthropic"
  api_key_env: "ANTHROPIC_API_KEY"
  tier2_model: "claude-haiku-4-5-20251001"
  tier3_model: "claude-sonnet-4-6"
```

## What Swarmcode Is Not

- **Not a git replacement.** Git still handles file merging and version control. Swarmcode prevents conflicts before they reach git.
- **Not a file sync tool.** It syncs metadata and intent, not source files.
- **Not an AI tool.** It's middleware that makes existing AI tools team-aware.
- **Not prescriptive about AI choice.** Each dev can use whatever AI coding tool they prefer.

## Scalability Considerations

Designed for small teams, architected for growth:

- **Broadcast:** ZMQ PUB/SUB handles fan-out efficiently up to ~15-20 nodes. Beyond that, the broadcast interface is swappable (e.g., gossip protocol or broker-based pub/sub).
- **Context window:** The harder scaling problem. At larger team sizes, the context injector uses relevance filtering (only inject context about work related to what you're doing) and summarization (group by feature area instead of listing every file from every dev).
- **Network topology:** mDNS works on flat LANs and office networks. For distributed teams on VPNs or across subnets, a future discovery mechanism (e.g., a lightweight registry or manual peer list) can replace mDNS behind the same discovery interface.

## Security

V1 trusts all peers on the LAN. No authentication or authorization between agents. Appropriate for trusted-network use (office LANs, VPNs, hackathons). Peer identity is self-reported via `dev_name` in config. Future versions may add shared-secret or token-based peer authentication for less trusted networks.

## Offline Behavior

ZMQ PUB/SUB drops messages to disconnected subscribers by default. When a peer reconnects (detected via mDNS re-discovery), it receives a full state sync from any available peer, ensuring it has the complete current team state regardless of missed messages during the offline period.
