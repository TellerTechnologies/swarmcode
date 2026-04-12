# Design Decisions

Decisions made during the v2 rewrite and the reasoning behind them. Read this before proposing changes to the architecture.

## Stateless over stateful

**Decision:** The MCP server has zero state — no caches, no watchers, no background processes. Every tool call queries git fresh.

**Why:** The v1 architecture maintained a parallel state system (JSON manifests synced via git). This created a category of bugs around staleness, sync timing, and state divergence. Git is already the source of truth — reading it directly eliminates the entire class of problems.

**Trade-off:** Can't see uncommitted work from teammates. Accepted because AI agents commit frequently and the authoritative data from git is more reliable than a stale 30-second-old cache.

**When to revisit:** If users report that the "invisible uncommitted work" gap is causing real problems (duplicate work within a few minutes). In that case, consider a lightweight presence broadcast — not full manifests.

## MCP over file injection

**Decision:** Replaced CLAUDE.md / .cursorrules injection with MCP tool calls.

**Why:** File injection was push-based (dump everything into context whether relevant or not), stale (snapshot in time), and fragile (marker-based parsing, per-tool context file mapping). MCP is pull-based (AI asks for what it needs), always fresh (reads on demand), and standardized (works with any MCP-compatible client).

**When to revisit:** If major AI tools don't support MCP. As of the rewrite, Claude Code, Cursor, and VS Code all support MCP servers.

## One process, no daemon

**Decision:** The MCP server is the only process. No separate agent or daemon.

**Why:** The MCP server is spawned by the AI client and lives for the session. When you're not in an AI session, nothing needs to run — swarmcode exists to coordinate AI assistants, and if none are active, there's nothing to coordinate. The last committed state in git is still accurate.

**When to revisit:** If there's a need for continuous background activity (e.g., proactive conflict alerts pushed to a Slack channel). That would require a separate process.

## execFileSync over execSync

**Decision:** All git commands use `execFileSync('git', [...args])`, never `execSync('git ...')`.

**Why:** `execFileSync` passes arguments as an array directly to the process, bypassing the shell. This prevents shell injection from user-provided paths or branch names. `execSync` runs through the shell, where a branch name like `; rm -rf /` would be dangerous.

**Non-negotiable.** Don't change this.

## Regex over AST for export search

**Decision:** source-parser.ts uses regex patterns to find exports, not tree-sitter or other AST parsers.

**Why:** Tree-sitter native modules failed to compile on Node v24 (the original reason for the regex fallback in v1). Regex handles the common cases (named exports, default exports, top-level Python defs/classes) reliably. The patterns are well-tested.

**Limitation:** Won't catch re-exports (`export { foo } from './bar'`), computed exports, or unusual patterns. Acceptable because the tool is for coordination hints, not a compiler.

**When to revisit:** If tree-sitter Node bindings stabilize, or if the regex patterns miss too many real-world exports.

## Tool output as JSON text

**Decision:** All tool handlers return `JSON.stringify(result, null, 2)` as a text content block.

**Why:** The MCP SDK supports structured output via `structuredContent`, but text is simpler and universally supported. The AI can parse JSON text. Pretty-printing with indent 2 makes it readable in logs.

**When to revisit:** If MCP clients start treating structured output differently (e.g., rendering tables), switch to `structuredContent`.

## Fuzzy author matching

**Decision:** `get_developer` does case-insensitive substring matching against git author names.

**Why:** Users don't always know the exact git author string. "Alice" should match "Alice Johnson". Exact match is tried first, then substring.

**Limitation:** Ambiguous matches (two authors both containing "Al") return the first one found. Acceptable for a coordination tool.

## No config files

**Decision:** Swarmcode v2 has no configuration. No `.swarmcode/` directory, no `config.yaml`, no `init` command.

**Why:** There's nothing to configure. The MCP server reads from git, which is already there. The only "setup" is adding it to your AI client's MCP config.

**When to revisit:** If users need to customize behavior (e.g., ignore certain directories, change the time window defaults, filter specific authors). Add configuration only when there's a real need, not speculatively.

## Sentinel-based log parsing

**Decision:** `getLog()` uses a sentinel string (`---SWARMCODE_COMMIT---`) in the git format to delimit commits, rather than splitting on blank lines.

**Why:** `git log --name-only` puts blank lines both within a commit (between header and file list) and between commits. Splitting on `\n\n` misassociates headers with file lists. The sentinel approach is reliable regardless of blank line placement.

**This was a bug found during integration testing.** The unit tests (with mocked git output) didn't catch it because the mock data didn't reproduce git's actual output format. The integration tests (real git repo) caught it immediately.

**Lesson:** Integration tests against real git repos catch parsing issues that unit tests with synthetic data miss.

## Auto-fetch over auto-pull

**Decision:** Tools that read remote state automatically run `git fetch` (not `git pull`) before querying, throttled to once per 30 seconds.

**Why:** `git pull` = fetch + merge, which modifies the working tree. That's dangerous when a developer or AI is actively editing files — it can cause merge conflicts mid-session or break the current build state. `git fetch` only updates remote refs so swarmcode can *see* what's on other branches without touching local files.

**Why throttled on-demand, not a background interval:** Fits the stateless design philosophy. No background process to manage. The throttle prevents repeated tool calls from hammering the remote. If the AI calls `check_all` (which triggers `get_team_activity`, `check_conflicts`, and `get_project_context`), only the first sub-tool actually fetches.

**When to revisit:** If the 30-second staleness window is too long for real-time coordination. Could be made configurable per-project.

## Dashboard as built-in HTML, not React/SPA

**Decision:** The web dashboard is a single HTML file with inlined CSS and JS, served by Node's built-in `http` module. No React, no bundler, no external npm dependencies.

**Why:** The dashboard needs to "just work" with `swarmcode dashboard`. Adding React or a build step would mean either a build command before serving, or bundling pre-built assets. Both add complexity. The dashboard is read-only and relatively simple — four panels displaying JSON data. Inline HTML/CSS/JS is sufficient and keeps the install footprint minimal.

**Trade-off:** The inline markdown renderer is basic (no syntax highlighting, limited table support). Acceptable for rendering PLAN.md and specs.

**When to revisit:** If the dashboard grows significantly in complexity (interactive editing, filters, multi-repo views), consider a lightweight framework. Until then, vanilla JS is fine.

### Optimistic locks over distributed coordination

`pick_issue` checks issue state before claiming — if already In Progress, it rejects with an error. This is simpler than distributed locks, message queues, or a coordination server.

**Trade-off:** There's still a small race window between the state check and the update. For AI agents with 5s staggered launches, this is sufficient. If agents launched simultaneously with sub-second timing, a true atomic compare-and-swap via Linear's API would be needed.

### Pre-write conflict detection via git merge-tree

`check_path` runs `git merge-tree` against active branches to detect if editing a file would cause a merge conflict. This catches conflicts *before* they happen, not after.

**Trade-off:** Adds ~100-500ms per `check_path` call (one `git merge-tree` per active branch). This is acceptable since `check_path` runs before edits, not in a hot loop. The alternative — file-level locking — would be heavier and break swarmcode's stateless design.

### Patience merge as auto-resolution strategy

When the test harness hits a merge conflict, it retries with `git merge -X patience`. The patience diff algorithm is better at handling cases where multiple agents add content to the same area of a file (common with JSDoc additions, test additions, etc.).

**Trade-off:** Patience merge can silently produce wrong results if both agents modified the same logical block differently. For the test harness this is acceptable because the test suite runs after merge and catches semantic errors. For production use, manual review would be needed.

### Real agents over mocks for coordination testing

The test harness launches real Claude Code sessions with real Linear tickets, not mocked agents. This means test results reflect actual coordination behavior.

**Trade-off:** Tests are slow (3-5 minutes), expensive (API costs for N Claude sessions), and non-deterministic. But mocked tests would miss the exact race conditions and behavioral patterns that matter — we caught the duplicate-claim bug only because we used real agents.
