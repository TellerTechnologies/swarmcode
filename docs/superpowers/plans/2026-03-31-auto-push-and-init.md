# Auto-Push and Init Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-push (background git push on new commits) and `swarmcode init` (append coordination snippet to CLAUDE.md/.cursorrules) to close the "committed but not pushed" blind spot.

**Architecture:** Two new MCP tools (`enable_auto_push`, `disable_auto_push`) backed by a single module with `setInterval`-based polling. One new CLI subcommand (`init`) that appends a markdown snippet to the appropriate AI context file. README and docs updated to reflect the new setup flow.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `child_process.execFileSync`, `commander`, `node:fs`, vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/tools/auto-push.ts` | Create — `enableAutoPush()`, `disableAutoPush()`, interval management, push logic |
| `src/types.ts` | Modify — add `AutoPushResult` and `AutoPushDisableResult` types |
| `src/index.ts` | Modify — export new types |
| `src/git.ts` | Modify — add `getHeadSha()`, `hasRemote()`, `getUpstreamBranch()`, `push()` functions |
| `src/server.ts` | Modify — register 2 new tools, update server instructions |
| `src/cli.ts` | Modify — add `init` subcommand |
| `tests/git.test.ts` | Modify — add tests for new git functions |
| `tests/tools/auto-push.test.ts` | Create — unit tests mocking git.ts |
| `tests/integration/mcp-server.test.ts` | Modify — add auto-push integration tests |
| `README.md` | Modify — updated Quick Start, auto-push section, CLI table |
| `docs/architecture.md` | Modify — add auto-push to module map and tool table |

---

### Task 1: Add git helper functions

**Files:**
- Modify: `src/git.ts`
- Modify: `tests/git.test.ts`

- [ ] **Step 1: Write failing tests for new git functions**

Add to the end of `tests/git.test.ts`:

```typescript
describe('getHeadSha', () => {
  it('returns the current HEAD sha', () => {
    mockExecFileSync.mockReturnValue('abc123def456\n');
    const result = git.getHeadSha();
    expect(result).toBe('abc123def456');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['rev-parse', 'HEAD'], expect.any(Object),
    );
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not a repo'); });
    expect(git.getHeadSha()).toBeNull();
  });
});

describe('hasRemote', () => {
  it('returns true when origin exists', () => {
    mockExecFileSync.mockReturnValue('origin\n');
    expect(git.hasRemote('origin')).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['remote'], expect.any(Object),
    );
  });

  it('returns false when origin does not exist', () => {
    mockExecFileSync.mockReturnValue('upstream\n');
    expect(git.hasRemote('origin')).toBe(false);
  });

  it('returns false on error', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('fail'); });
    expect(git.hasRemote('origin')).toBe(false);
  });
});

describe('getUpstreamBranch', () => {
  it('returns upstream branch when set', () => {
    mockExecFileSync.mockReturnValue('origin/feat/auth\n');
    expect(git.getUpstreamBranch()).toBe('origin/feat/auth');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], expect.any(Object),
    );
  });

  it('returns null when no upstream', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('no upstream'); });
    expect(git.getUpstreamBranch()).toBeNull();
  });
});

describe('push', () => {
  it('pushes with -u when setUpstream is true', () => {
    mockExecFileSync.mockReturnValue('');
    const result = git.push('feat/auth', true);
    expect(result.ok).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['push', '-u', 'origin', 'feat/auth'], expect.any(Object),
    );
  });

  it('pushes without -u when setUpstream is false', () => {
    mockExecFileSync.mockReturnValue('');
    const result = git.push('feat/auth', false);
    expect(result.ok).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['push', 'origin', 'feat/auth'], expect.any(Object),
    );
  });

  it('returns error message on failure', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('rejected') as any;
      err.stderr = 'Updates were rejected because the remote contains work';
      throw err;
    });
    const result = git.push('feat/auth', false);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rejected');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/git.test.ts`
Expected: FAIL — `git.getHeadSha`, `git.hasRemote`, `git.getUpstreamBranch`, `git.push` are not defined

- [ ] **Step 3: Implement the git functions**

Add to the end of `src/git.ts`:

```typescript
export function getHeadSha(): string | null {
  return runOrNull(['rev-parse', 'HEAD']);
}

export function hasRemote(name: string): boolean {
  const output = run(['remote']);
  if (!output) return false;
  return output.split('\n').some((l) => l.trim() === name);
}

export function getUpstreamBranch(): string | null {
  return runOrNull(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
}

export interface PushResult {
  ok: boolean;
  error?: string;
}

export function push(branch: string, setUpstream: boolean): PushResult {
  try {
    const args = setUpstream
      ? ['push', '-u', 'origin', branch]
      : ['push', 'origin', branch];
    execFileSync('git', args, EXEC_OPTS);
    return { ok: true };
  } catch (err: any) {
    const message = err.stderr?.toString() || err.message || 'push failed';
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/git.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "feat: add git helpers for auto-push (getHeadSha, hasRemote, getUpstreamBranch, push)"
```

---

### Task 2: Add auto-push types

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add types to src/types.ts**

Append to the end of `src/types.ts`:

```typescript
export interface AutoPushResult {
  enabled: boolean;
  already_enabled?: boolean;
  branch: string;
  interval: number;
  protected_branches: string[];
}

export interface AutoPushDisableResult {
  enabled: false;
  pushes_made: number;
}
```

- [ ] **Step 2: Export types from src/index.ts**

Add `AutoPushResult` and `AutoPushDisableResult` to the export block in `src/index.ts`.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat: add AutoPushResult and AutoPushDisableResult types"
```

---

### Task 3: Implement auto-push tool

**Files:**
- Create: `src/tools/auto-push.ts`
- Create: `tests/tools/auto-push.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/tools/auto-push.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/git.js');

import * as git from '../../src/git.js';
import { enableAutoPush, disableAutoPush } from '../../src/tools/auto-push.js';

const mockGit = vi.mocked(git);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  // Ensure clean state — disable if previously enabled
  disableAutoPush();
});

afterEach(() => {
  disableAutoPush();
  vi.useRealTimers();
});

describe('enableAutoPush', () => {
  it('returns enabled state with branch and interval', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    const result = enableAutoPush({});

    expect(result).toEqual({
      enabled: true,
      branch: 'feat/auth',
      interval: 5,
      protected_branches: ['main', 'master', 'develop'],
    });
  });

  it('accepts custom interval', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    const result = enableAutoPush({ interval: 10 });

    expect(result.interval).toBe(10);
  });

  it('returns already_enabled when called twice', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({});
    const result = enableAutoPush({});

    expect(result.already_enabled).toBe(true);
  });

  it('throws when no origin remote', () => {
    mockGit.hasRemote.mockReturnValue(false);

    expect(() => enableAutoPush({})).toThrow('No origin remote found');
  });

  it('throws when on protected branch', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('main');

    expect(() => enableAutoPush({})).toThrow('Cannot enable auto-push on protected branch');
  });

  it('throws when on master', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('master');

    expect(() => enableAutoPush({})).toThrow('Cannot enable auto-push on protected branch');
  });

  it('throws when in detached HEAD', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue(null);

    expect(() => enableAutoPush({})).toThrow('Cannot enable auto-push in detached HEAD');
  });

  it('pushes when HEAD changes on interval tick', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue('origin/feat/auth');
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // HEAD changes
    mockGit.getHeadSha.mockReturnValue('def456');
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).toHaveBeenCalledWith('feat/auth', false);
  });

  it('uses -u flag when no upstream exists', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/new');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue(null);
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // HEAD changes
    mockGit.getHeadSha.mockReturnValue('def456');
    mockGit.getCurrentBranch.mockReturnValue('feat/new');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).toHaveBeenCalledWith('feat/new', true);
  });

  it('does not push when HEAD has not changed', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({ interval: 5 });

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('skips push when branch switches to protected branch', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({ interval: 5 });

    // Branch switches to main, HEAD changes
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getHeadSha.mockReturnValue('def456');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('adapts when branch switches to another feature branch', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue('origin/feat/other');
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // Switch to different feature branch, HEAD changes
    mockGit.getCurrentBranch.mockReturnValue('feat/other');
    mockGit.getHeadSha.mockReturnValue('def456');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).toHaveBeenCalledWith('feat/other', false);
  });
});

describe('disableAutoPush', () => {
  it('returns pushes_made count', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue('origin/feat/auth');
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // Trigger 2 pushes
    mockGit.getHeadSha.mockReturnValue('sha1');
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    vi.advanceTimersByTime(5000);

    mockGit.getHeadSha.mockReturnValue('sha2');
    vi.advanceTimersByTime(5000);

    const result = disableAutoPush();

    expect(result).toEqual({ enabled: false, pushes_made: 2 });
  });

  it('returns zero pushes when nothing was pushed', () => {
    const result = disableAutoPush();

    expect(result).toEqual({ enabled: false, pushes_made: 0 });
  });

  it('stops the interval', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({ interval: 5 });
    disableAutoPush();

    // HEAD changes after disable
    mockGit.getHeadSha.mockReturnValue('def456');
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');

    vi.advanceTimersByTime(10000);

    expect(mockGit.push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/auto-push.test.ts`
Expected: FAIL — module `../../src/tools/auto-push.js` not found

- [ ] **Step 3: Implement auto-push**

Create `src/tools/auto-push.ts`:

```typescript
import type { AutoPushResult, AutoPushDisableResult } from '../types.js';
import * as git from '../git.js';

const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastSha: string | null = null;
let pushCount = 0;
let currentInterval = 5;

function tick(): void {
  const branch = git.getCurrentBranch();

  // Skip if detached HEAD or on protected branch
  if (!branch || PROTECTED_BRANCHES.includes(branch)) return;

  const sha = git.getHeadSha();
  if (!sha || sha === lastSha) return;

  // HEAD moved — push
  const hasUpstream = git.getUpstreamBranch() !== null;
  const result = git.push(branch, !hasUpstream);

  if (result.ok) {
    pushCount++;
  } else {
    console.error(`[swarmcode auto-push] push failed: ${result.error}`);
  }

  lastSha = sha;
}

export function enableAutoPush(opts: { interval?: number }): AutoPushResult {
  if (intervalId !== null) {
    const branch = git.getCurrentBranch();
    return {
      enabled: true,
      already_enabled: true,
      branch: branch ?? 'unknown',
      interval: currentInterval,
      protected_branches: PROTECTED_BRANCHES,
    };
  }

  if (!git.hasRemote('origin')) {
    throw new Error('No origin remote found. Auto-push requires a remote named "origin".');
  }

  const branch = git.getCurrentBranch();
  if (!branch) {
    throw new Error('Cannot enable auto-push in detached HEAD state.');
  }

  if (PROTECTED_BRANCHES.includes(branch)) {
    throw new Error(
      `Cannot enable auto-push on protected branch "${branch}". Switch to a feature branch first.`,
    );
  }

  currentInterval = opts.interval ?? 5;
  lastSha = git.getHeadSha();
  pushCount = 0;

  intervalId = setInterval(tick, currentInterval * 1000);

  return {
    enabled: true,
    branch,
    interval: currentInterval,
    protected_branches: PROTECTED_BRANCHES,
  };
}

export function disableAutoPush(): AutoPushDisableResult {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  const result: AutoPushDisableResult = { enabled: false, pushes_made: pushCount };

  lastSha = null;
  pushCount = 0;
  currentInterval = 5;

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/auto-push.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/auto-push.ts tests/tools/auto-push.test.ts
git commit -m "feat: add auto-push tool with enable/disable and interval polling"
```

---

### Task 4: Register auto-push tools in MCP server

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add imports and register tools**

Add to the imports at the top of `src/server.ts`:

```typescript
import { enableAutoPush, disableAutoPush } from './tools/auto-push.js';
```

Add to the server instructions string (after the existing `check_conflicts` line):

```typescript
'- At the start of a session → call enable_auto_push so teammates see your work immediately',
```

Register the two new tools after the existing `get_developer` registration:

```typescript
  server.registerTool(
    'enable_auto_push',
    {
      title: 'Enable Auto-Push',
      description: 'Start automatically pushing new commits to the remote. Teammates will see your work within seconds of committing. Call this at the start of every session.',
      inputSchema: {
        interval: z.number().optional().describe('Seconds between push checks (default: 5)'),
      },
    },
    ({ interval }) => {
      try {
        const result = enableAutoPush({ interval });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
      }
    },
  );

  server.registerTool(
    'disable_auto_push',
    {
      title: 'Disable Auto-Push',
      description: 'Stop automatic pushing. Returns how many pushes were made during the session.',
      inputSchema: {},
    },
    () => {
      const result = disableAutoPush();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run all unit tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: register enable_auto_push and disable_auto_push MCP tools"
```

---

### Task 5: Add init CLI subcommand

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test for init**

Create `tests/cli-init.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let testDir: string;
let originalCwd: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'swarmcode-init-'));
  originalCwd = process.cwd();
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

function runInit(args: string[] = []): string {
  const binPath = join(originalCwd, 'bin', 'swarmcode.ts');
  const tsxPath = join(originalCwd, 'node_modules', '.bin', 'tsx');
  return execFileSync(tsxPath, [binPath, 'init', ...args], {
    encoding: 'utf-8',
    cwd: testDir,
  });
}

describe('swarmcode init', () => {
  it('creates CLAUDE.md with snippet when file does not exist', () => {
    const output = runInit();

    expect(output).toContain('Added swarmcode team coordination');
    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Team Coordination (Swarmcode)');
    expect(content).toContain('enable_auto_push');
    expect(content).toContain('check_path');
  });

  it('appends to existing CLAUDE.md', () => {
    writeFileSync(join(testDir, 'CLAUDE.md'), '# My Project\n\nExisting content.\n');

    const output = runInit();

    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
    expect(content).toContain('## Team Coordination (Swarmcode)');
  });

  it('skips when swarmcode section already exists', () => {
    writeFileSync(join(testDir, 'CLAUDE.md'), '## Team Coordination (Swarmcode)\n\nAlready here.\n');

    const output = runInit();

    expect(output).toContain('already exists');
  });

  it('writes to .cursorrules when --tool cursor', () => {
    const output = runInit(['--tool', 'cursor']);

    expect(existsSync(join(testDir, '.cursorrules'))).toBe(true);
    const content = readFileSync(join(testDir, '.cursorrules'), 'utf-8');
    expect(content).toContain('## Team Coordination (Swarmcode)');
  });

  it('writes to .github/copilot-instructions.md when --tool copilot', () => {
    const output = runInit(['--tool', 'copilot']);

    expect(existsSync(join(testDir, '.github', 'copilot-instructions.md'))).toBe(true);
    const content = readFileSync(join(testDir, '.github', 'copilot-instructions.md'), 'utf-8');
    expect(content).toContain('## Team Coordination (Swarmcode)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cli-init.test.ts`
Expected: FAIL — `init` subcommand not recognized

- [ ] **Step 3: Implement init subcommand**

Add to `src/cli.ts`, after the existing `status` subcommand. First add the import at the top:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
```

Then add the subcommand:

```typescript
  const SWARMCODE_SNIPPET = `## Team Coordination (Swarmcode)

This project uses swarmcode for AI team coordination.

- At the start of every session, call \`enable_auto_push\` and \`get_team_activity\`
- Before creating or modifying any file, call \`check_path\`
- Before implementing a function/type/component, call \`search_team_code\`
- Never rebuild something a teammate already built — import it
- If check_path returns high risk, stop and ask the developer before proceeding
`;

  const TOOL_FILES: Record<string, string> = {
    'claude-code': 'CLAUDE.md',
    'cursor': '.cursorrules',
    'copilot': '.github/copilot-instructions.md',
  };

  program
    .command('init')
    .description('Add team coordination rules to your AI context file')
    .option('--tool <tool>', 'AI tool (claude-code, cursor, copilot)', 'claude-code')
    .action((options) => {
      const tool = options.tool as string;
      const filePath = TOOL_FILES[tool];

      if (!filePath) {
        console.error(`Unknown tool: ${tool}. Use claude-code, cursor, or copilot.`);
        process.exitCode = 1;
        return;
      }

      // Create parent directory if needed (for copilot's .github/)
      const dir = dirname(filePath);
      if (dir !== '.' && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (existsSync(filePath)) {
        const existing = readFileSync(filePath, 'utf-8');
        if (existing.includes('## Team Coordination (Swarmcode)')) {
          console.log(`Swarmcode section already exists in ${filePath}`);
          return;
        }
        writeFileSync(filePath, existing.trimEnd() + '\n\n' + SWARMCODE_SNIPPET);
      } else {
        writeFileSync(filePath, SWARMCODE_SNIPPET);
      }

      console.log(`Added swarmcode team coordination to ${filePath}`);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cli-init.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli-init.test.ts
git commit -m "feat: add swarmcode init command for AI context file setup"
```

---

### Task 6: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the Quick Start section**

Replace the current Quick Start section with:

```markdown
## Quick Start

### 1. Install

```bash
git clone https://github.com/TellerTechnologies/swarmcode.git
cd swarmcode
npm install
npm link
```

### 2. Initialize (once per project)

In your project directory:

```bash
swarmcode init
```

This appends team coordination rules to your `CLAUDE.md`. Your AI will know to check what teammates are building before creating files or implementing functions.

For other AI tools:

```bash
swarmcode init --tool cursor    # writes to .cursorrules
swarmcode init --tool copilot   # writes to .github/copilot-instructions.md
```

The init command only needs to run once — commit the context file so all teammates get the rules.

### 3. Add to your AI client's MCP config

**Claude Code** (`~/.claude/settings.json` or project `.mcp.json`):
```json
{
  "mcpServers": {
    "swarmcode": {
      "command": "swarmcode"
    }
  }
}
```

**Cursor** (MCP settings):
```json
{
  "mcpServers": {
    "swarmcode": {
      "command": "swarmcode"
    }
  }
}
```

### 4. Everyone else does the same

Each teammate: install swarmcode, add the MCP config. The `swarmcode init` step only needs to happen once per project — the context file is committed to git so everyone gets it.
```

- [ ] **Step 2: Rename "The 5 Tools" to "Tools" and add auto-push**

Replace the tools section with:

```markdown
## Tools

Your AI calls these automatically based on server instructions and context file rules:

| Tool | When it's called | What it does |
|------|-----------------|-------------|
| `get_team_activity` | Start of session | Shows active contributors, their branches, and work areas |
| `check_path` | Before creating/modifying a file | Returns who owns this area, pending changes, risk assessment |
| `search_team_code` | Before implementing something | Finds existing exports (functions, classes, types) across the codebase |
| `check_conflicts` | Proactive health check | Detects files modified on multiple branches that may conflict |
| `get_developer` | Drill-down on a teammate | Shows a developer's recent commits, branches, and work areas |
| `enable_auto_push` | Start of session | Automatically pushes new commits so teammates see your work immediately |
| `disable_auto_push` | End of session (optional) | Stops auto-push and reports how many pushes were made |

All read tools are **read-only**. Auto-push is the only write operation — it runs `git push`, never `git commit` or `git push --force`.
```

- [ ] **Step 3: Add Auto-Push section**

Add after the Tools section:

```markdown
## Auto-Push

The biggest limitation of git-based coordination is the gap between committing and pushing. If your AI commits locally but doesn't push, teammates can't see your work.

Auto-push closes this gap. When enabled, swarmcode watches for new local commits and pushes them to the remote within seconds. Your AI calls `enable_auto_push` at the start of every session (the CLAUDE.md rules tell it to).

**What it does:**
- Polls for new commits every 5 seconds (configurable)
- Pushes to the current branch's remote tracking branch
- Creates the remote tracking branch automatically for new local branches
- Skips protected branches (main, master, develop)

**What it doesn't do:**
- Never creates commits — only pushes existing ones
- Never force-pushes
- Never pulls or rebases
- Never touches other branches
```

- [ ] **Step 4: Update the CLI section**

Replace the CLI section with:

```markdown
## CLI

```bash
# Start MCP server (used by AI clients, not typically run manually)
swarmcode

# Add coordination rules to your AI context file
swarmcode init
swarmcode init --tool cursor
swarmcode init --tool copilot

# Check team activity from the terminal
swarmcode status
swarmcode status --since 7d
```
```

- [ ] **Step 5: Update the "How It Differs from v1" section**

Add this line to the bullet list:

```markdown
- **`swarmcode init` is back** — but instead of creating config directories, it just appends one markdown section to your AI context file
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: update README with auto-push, init command, and revised setup flow"
```

---

### Task 7: Update architecture and development docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Update architecture.md module map**

Add `auto-push.ts` to the module map in `docs/architecture.md`:

```
│
├── tools/
│   ├── get-team-activity.ts   git log → group by author → work areas, branches
│   ├── check-path.ts          git log + branch diffs → ownership + risk assessment
│   ├── search-team-code.ts    source-parser + git metadata → export search with context
│   ├── check-conflicts.ts     branch diffs → overlapping file changes
│   ├── get-developer.ts       git log --author → developer profile with fuzzy match
│   └── auto-push.ts           setInterval + git push → auto-push new commits
```

- [ ] **Step 2: Update architecture.md tool table**

Add two rows to "The 5 tools" table (rename to "The 7 tools" or just "Tools"):

```
| `enable_auto_push` | Start of session | `git rev-parse HEAD` (poll), `git push` |
| `disable_auto_push` | End of session (optional) | Clears interval |
```

- [ ] **Step 3: Update "What's NOT here" section**

Change `- **No background processes** — the server is purely reactive` to:

```
- **Minimal background activity** — only auto-push runs a polling interval; all read tools are purely reactive
```

- [ ] **Step 4: Update development.md test structure**

Add to the test structure tree:

```
│   ├── auto-push.test.ts          Mocks git.ts, tests interval polling and push logic
```

And add `cli-init.test.ts`:

```
├── cli-init.test.ts               Runs real CLI against temp directories
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/development.md
git commit -m "docs: update architecture and development guide for auto-push and init"
```

---

### Task 8: Integration tests

**Files:**
- Modify: `tests/integration/mcp-server.test.ts`

- [ ] **Step 1: Add auto-push integration test**

Add import at the top with other tool imports:

```typescript
import { enableAutoPush, disableAutoPush } from '../../src/tools/auto-push.js';
```

Add tests inside the existing `describe` block. These tests need a remote, so create a bare remote repo in `beforeAll`:

```typescript
  // Auto-push tests need a remote. Create a bare repo as "origin" and add it.
  describe('auto-push with remote', () => {
    let bareDir: string;

    beforeAll(() => {
      bareDir = mkdtempSync(join(tmpdir(), 'swarmcode-bare-'));
      gitIn(bareDir, ['init', '--bare']);

      // Add as remote to the test repo
      gitIn(repoDir, ['remote', 'add', 'origin', bareDir]);

      // Push main to origin so it exists
      gitIn(repoDir, ['push', '-u', 'origin', 'main']);
    });

    afterAll(() => {
      // Clean up: remove origin so it doesn't affect other tests
      gitIn(repoDir, ['remote', 'remove', 'origin']);
    });

    it('enable_auto_push succeeds on a feature branch', () => {
      gitIn(repoDir, ['checkout', '-b', 'feat/auto-push-test']);
      try {
        const result = enableAutoPush({});
        expect(result.enabled).toBe(true);
        expect(result.branch).toBe('feat/auto-push-test');
        expect(result.interval).toBe(5);
      } finally {
        disableAutoPush();
        gitIn(repoDir, ['checkout', 'main']);
        gitIn(repoDir, ['branch', '-D', 'feat/auto-push-test']);
      }
    });

    it('enable_auto_push rejects protected branch', () => {
      expect(() => enableAutoPush({})).toThrow('protected branch');
    });

    it('disable_auto_push returns zero pushes when nothing happened', () => {
      const result = disableAutoPush();
      expect(result.enabled).toBe(false);
      expect(result.pushes_made).toBe(0);
    });
  });
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run --config vitest.integration.config.ts`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/mcp-server.test.ts
git commit -m "test: add auto-push integration tests with bare remote"
```
