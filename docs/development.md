# Development Guide

## Setup

```bash
git clone <repo>
cd swarmcode
npm install
```

No build step needed for development — tsx runs TypeScript directly.

## Running tests

```bash
# Unit tests (mocked git, fast)
npm test

# Integration tests (real git repo, ~200ms)
npm run test:integration

# Watch mode
npm run test:watch

# Type check
npx tsc --noEmit
```

## Test structure

```
tests/
├── git.test.ts                    Mocks execFileSync, tests all 12 git.ts functions
├── source-parser.test.ts          Tests regex export search (JS/TS/Python)
├── tools/
│   ├── get-team-activity.test.ts  Mocks git.ts, tests grouping/filtering logic
│   ├── check-path.test.ts         Mocks git.ts, tests risk assessment
│   ├── search-team-code.test.ts   Mocks git.ts + fs, tests export search pipeline
│   ├── check-conflicts.test.ts    Mocks git.ts, tests branch conflict detection
│   ├── get-developer.test.ts      Mocks git.ts, tests fuzzy match + profile building
│   ├── auto-push.test.ts          Mocks git.ts, tests interval polling and push logic
│   └── get-project-context.test.ts  Real filesystem tests against temp directories
├── cli-init.test.ts               Runs real CLI against temp directories
└── integration/
    ├── mcp-server.test.ts         Real git repo, no mocks, end-to-end
    └── two-agents.test.ts         Two cloned repos, multi-agent coordination
```

**Unit tests** mock `git.ts` (via `vi.mock('../../src/git.js')`) so they run instantly without touching the filesystem.

**Integration tests** create a temporary git repo with multiple authors and branches in `beforeAll`, run the actual tool functions, then clean up in `afterAll`. They use `process.chdir()` to set the working directory.

## Adding a new tool

1. Define return types in `src/types.ts`
2. Export types from `src/index.ts`
3. Create `src/tools/<tool-name>.ts` — export a function that calls `git.ts` and returns your type
4. Create `tests/tools/<tool-name>.test.ts` — mock `git.ts`, test your function
5. Register the tool in `src/server.ts`:
   ```typescript
   server.registerTool('tool_name', {
     title: 'Tool Name',
     description: '...',
     inputSchema: { param: z.string().describe('...') },
   }, ({ param }) => {
     const result = toolFunction({ param });
     return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
   });
   ```
6. Add integration test coverage in `tests/integration/mcp-server.test.ts`

## Adding git queries

All git commands go through `src/git.ts`. Never call `execFileSync` directly from tool handlers.

The module has three internal helpers:
- `run(args)` — returns trimmed string, empty string on error
- `runRaw(args)` — preserves internal whitespace (for `git status --porcelain` where leading spaces matter)
- `runOrNull(args)` — returns trimmed string, null on error

Always use `execFileSync` (array args), never `execSync` (string command) — prevents shell injection from user-provided paths.

## MCP SDK patterns

Import paths (note the `.js` subpaths):
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
```

Tool input schemas use Zod types as a plain object (not `z.object()`):
```typescript
inputSchema: {
  name: z.string().describe('...'),
  count: z.number().optional().describe('...'),
}
```

Tool handlers return `{ content: [{ type: 'text', text: '...' }] }`. Use `JSON.stringify(result, null, 2)` for structured data.

Use `console.error()` for logging (stdout is the MCP protocol stream).

## Testing locally

To test the MCP server manually:

```bash
# Start the server (it reads from stdin, writes to stdout)
npx tsx bin/swarmcode.ts

# Or test the CLI status command
npx tsx bin/swarmcode.ts status
npx tsx bin/swarmcode.ts status --since 7d
```

The MCP server expects JSON-RPC messages on stdin. For real testing, use an MCP client or configure it in Claude Code's MCP settings.

## Project conventions

- ESM modules (`"type": "module"` in package.json)
- Import paths use `.js` extensions (Node16 module resolution)
- vitest with `globals: true` (no need to import describe/it/expect)
- Strict TypeScript
- No build step for dev (tsx handles runtime transpilation)
- `tsc` is for type checking and producing declarations only
