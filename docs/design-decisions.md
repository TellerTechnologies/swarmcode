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
