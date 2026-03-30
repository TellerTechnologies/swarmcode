# Swarmcode MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace swarmcode's file-injection architecture with a stateless MCP server that coordinates AI coding assistants using git history and source analysis.

**Architecture:** A single stdio MCP server process spawned by the AI client. Five read-only tools query git commands and source files on demand. No background processes, no state files, no manifests. The git repo is the shared state.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, `child_process.execFileSync`, vitest

**Spec:** `docs/superpowers/specs/2026-03-29-mcp-server-design.md`

---

## File Structure

```
src/
├── server.ts              # MCP server setup, stdio transport, tool registration
├── types.ts               # New types for MCP server (replaces old types.ts entirely)
├── git.ts                 # Git query layer — all git commands go through here
├── source-parser.ts       # Export search — regex grep over source files
├── tools/
│   ├── get-team-activity.ts
│   ├── check-path.ts
│   ├── search-team-code.ts
│   ├── check-conflicts.ts
│   └── get-developer.ts
├── cli.ts                 # Simplified CLI: default=MCP server, `status` subcommand
└── index.ts               # Public exports (version + types)

bin/
├── swarmcode.js           # Entry point (modified to use tsx)
└── swarmcode.ts           # Delegates to cli.ts

tests/
├── git.test.ts
├── source-parser.test.ts
├── tools/
│   ├── get-team-activity.test.ts
│   ├── check-path.test.ts
│   ├── search-team-code.test.ts
│   ├── check-conflicts.test.ts
│   └── get-developer.test.ts
└── integration/
    └── mcp-server.test.ts
```

---

### Task 1: Delete old code and update dependencies

**Files:**
- Delete: `src/agent.ts`, `src/watcher.ts`, `src/config.ts`, `src/types.ts`, `src/index.ts`
- Delete: `src/manifest/reader.ts`, `src/manifest/writer.ts`
- Delete: `src/injector/injector.ts`, `src/injector/formatter.ts`
- Delete: `src/sync/git-sync.ts`
- Delete: `src/extractor/rich.ts`
- Delete: `src/llm/anthropic.ts`, `src/llm/openai.ts`, `src/llm/provider.ts`
- Delete: `src/plan/parser.ts`
- Delete: all files in `tests/` (old tests for deleted modules)
- Modify: `package.json`

- [ ] **Step 1: Delete old source files**

```bash
rm -rf src/agent.ts src/watcher.ts src/config.ts src/types.ts src/index.ts
rm -rf src/manifest src/injector src/sync src/llm src/plan
rm -f src/extractor/rich.ts
```

- [ ] **Step 2: Delete old tests**

```bash
rm -rf tests/
mkdir -p tests/tools tests/integration
```

- [ ] **Step 3: Remove old dependencies and add new ones**

```bash
npm uninstall chokidar yaml @anthropic-ai/sdk openai
npm install @modelcontextprotocol/sdk zod
```

- [ ] **Step 4: Update package.json metadata**

Change `package.json` name and description:

```json
{
  "name": "swarmcode",
  "version": "2.0.0",
  "description": "MCP server that coordinates AI coding assistants using git",
  "main": "src/index.ts",
  "type": "module",
  "bin": {
    "swarmcode": "./bin/swarmcode.js"
  }
}
```

Keep `scripts`, `devDependencies`, `commander`, `tsx`, and `typescript` as-is.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete old architecture, update deps for MCP server"
```

---

### Task 2: New types and index

**Files:**
- Create: `src/types.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Create src/types.ts**

```typescript
export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
  files: string[];
}

export interface AuthorActivity {
  name: string;
  active_branches: string[];
  work_areas: string[];
  recent_files: string[];
  last_active: number;
  recent_commits: Array<{ message: string; timestamp: number }>;
}

export interface PathAuthor {
  name: string;
  commit_count: number;
  last_commit: number;
}

export interface PendingChange {
  branch: string;
  author: string;
  files: string[];
}

export type RiskLevel = 'safe' | 'caution' | 'conflict_likely';

export interface PathCheckResult {
  recent_authors: PathAuthor[];
  primary_owner: string | null;
  pending_changes: PendingChange[];
  locally_modified: boolean;
  risk: RiskLevel;
  risk_reason: string;
}

export interface ExportMatch {
  file: string;
  name: string;
  signature: string;
  last_modified_by: string;
  last_modified_at: number;
  in_flux: boolean;
}

export interface ConflictEntry {
  file: string;
  branches: Array<{ branch: string; author: string }>;
  local: boolean;
  severity: 'low' | 'high';
}

export interface ConflictReport {
  conflicts: ConflictEntry[];
  summary: string;
}

export interface DeveloperProfile {
  name: string;
  recent_commits: Array<{
    hash: string;
    message: string;
    timestamp: number;
    files: string[];
  }>;
  active_branches: string[];
  work_areas: string[];
  files: string[];
}
```

- [ ] **Step 2: Create src/index.ts**

```typescript
export const VERSION = '2.0.0';

export type {
  GitCommit,
  AuthorActivity,
  PathAuthor,
  PendingChange,
  RiskLevel,
  PathCheckResult,
  ExportMatch,
  ConflictEntry,
  ConflictReport,
  DeveloperProfile,
} from './types.js';
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/index.ts
git commit -m "feat: add new types for MCP server"
```

---

### Task 3: Git query layer

**Files:**
- Create: `src/git.ts`
- Create: `tests/git.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/git.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as cp from 'node:child_process';
import {
  getRepoRoot,
  getCurrentUser,
  getCurrentBranch,
  getActiveRemoteBranches,
  getLog,
  getFilesChangedOnBranch,
  getLocallyModifiedFiles,
  getMergeBase,
  getBranchAuthor,
  getAllAuthors,
} from '../src/git.js';

vi.mock('node:child_process');
const mockExecFileSync = vi.mocked(cp.execFileSync);

describe('git', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getRepoRoot', () => {
    it('returns trimmed repo root path', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('/home/user/project\n'));
      expect(getRepoRoot()).toBe('/home/user/project');
    });

    it('returns null if not a git repo', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });
      expect(getRepoRoot()).toBeNull();
    });
  });

  describe('getCurrentUser', () => {
    it('returns git user.name', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('Jared\n'));
      expect(getCurrentUser()).toBe('Jared');
    });

    it('returns null if not configured', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no user.name');
      });
      expect(getCurrentUser()).toBeNull();
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch name', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('main\n'));
      expect(getCurrentBranch()).toBe('main');
    });

    it('returns null on detached HEAD', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('HEAD\n'));
      expect(getCurrentBranch()).toBe(null);
    });
  });

  describe('getLog', () => {
    it('parses multi-commit log with files', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(
        'abc123|Alice|alice@example.com|1711900000|feat: add login\n' +
        'src/auth/login.ts\n' +
        'src/auth/types.ts\n' +
        '\n' +
        'def456|Bob|bob@example.com|1711800000|fix: typo\n' +
        'README.md\n'
      ));
      const commits = getLog({ since: '24h' });
      expect(commits).toHaveLength(2);
      expect(commits[0]).toEqual({
        hash: 'abc123',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1711900000,
        message: 'feat: add login',
        files: ['src/auth/login.ts', 'src/auth/types.ts'],
      });
      expect(commits[1]).toEqual({
        hash: 'def456',
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 1711800000,
        message: 'fix: typo',
        files: ['README.md'],
      });
    });

    it('returns empty array for empty repo', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      expect(getLog({})).toEqual([]);
    });

    it('passes --all flag when all=true', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      getLog({ all: true, since: '7d' });
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args).toContain('--all');
      expect(args).toContain('--since=7d');
    });

    it('passes --author flag when author is set', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      getLog({ author: 'Alice' });
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args).toContain('--author=Alice');
    });

    it('passes -- path when path is set', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(''));
      getLog({ path: 'src/auth' });
      const args = mockExecFileSync.mock.calls[0][1] as string[];
      expect(args).toContain('--');
      expect(args).toContain('src/auth');
    });
  });

  describe('getActiveRemoteBranches', () => {
    it('parses remote branches', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(
        '  origin/main\n  origin/feat/auth\n  origin/HEAD -> origin/main\n'
      ));
      const branches = getActiveRemoteBranches();
      expect(branches).toEqual(['origin/main', 'origin/feat/auth']);
    });

    it('returns empty array when no remote', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no remote');
      });
      expect(getActiveRemoteBranches()).toEqual([]);
    });
  });

  describe('getFilesChangedOnBranch', () => {
    it('returns list of changed files', () => {
      // First call: merge-base, second call: diff
      mockExecFileSync
        .mockReturnValueOnce(Buffer.from('abc123\n'))
        .mockReturnValueOnce(Buffer.from('src/auth/login.ts\nsrc/auth/types.ts\n'));
      const files = getFilesChangedOnBranch('main', 'origin/feat/auth');
      expect(files).toEqual(['src/auth/login.ts', 'src/auth/types.ts']);
    });

    it('returns empty array when merge-base fails', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no merge base');
      });
      expect(getFilesChangedOnBranch('main', 'origin/feat/auth')).toEqual([]);
    });
  });

  describe('getLocallyModifiedFiles', () => {
    it('parses git status porcelain output', () => {
      mockExecFileSync.mockReturnValue(Buffer.from(
        ' M src/index.ts\n?? new-file.ts\nA  staged.ts\n'
      ));
      const files = getLocallyModifiedFiles();
      expect(files).toEqual(['src/index.ts', 'new-file.ts', 'staged.ts']);
    });
  });

  describe('getMergeBase', () => {
    it('returns merge base commit', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('abc123\n'));
      expect(getMergeBase('main', 'origin/feat/auth')).toBe('abc123');
    });

    it('returns null on error', () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('no common ancestor');
      });
      expect(getMergeBase('main', 'origin/feat/auth')).toBeNull();
    });
  });

  describe('getBranchAuthor', () => {
    it('returns author of most recent commit on branch', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('Alice\n'));
      expect(getBranchAuthor('origin/feat/auth')).toBe('Alice');
    });
  });

  describe('getAllAuthors', () => {
    it('returns deduplicated author list', () => {
      mockExecFileSync.mockReturnValue(Buffer.from('Alice\nBob\nAlice\n'));
      expect(getAllAuthors()).toEqual(['Alice', 'Bob']);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/git.test.ts`
Expected: FAIL — `src/git.ts` does not exist

- [ ] **Step 3: Implement src/git.ts**

```typescript
import { execFileSync } from 'node:child_process';
import type { GitCommit } from './types.js';

function run(args: string[], cwd?: string): string {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return '';
  }
}

function runOrNull(args: string[], cwd?: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return null;
  }
}

export function getRepoRoot(): string | null {
  return runOrNull(['rev-parse', '--show-toplevel']);
}

export function getCurrentUser(): string | null {
  return runOrNull(['config', 'user.name']);
}

export function getCurrentBranch(): string | null {
  const branch = runOrNull(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD') return null;
  return branch;
}

export interface LogOptions {
  all?: boolean;
  since?: string;
  author?: string;
  path?: string;
}

export function getLog(opts: LogOptions): GitCommit[] {
  const args = ['log', '--format=%H|%an|%ae|%at|%s', '--name-only', '--no-merges'];
  if (opts.all) args.push('--all');
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.author) args.push(`--author=${opts.author}`);
  if (opts.path) {
    args.push('--');
    args.push(opts.path);
  }

  const output = run(args);
  if (!output) return [];

  const commits: GitCommit[] = [];
  const blocks = output.split('\n\n');

  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length === 0) continue;

    const header = lines[0];
    const parts = header.split('|');
    if (parts.length < 5) continue;

    commits.push({
      hash: parts[0],
      author: parts[1],
      email: parts[2],
      timestamp: parseInt(parts[3], 10),
      message: parts.slice(4).join('|'),
      files: lines.slice(1),
    });
  }

  return commits;
}

export function getActiveRemoteBranches(): string[] {
  const output = run(['branch', '-r', '--sort=-committerdate']);
  if (!output) return [];

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.includes('->'));
}

export function getMergeBase(branch1: string, branch2: string): string | null {
  return runOrNull(['merge-base', branch1, branch2]);
}

export function getFilesChangedOnBranch(currentBranch: string, remoteBranch: string): string[] {
  const base = getMergeBase(currentBranch, remoteBranch);
  if (!base) return [];

  const output = run(['diff', '--name-only', `${base}..${remoteBranch}`]);
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

export function getLocallyModifiedFiles(path?: string): string[] {
  const args = ['status', '--porcelain'];
  if (path) {
    args.push('--');
    args.push(path);
  }
  const output = run(args);
  if (!output) return [];

  return output
    .split('\n')
    .filter(Boolean)
    .map(line => line.slice(3).trim());
}

export function getBranchAuthor(branch: string): string | null {
  return runOrNull(['log', '-1', '--format=%an', branch]);
}

export function getAllAuthors(): string[] {
  const output = run(['log', '--all', '--format=%an']);
  if (!output) return [];
  return [...new Set(output.split('\n').filter(Boolean))];
}

export function getLastModifier(filePath: string): { author: string; timestamp: number } | null {
  const output = runOrNull(['log', '-1', '--format=%an|%at', '--', filePath]);
  if (!output) return null;
  const [author, ts] = output.split('|');
  return { author, timestamp: parseInt(ts, 10) };
}

export function getStatusForPath(path: string): string[] {
  const output = run(['status', '--porcelain', '--', path]);
  if (!output) return [];
  return output.split('\n').filter(Boolean).map(line => line.slice(3).trim());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/git.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/git.ts tests/git.test.ts
git commit -m "feat: add git query layer"
```

---

### Task 4: Source parser

**Files:**
- Rename: `src/extractor/fast.ts` → `src/source-parser.ts` (rewrite for search use case)
- Delete: `src/extractor/` directory
- Create: `tests/source-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/source-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { searchExports, detectLanguage } from '../src/source-parser.js';

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript');
    expect(detectLanguage('foo.tsx')).toBe('typescript');
  });

  it('detects JavaScript', () => {
    expect(detectLanguage('foo.js')).toBe('javascript');
    expect(detectLanguage('foo.mjs')).toBe('javascript');
  });

  it('detects Python', () => {
    expect(detectLanguage('foo.py')).toBe('python');
  });

  it('returns null for unknown', () => {
    expect(detectLanguage('foo.rs')).toBeNull();
    expect(detectLanguage('foo.md')).toBeNull();
  });
});

describe('searchExports', () => {
  describe('TypeScript/JavaScript', () => {
    it('finds named function export matching query', () => {
      const code = `export function login(user: string): Promise<Token> {\n  return fetch(...);\n}`;
      const results = searchExports(code, 'typescript', 'login');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('login');
      expect(results[0].signature).toContain('login');
    });

    it('finds named const export', () => {
      const code = `export const DEFAULT_TIMEOUT = 5000;`;
      const results = searchExports(code, 'typescript', 'DEFAULT_TIMEOUT');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('DEFAULT_TIMEOUT');
    });

    it('finds class export', () => {
      const code = `export class UserService {\n  constructor() {}\n}`;
      const results = searchExports(code, 'typescript', 'UserService');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('UserService');
    });

    it('finds interface export', () => {
      const code = `export interface AuthConfig {\n  secret: string;\n}`;
      const results = searchExports(code, 'typescript', 'AuthConfig');
      expect(results).toHaveLength(1);
    });

    it('finds type export', () => {
      const code = `export type Role = 'admin' | 'user';`;
      const results = searchExports(code, 'typescript', 'Role');
      expect(results).toHaveLength(1);
    });

    it('finds default named export', () => {
      const code = `export default function Dashboard() {\n  return <div/>;\n}`;
      const results = searchExports(code, 'typescript', 'Dashboard');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Dashboard');
    });

    it('finds async function export', () => {
      const code = `export async function fetchUser(id: string) {\n  return db.get(id);\n}`;
      const results = searchExports(code, 'typescript', 'fetchUser');
      expect(results).toHaveLength(1);
    });

    it('returns empty array when no match', () => {
      const code = `export function login() {}\nexport function logout() {}`;
      const results = searchExports(code, 'typescript', 'signup');
      expect(results).toEqual([]);
    });

    it('is case-insensitive for matching', () => {
      const code = `export function formatDate(d: Date): string { return ''; }`;
      const results = searchExports(code, 'typescript', 'formatdate');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('formatDate');
    });

    it('matches partial query as substring', () => {
      const code = `export function formatDate() {}\nexport function formatTime() {}`;
      const results = searchExports(code, 'typescript', 'format');
      expect(results).toHaveLength(2);
    });
  });

  describe('Python', () => {
    it('finds top-level function matching query', () => {
      const code = `def authenticate(username, password):\n    pass`;
      const results = searchExports(code, 'python', 'authenticate');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('authenticate');
    });

    it('finds top-level class', () => {
      const code = `class UserModel(Base):\n    pass`;
      const results = searchExports(code, 'python', 'UserModel');
      expect(results).toHaveLength(1);
    });

    it('ignores indented definitions', () => {
      const code = `class Outer:\n    def inner_method(self):\n        pass\ndef standalone():\n    pass`;
      const results = searchExports(code, 'python', 'inner_method');
      expect(results).toEqual([]);
    });
  });

  describe('unknown language', () => {
    it('returns empty array', () => {
      const results = searchExports('fn main() {}', 'rust', 'main');
      expect(results).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/source-parser.test.ts`
Expected: FAIL — `src/source-parser.ts` does not exist

- [ ] **Step 3: Delete old extractor directory**

```bash
rm -rf src/extractor
```

- [ ] **Step 4: Implement src/source-parser.ts**

```typescript
export interface ExportSearchResult {
  name: string;
  signature: string;
}

export function detectLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    default:
      return null;
  }
}

export function searchExports(
  code: string,
  language: string,
  query: string,
): ExportSearchResult[] {
  if (!code || !query) return [];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return searchJsTs(code, query);
    case 'python':
      return searchPython(code, query);
    default:
      return [];
  }
}

function matchesQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

function cleanSignature(raw: string, kind: string, name: string): string {
  let sig = raw.replace(/\s*\{.*$/, '').trim();

  if (kind === 'function') {
    const parenClose = sig.lastIndexOf(')');
    if (parenClose !== -1) {
      sig = sig.slice(0, parenClose + 1).trim();
    }
  } else if (kind === 'const' || kind === 'let' || kind === 'var' || kind === 'type') {
    const eq = sig.indexOf('=');
    if (eq !== -1) {
      sig = sig.slice(0, eq).trim();
    }
  }

  return sig || `export ${kind} ${name}`;
}

function searchJsTs(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // 1. export default function/class <name>
  const defaultNamedRe = /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm;
  for (const m of code.matchAll(defaultNamedRe)) {
    if (matchesQuery(m[1], query)) {
      results.push({ name: m[1], signature: m[0].trim() });
    }
  }

  // 2. export [async] [declare] function|class|interface|type|const|let|var <name>
  const namedRe =
    /^export\s+(?:declare\s+)?(?!default)(?:async\s+)?(function|class|interface|type|const|let|var)\s+(\w+)/gm;
  for (const m of code.matchAll(namedRe)) {
    const kind = m[1];
    const name = m[2];
    if (!matchesQuery(name, query)) continue;

    const startIdx = m.index ?? 0;
    const lineEnd = code.indexOf('\n', startIdx);
    const rawLine = lineEnd === -1 ? code.slice(startIdx) : code.slice(startIdx, lineEnd);
    const signature = cleanSignature(rawLine, kind, name);
    results.push({ name, signature });
  }

  return results;
}

function searchPython(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  const defClassRe = /^(def|class)\s+(\w+)([^:]*)/gm;
  for (const m of code.matchAll(defClassRe)) {
    const kind = m[1];
    const name = m[2];
    if (!matchesQuery(name, query)) continue;

    const rest = m[3].trim();
    const signature = kind === 'def' ? `def ${name}${rest}` : `class ${name}${rest}`;
    results.push({ name, signature });
  }

  return results;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/source-parser.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/source-parser.ts tests/source-parser.test.ts
git commit -m "feat: add source parser for export search"
```

---

### Task 5: get_team_activity tool

**Files:**
- Create: `src/tools/get-team-activity.ts`
- Create: `tests/tools/get-team-activity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/get-team-activity.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from '../../src/git.js';
import { getTeamActivity } from '../../src/tools/get-team-activity.js';

vi.mock('../../src/git.js');
const mockGit = vi.mocked(git);

describe('getTeamActivity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.getCurrentUser.mockReturnValue('Jared');
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/main', 'origin/feat/auth']);
  });

  it('groups commits by author and excludes current user', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: 'a@x.com', timestamp: 1000, message: 'feat: login', files: ['src/auth/login.ts'] },
      { hash: 'a2', author: 'Alice', email: 'a@x.com', timestamp: 900, message: 'feat: types', files: ['src/auth/types.ts'] },
      { hash: 'b1', author: 'Bob', email: 'b@x.com', timestamp: 800, message: 'fix: readme', files: ['README.md'] },
      { hash: 'j1', author: 'Jared', email: 'j@x.com', timestamp: 700, message: 'chore: cleanup', files: ['src/index.ts'] },
    ]);

    const result = getTeamActivity({ since: '24h' });

    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['Alice', 'Bob']);
    expect(result.map(r => r.name)).not.toContain('Jared');
  });

  it('infers work areas from file paths', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: 'a@x.com', timestamp: 1000, message: 'feat', files: ['src/auth/login.ts'] },
      { hash: 'a2', author: 'Alice', email: 'a@x.com', timestamp: 900, message: 'feat', files: ['src/auth/types.ts', 'src/auth/middleware.ts'] },
    ]);

    const result = getTeamActivity({ since: '24h' });

    expect(result[0].work_areas).toContain('src/auth');
  });

  it('collects active branches per author', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: 'a@x.com', timestamp: 1000, message: 'feat', files: ['src/login.ts'] },
    ]);
    mockGit.getBranchAuthor.mockImplementation((branch) =>
      branch === 'origin/feat/auth' ? 'Alice' : 'Jared'
    );

    const result = getTeamActivity({ since: '24h' });

    expect(result[0].active_branches).toContain('origin/feat/auth');
  });

  it('returns empty array when no commits', () => {
    mockGit.getLog.mockReturnValue([]);
    expect(getTeamActivity({ since: '24h' })).toEqual([]);
  });

  it('sorts authors by most recent activity first', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'b1', author: 'Bob', email: 'b@x.com', timestamp: 500, message: 'old', files: ['a.ts'] },
      { hash: 'a1', author: 'Alice', email: 'a@x.com', timestamp: 1000, message: 'new', files: ['b.ts'] },
    ]);

    const result = getTeamActivity({ since: '7d' });

    expect(result[0].name).toBe('Alice');
    expect(result[1].name).toBe('Bob');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/get-team-activity.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement src/tools/get-team-activity.ts**

```typescript
import type { AuthorActivity } from '../types.js';
import * as git from '../git.js';

function inferWorkAreas(files: string[]): string[] {
  const dirCounts = new Map<string, number>();

  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
  }

  return [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir]) => dir)
    .slice(0, 5);
}

export function getTeamActivity(params: { since: string }): AuthorActivity[] {
  const currentUser = git.getCurrentUser();
  const commits = git.getLog({ all: true, since: params.since });

  if (commits.length === 0) return [];

  const byAuthor = new Map<string, typeof commits>();
  for (const commit of commits) {
    if (commit.author === currentUser) continue;
    const list = byAuthor.get(commit.author) ?? [];
    list.push(commit);
    byAuthor.set(commit.author, list);
  }

  const remoteBranches = git.getActiveRemoteBranches();

  const results: AuthorActivity[] = [];

  for (const [author, authorCommits] of byAuthor) {
    const allFiles = authorCommits.flatMap(c => c.files);
    const uniqueFiles = [...new Set(allFiles)];

    const activeBranches = remoteBranches.filter(
      branch => git.getBranchAuthor(branch) === author
    );

    results.push({
      name: author,
      active_branches: activeBranches,
      work_areas: inferWorkAreas(allFiles),
      recent_files: uniqueFiles.slice(0, 20),
      last_active: Math.max(...authorCommits.map(c => c.timestamp)),
      recent_commits: authorCommits.slice(0, 5).map(c => ({
        message: c.message,
        timestamp: c.timestamp,
      })),
    });
  }

  results.sort((a, b) => b.last_active - a.last_active);
  return results;
}
```

- [ ] **Step 4: Create the tools directory**

```bash
mkdir -p src/tools
```

(Do this before saving the file, or the write will create it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tools/get-team-activity.test.ts`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/get-team-activity.ts tests/tools/get-team-activity.test.ts
git commit -m "feat: add get_team_activity tool"
```

---

### Task 6: check_path tool

**Files:**
- Create: `src/tools/check-path.ts`
- Create: `tests/tools/check-path.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/check-path.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from '../../src/git.js';
import { checkPath } from '../../src/tools/check-path.js';

vi.mock('../../src/git.js');
const mockGit = vi.mocked(git);

describe('checkPath', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getActiveRemoteBranches.mockReturnValue([]);
    mockGit.getStatusForPath.mockReturnValue([]);
  });

  it('returns safe when no recent authors and no pending changes', () => {
    mockGit.getLog.mockReturnValue([]);
    const result = checkPath({ path: 'src/utils/format.ts' });
    expect(result.risk).toBe('safe');
    expect(result.recent_authors).toEqual([]);
    expect(result.primary_owner).toBeNull();
  });

  it('identifies primary owner from recent commits', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/auth/login.ts'] },
      { hash: 'a2', author: 'Alice', email: '', timestamp: 900, message: 'fix', files: ['src/auth/login.ts'] },
      { hash: 'b1', author: 'Bob', email: '', timestamp: 800, message: 'chore', files: ['src/auth/login.ts'] },
    ]);

    const result = checkPath({ path: 'src/auth/login.ts' });

    expect(result.primary_owner).toBe('Alice');
    expect(result.recent_authors).toHaveLength(2);
    expect(result.recent_authors[0].name).toBe('Alice');
    expect(result.recent_authors[0].commit_count).toBe(2);
  });

  it('returns caution when another branch has changes to this path', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/auth/login.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    const result = checkPath({ path: 'src/auth/login.ts' });

    expect(result.risk).toBe('caution');
    expect(result.pending_changes).toHaveLength(1);
    expect(result.pending_changes[0].branch).toBe('origin/feat/auth');
    expect(result.pending_changes[0].author).toBe('Alice');
  });

  it('returns conflict_likely when multiple branches modify the path', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth', 'origin/feat/login']);
    mockGit.getFilesChangedOnBranch.mockImplementation((_current, branch) => {
      if (branch === 'origin/feat/auth') return ['src/auth/login.ts'];
      if (branch === 'origin/feat/login') return ['src/auth/login.ts'];
      return [];
    });
    mockGit.getBranchAuthor.mockImplementation((branch) =>
      branch === 'origin/feat/auth' ? 'Alice' : 'Bob'
    );

    const result = checkPath({ path: 'src/auth/login.ts' });

    expect(result.risk).toBe('conflict_likely');
    expect(result.pending_changes).toHaveLength(2);
  });

  it('detects locally modified files', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getStatusForPath.mockReturnValue(['src/auth/login.ts']);

    const result = checkPath({ path: 'src/auth/login.ts' });

    expect(result.locally_modified).toBe(true);
  });

  it('skips current branch in remote branch check', () => {
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/main', 'origin/feat/auth']);
    mockGit.getLog.mockReturnValue([]);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/auth/login.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    const result = checkPath({ path: 'src/auth/login.ts' });

    // origin/main should be skipped because current branch is main
    expect(result.pending_changes).toHaveLength(1);
    expect(result.pending_changes[0].branch).toBe('origin/feat/auth');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/check-path.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement src/tools/check-path.ts**

```typescript
import type { PathCheckResult, PathAuthor, PendingChange, RiskLevel } from '../types.js';
import * as git from '../git.js';

export function checkPath(params: { path: string }): PathCheckResult {
  const currentBranch = git.getCurrentBranch();

  // Recent authors for this path
  const commits = git.getLog({ all: true, since: '7d', path: params.path });
  const authorMap = new Map<string, { count: number; lastCommit: number }>();

  for (const commit of commits) {
    const existing = authorMap.get(commit.author);
    if (existing) {
      existing.count++;
      existing.lastCommit = Math.max(existing.lastCommit, commit.timestamp);
    } else {
      authorMap.set(commit.author, { count: 1, lastCommit: commit.timestamp });
    }
  }

  const recent_authors: PathAuthor[] = [...authorMap.entries()]
    .map(([name, data]) => ({
      name,
      commit_count: data.count,
      last_commit: data.lastCommit,
    }))
    .sort((a, b) => b.commit_count - a.commit_count);

  const primary_owner = recent_authors.length > 0 ? recent_authors[0].name : null;

  // Check remote branches for pending changes
  const remoteBranches = git.getActiveRemoteBranches();
  const pending_changes: PendingChange[] = [];

  for (const branch of remoteBranches) {
    // Skip the current branch's remote tracking
    if (currentBranch && branch.endsWith(`/${currentBranch}`)) continue;

    const changedFiles = git.getFilesChangedOnBranch(
      currentBranch ?? 'HEAD',
      branch,
    );

    const matchingFiles = changedFiles.filter(f =>
      f === params.path || f.startsWith(params.path + '/')
    );

    if (matchingFiles.length > 0) {
      const author = git.getBranchAuthor(branch) ?? 'unknown';
      pending_changes.push({ branch, author, files: matchingFiles });
    }
  }

  // Check local modifications
  const localChanges = git.getStatusForPath(params.path);
  const locally_modified = localChanges.length > 0;

  // Compute risk
  let risk: RiskLevel = 'safe';
  let risk_reason = 'No recent activity or pending changes on this path.';

  if (pending_changes.length >= 2) {
    risk = 'conflict_likely';
    const names = pending_changes.map(p => `${p.author} (${p.branch})`).join(', ');
    risk_reason = `Multiple branches modifying this path: ${names}`;
  } else if (pending_changes.length === 1) {
    risk = 'caution';
    const p = pending_changes[0];
    risk_reason = `${p.author} has active changes on ${p.branch}`;
  }

  return {
    recent_authors,
    primary_owner,
    pending_changes,
    locally_modified,
    risk,
    risk_reason,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/check-path.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/check-path.ts tests/tools/check-path.test.ts
git commit -m "feat: add check_path tool"
```

---

### Task 7: search_team_code tool

**Files:**
- Create: `src/tools/search-team-code.ts`
- Create: `tests/tools/search-team-code.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/search-team-code.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from '../../src/git.js';
import * as fs from 'node:fs';
import { searchTeamCode } from '../../src/tools/search-team-code.js';

vi.mock('../../src/git.js');
vi.mock('node:fs');
const mockGit = vi.mocked(git);
const mockFs = vi.mocked(fs);

describe('searchTeamCode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.getRepoRoot.mockReturnValue('/repo');
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getActiveRemoteBranches.mockReturnValue([]);
  });

  it('finds matching exports in source files', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/auth/login.ts'] },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Alice', timestamp: 1000 });
    mockFs.readFileSync.mockReturnValue('export function login(user: string): Promise<Token> {\n  return fetch(...);\n}');

    const results = searchTeamCode({ query: 'login' });

    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('src/auth/login.ts');
    expect(results[0].name).toBe('login');
    expect(results[0].last_modified_by).toBe('Alice');
    expect(results[0].in_flux).toBe(false);
  });

  it('searches all recent files when no path filter', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/a.ts', 'src/b.ts'] },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Alice', timestamp: 1000 });
    mockFs.readFileSync
      .mockReturnValueOnce('export function formatDate() {}')
      .mockReturnValueOnce('export function formatTime() {}');

    const results = searchTeamCode({ query: 'format' });

    expect(results).toHaveLength(2);
  });

  it('filters by path prefix when path is provided', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/auth/login.ts', 'src/utils/format.ts'] },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Alice', timestamp: 1000 });
    mockFs.readFileSync.mockReturnValue('export function login() {}');

    const results = searchTeamCode({ query: 'login', path: 'src/auth' });

    // Should only search files under src/auth
    expect(results).toHaveLength(1);
    expect(results[0].file).toBe('src/auth/login.ts');
  });

  it('marks exports as in_flux when file is on another active branch', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/auth/login.ts'] },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Alice', timestamp: 1000 });
    mockFs.readFileSync.mockReturnValue('export function login() {}');
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/auth/login.ts']);

    const results = searchTeamCode({ query: 'login' });

    expect(results[0].in_flux).toBe(true);
  });

  it('returns empty array when no matching exports found', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/a.ts'] },
    ]);
    mockFs.readFileSync.mockReturnValue('export function unrelated() {}');

    const results = searchTeamCode({ query: 'login' });

    expect(results).toEqual([]);
  });

  it('skips files that cannot be read', () => {
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/a.ts'] },
    ]);
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const results = searchTeamCode({ query: 'login' });

    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/search-team-code.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement src/tools/search-team-code.ts**

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportMatch } from '../types.js';
import * as git from '../git.js';
import { searchExports, detectLanguage } from '../source-parser.js';

export function searchTeamCode(params: { query: string; path?: string }): ExportMatch[] {
  const repoRoot = git.getRepoRoot();
  if (!repoRoot) return [];

  const currentBranch = git.getCurrentBranch();

  // Get recently active files from git log
  const commits = git.getLog({ all: true, since: '7d' });
  const fileSet = new Set<string>();
  for (const commit of commits) {
    for (const file of commit.files) {
      if (params.path && !file.startsWith(params.path)) continue;
      fileSet.add(file);
    }
  }

  // Collect files changed on active remote branches
  const remoteBranches = git.getActiveRemoteBranches();
  const branchFiles = new Map<string, Set<string>>();
  for (const branch of remoteBranches) {
    if (currentBranch && branch.endsWith(`/${currentBranch}`)) continue;
    const changed = git.getFilesChangedOnBranch(currentBranch ?? 'HEAD', branch);
    branchFiles.set(branch, new Set(changed));
  }

  const results: ExportMatch[] = [];

  for (const file of fileSet) {
    const language = detectLanguage(file);
    if (!language) continue;

    let code: string;
    try {
      code = readFileSync(join(repoRoot, file), 'utf-8');
    } catch {
      continue;
    }

    const matches = searchExports(code, language, params.query);
    if (matches.length === 0) continue;

    const modifier = git.getLastModifier(file);
    const inFlux = [...branchFiles.values()].some(files => files.has(file));

    for (const match of matches) {
      results.push({
        file,
        name: match.name,
        signature: match.signature,
        last_modified_by: modifier?.author ?? 'unknown',
        last_modified_at: modifier?.timestamp ?? 0,
        in_flux: inFlux,
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/search-team-code.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/search-team-code.ts tests/tools/search-team-code.test.ts
git commit -m "feat: add search_team_code tool"
```

---

### Task 8: check_conflicts tool

**Files:**
- Create: `src/tools/check-conflicts.ts`
- Create: `tests/tools/check-conflicts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/check-conflicts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from '../../src/git.js';
import { checkConflicts } from '../../src/tools/check-conflicts.js';

vi.mock('../../src/git.js');
const mockGit = vi.mocked(git);

describe('checkConflicts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getLocallyModifiedFiles.mockReturnValue([]);
  });

  it('returns no conflicts when no active remote branches', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue([]);
    const result = checkConflicts();
    expect(result.conflicts).toEqual([]);
    expect(result.summary).toContain('No');
  });

  it('detects file modified on multiple branches', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth', 'origin/feat/login']);
    mockGit.getFilesChangedOnBranch.mockImplementation((_current, branch) => {
      if (branch === 'origin/feat/auth') return ['src/auth/login.ts', 'src/auth/types.ts'];
      if (branch === 'origin/feat/login') return ['src/auth/login.ts'];
      return [];
    });
    mockGit.getBranchAuthor.mockImplementation((branch) =>
      branch === 'origin/feat/auth' ? 'Alice' : 'Bob'
    );

    const result = checkConflicts();

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].file).toBe('src/auth/login.ts');
    expect(result.conflicts[0].severity).toBe('high');
    expect(result.conflicts[0].branches).toHaveLength(2);
  });

  it('flags local modifications that overlap with remote branches', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/auth/login.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');
    mockGit.getLocallyModifiedFiles.mockReturnValue(['src/auth/login.ts']);

    const result = checkConflicts();

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].local).toBe(true);
  });

  it('skips current branch remote tracking', () => {
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/main', 'origin/feat/auth']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/index.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    const result = checkConflicts();

    // origin/main should be skipped, only feat/auth checked
    const branches = result.conflicts.flatMap(c => c.branches.map(b => b.branch));
    expect(branches).not.toContain('origin/main');
  });

  it('generates a human-readable summary', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth', 'origin/feat/login']);
    mockGit.getFilesChangedOnBranch.mockImplementation((_current, branch) => {
      if (branch === 'origin/feat/auth') return ['src/shared.ts'];
      if (branch === 'origin/feat/login') return ['src/shared.ts'];
      return [];
    });
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    const result = checkConflicts();

    expect(result.summary).toMatch(/1 file/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/check-conflicts.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement src/tools/check-conflicts.ts**

```typescript
import type { ConflictReport, ConflictEntry } from '../types.js';
import * as git from '../git.js';

export function checkConflicts(): ConflictReport {
  const currentBranch = git.getCurrentBranch();
  const remoteBranches = git.getActiveRemoteBranches();
  const localFiles = new Set(git.getLocallyModifiedFiles());

  // Collect files changed per branch (excluding current branch's remote)
  const branchChanges = new Map<string, { files: string[]; author: string }>();

  for (const branch of remoteBranches) {
    if (currentBranch && branch.endsWith(`/${currentBranch}`)) continue;

    const files = git.getFilesChangedOnBranch(currentBranch ?? 'HEAD', branch);
    if (files.length === 0) continue;

    const author = git.getBranchAuthor(branch) ?? 'unknown';
    branchChanges.set(branch, { files, author });
  }

  // Find files that appear in multiple branches
  const fileToSources = new Map<string, Array<{ branch: string; author: string }>>();

  for (const [branch, { files, author }] of branchChanges) {
    for (const file of files) {
      const sources = fileToSources.get(file) ?? [];
      sources.push({ branch, author });
      fileToSources.set(file, sources);
    }
  }

  const conflicts: ConflictEntry[] = [];

  for (const [file, sources] of fileToSources) {
    const isLocal = localFiles.has(file);
    const isMultiBranch = sources.length >= 2;

    if (!isMultiBranch && !isLocal) continue;

    conflicts.push({
      file,
      branches: sources,
      local: isLocal,
      severity: isMultiBranch ? 'high' : 'low',
    });
  }

  // Also flag local-only conflicts (local file changed + on one remote branch)
  for (const [file, sources] of fileToSources) {
    if (sources.length === 1 && localFiles.has(file)) {
      const existing = conflicts.find(c => c.file === file);
      if (!existing) {
        conflicts.push({
          file,
          branches: sources,
          local: true,
          severity: 'low',
        });
      }
    }
  }

  const highCount = conflicts.filter(c => c.severity === 'high').length;
  const totalCount = conflicts.length;

  let summary: string;
  if (totalCount === 0) {
    summary = 'No potential conflicts detected across active branches.';
  } else {
    summary = `${totalCount} file${totalCount === 1 ? '' : 's'} at risk of conflict`;
    if (highCount > 0) {
      summary += ` (${highCount} high severity)`;
    }
    summary += '.';
  }

  return { conflicts, summary };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/check-conflicts.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/check-conflicts.ts tests/tools/check-conflicts.test.ts
git commit -m "feat: add check_conflicts tool"
```

---

### Task 9: get_developer tool

**Files:**
- Create: `src/tools/get-developer.ts`
- Create: `tests/tools/get-developer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/tools/get-developer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as git from '../../src/git.js';
import { getDeveloper } from '../../src/tools/get-developer.js';

vi.mock('../../src/git.js');
const mockGit = vi.mocked(git);

describe('getDeveloper', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns developer profile with commits and work areas', () => {
    mockGit.getAllAuthors.mockReturnValue(['Alice Johnson', 'Bob Smith']);
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice Johnson', email: 'a@x.com', timestamp: 1000, message: 'feat: login', files: ['src/auth/login.ts'] },
      { hash: 'a2', author: 'Alice Johnson', email: 'a@x.com', timestamp: 900, message: 'feat: types', files: ['src/auth/types.ts'] },
    ]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feat/auth']);
    mockGit.getBranchAuthor.mockReturnValue('Alice Johnson');

    const result = getDeveloper({ name: 'Alice' });

    expect(result.name).toBe('Alice Johnson');
    expect(result.recent_commits).toHaveLength(2);
    expect(result.work_areas).toContain('src/auth');
    expect(result.active_branches).toContain('origin/feat/auth');
    expect(result.files).toContain('src/auth/login.ts');
  });

  it('fuzzy matches author name (case-insensitive substring)', () => {
    mockGit.getAllAuthors.mockReturnValue(['Alice Johnson', 'Bob Smith']);
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice Johnson', email: '', timestamp: 1000, message: 'feat', files: ['a.ts'] },
    ]);
    mockGit.getActiveRemoteBranches.mockReturnValue([]);

    const result = getDeveloper({ name: 'alice' });

    expect(result.name).toBe('Alice Johnson');
  });

  it('returns empty profile when no author matches', () => {
    mockGit.getAllAuthors.mockReturnValue(['Alice', 'Bob']);

    const result = getDeveloper({ name: 'Charlie' });

    expect(result.name).toBe('Charlie');
    expect(result.recent_commits).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('deduplicates files across commits', () => {
    mockGit.getAllAuthors.mockReturnValue(['Alice']);
    mockGit.getLog.mockReturnValue([
      { hash: 'a1', author: 'Alice', email: '', timestamp: 1000, message: 'feat', files: ['src/a.ts'] },
      { hash: 'a2', author: 'Alice', email: '', timestamp: 900, message: 'fix', files: ['src/a.ts', 'src/b.ts'] },
    ]);
    mockGit.getActiveRemoteBranches.mockReturnValue([]);

    const result = getDeveloper({ name: 'Alice' });

    expect(result.files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/get-developer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement src/tools/get-developer.ts**

```typescript
import type { DeveloperProfile } from '../types.js';
import * as git from '../git.js';

function fuzzyMatchAuthor(query: string, authors: string[]): string | null {
  const lower = query.toLowerCase();

  // Exact match first
  const exact = authors.find(a => a.toLowerCase() === lower);
  if (exact) return exact;

  // Substring match
  const partial = authors.find(a => a.toLowerCase().includes(lower));
  if (partial) return partial;

  return null;
}

function inferWorkAreas(files: string[]): string[] {
  const dirCounts = new Map<string, number>();

  for (const file of files) {
    const parts = file.split('/');
    if (parts.length > 1) {
      const dir = parts.slice(0, -1).join('/');
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
  }

  return [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([dir]) => dir)
    .slice(0, 5);
}

export function getDeveloper(params: { name: string }): DeveloperProfile {
  const allAuthors = git.getAllAuthors();
  const resolvedName = fuzzyMatchAuthor(params.name, allAuthors);

  if (!resolvedName) {
    return {
      name: params.name,
      recent_commits: [],
      active_branches: [],
      work_areas: [],
      files: [],
    };
  }

  const commits = git.getLog({ all: true, since: '7d', author: resolvedName });
  const allFiles = commits.flatMap(c => c.files);
  const uniqueFiles = [...new Set(allFiles)];

  const remoteBranches = git.getActiveRemoteBranches();
  const activeBranches = remoteBranches.filter(
    branch => git.getBranchAuthor(branch) === resolvedName
  );

  return {
    name: resolvedName,
    recent_commits: commits.slice(0, 20).map(c => ({
      hash: c.hash,
      message: c.message,
      timestamp: c.timestamp,
      files: c.files,
    })),
    active_branches: activeBranches,
    work_areas: inferWorkAreas(allFiles),
    files: uniqueFiles,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/get-developer.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/get-developer.ts tests/tools/get-developer.test.ts
git commit -m "feat: add get_developer tool"
```

---

### Task 10: MCP server and CLI

**Files:**
- Create: `src/server.ts`
- Modify: `src/cli.ts` (rewrite)
- Modify: `bin/swarmcode.ts` (simplify)

- [ ] **Step 1: Implement src/server.ts**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VERSION } from './index.js';
import { getTeamActivity } from './tools/get-team-activity.js';
import { checkPath } from './tools/check-path.js';
import { searchTeamCode } from './tools/search-team-code.js';
import { checkConflicts } from './tools/check-conflicts.js';
import { getDeveloper } from './tools/get-developer.js';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'swarmcode', version: VERSION },
    {
      instructions: [
        'You have access to team coordination tools. Use them:',
        '- Before creating files in a new directory → call check_path',
        '- Before implementing a function that might already exist → call search_team_code',
        '- At the start of complex tasks → call get_team_activity',
        '- When something conflicts or breaks unexpectedly → call check_conflicts',
        'Do not rebuild what a teammate has already built. Import from their work instead.',
      ].join('\n'),
    },
  );

  server.registerTool(
    'get_team_activity',
    {
      title: 'Get Team Activity',
      description: 'Overview of recent work across all contributors. Shows who is active, what branches they are on, and what areas they are working in.',
      inputSchema: {
        since: z.string().default('24h').describe('How far back to look (git date format, e.g. "24h", "7d", "2w")'),
      },
    },
    ({ since }) => {
      const result = getTeamActivity({ since });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'check_path',
    {
      title: 'Check Path',
      description: 'Safety check before creating or modifying files. Returns who owns this area, pending changes on other branches, and a risk assessment.',
      inputSchema: {
        path: z.string().describe('File or directory path to check (relative to repo root)'),
      },
    },
    ({ path }) => {
      const result = checkPath({ path });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'search_team_code',
    {
      title: 'Search Team Code',
      description: 'Search for existing exports (functions, classes, types, constants) across the codebase. Use before implementing something that might already exist.',
      inputSchema: {
        query: z.string().describe('Function, type, or component name to search for'),
        path: z.string().optional().describe('Narrow search to a directory (e.g. "src/auth")'),
      },
    },
    ({ query, path }) => {
      const result = searchTeamCode({ query, path });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'check_conflicts',
    {
      title: 'Check Conflicts',
      description: 'Detect potential merge conflicts across active branches. Shows files modified on multiple branches and local changes that overlap.',
      inputSchema: {},
    },
    () => {
      const result = checkConflicts();
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  server.registerTool(
    'get_developer',
    {
      title: 'Get Developer',
      description: 'Drill-down on one teammate. Shows their recent commits, active branches, and primary work areas.',
      inputSchema: {
        name: z.string().describe('Developer name (fuzzy matched against git authors)'),
      },
    },
    ({ name }) => {
      const result = getDeveloper({ name });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`swarmcode MCP server v${VERSION} running on stdio`);
}
```

- [ ] **Step 2: Rewrite src/cli.ts**

```typescript
import { Command } from 'commander';
import { VERSION } from './index.js';
import { getTeamActivity } from './tools/get-team-activity.js';

export function createCLI(): Command {
  const program = new Command();
  program
    .name('swarmcode')
    .description('MCP server that coordinates AI coding assistants using git')
    .version(VERSION);

  // Default action (no subcommand): start MCP server
  program
    .action(async () => {
      const { startServer } = await import('./server.js');
      await startServer();
    });

  program
    .command('status')
    .description('Show recent team activity')
    .option('--since <since>', 'How far back to look', '24h')
    .action((options) => {
      const activity = getTeamActivity({ since: options.since });

      if (activity.length === 0) {
        console.log('No recent team activity found.');
        return;
      }

      for (const member of activity) {
        const ago = Math.round((Date.now() / 1000 - member.last_active) / 60);
        const timeStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
        console.log(`\n${member.name} (last active ${timeStr})`);

        if (member.work_areas.length > 0) {
          console.log(`  Working in: ${member.work_areas.join(', ')}`);
        }
        if (member.active_branches.length > 0) {
          console.log(`  Branches: ${member.active_branches.join(', ')}`);
        }
        for (const commit of member.recent_commits.slice(0, 3)) {
          console.log(`  - ${commit.message}`);
        }
      }
    });

  return program;
}
```

- [ ] **Step 3: Update bin/swarmcode.ts**

The file stays the same — it already delegates to `createCLI()` and calls `program.parse()`. No changes needed.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/cli.ts
git commit -m "feat: add MCP server and simplified CLI"
```

---

### Task 11: Update package.json and entry point

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json**

Ensure the final `package.json` has:

```json
{
  "name": "swarmcode",
  "version": "2.0.0",
  "description": "MCP server that coordinates AI coding assistants using git",
  "main": "src/index.ts",
  "type": "module",
  "bin": {
    "swarmcode": "./bin/swarmcode.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  },
  "keywords": ["mcp", "ai", "git", "coordination"],
  "license": "MIT"
}
```

Dependencies should now be: `@modelcontextprotocol/sdk`, `zod`, `commander`, `tsx`, `typescript`.
DevDependencies: `@types/node`, `vitest`.

- [ ] **Step 2: Verify the full test suite passes**

Run: `npx vitest run`
Expected: all unit tests PASS

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update package.json for v2 MCP server"
```

---

### Task 12: Integration test

**Files:**
- Create: `tests/integration/mcp-server.test.ts`

- [ ] **Step 1: Write the integration test**

This test creates a real git repo with multiple authors and branches, then exercises the tool functions against it.

Create `tests/integration/mcp-server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We run tool functions directly (not via MCP protocol) against a real git repo.
// This validates the full pipeline: git commands → parsing → tool output.

let repoDir: string;

function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

function commitAs(dir: string, author: string, email: string, message: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(dir, path);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    execFileSync('mkdir', ['-p', parentDir]);
    writeFileSync(fullPath, content, 'utf-8');
  }
  gitIn(dir, ['add', '-A']);
  gitIn(dir, [
    '-c', `user.name=${author}`,
    '-c', `user.email=${email}`,
    'commit', '-m', message,
  ]);
}

beforeAll(() => {
  // Create a temp git repo with multiple authors and branches
  repoDir = mkdtempSync(join(tmpdir(), 'swarmcode-test-'));
  gitIn(repoDir, ['init', '-b', 'main']);

  // Initial commit by Jared (the "local" user)
  commitAs(repoDir, 'Jared', 'jared@x.com', 'initial commit', {
    'README.md': '# Test Project',
  });

  // Alice works on auth
  gitIn(repoDir, ['checkout', '-b', 'feat/auth']);
  commitAs(repoDir, 'Alice', 'alice@x.com', 'feat: add login', {
    'src/auth/login.ts': 'export function login(user: string): Promise<Token> {\n  return fetch("/api/login");\n}\n',
    'src/auth/types.ts': 'export interface Token {\n  value: string;\n  expires: number;\n}\n',
  });
  commitAs(repoDir, 'Alice', 'alice@x.com', 'feat: add logout', {
    'src/auth/logout.ts': 'export function logout(): void {\n  localStorage.clear();\n}\n',
  });

  // Bob works on components (from main)
  gitIn(repoDir, ['checkout', 'main']);
  gitIn(repoDir, ['checkout', '-b', 'feat/dashboard']);
  commitAs(repoDir, 'Bob', 'bob@x.com', 'feat: add dashboard', {
    'src/components/Dashboard.tsx': 'export function Dashboard() {\n  return <div>Dashboard</div>;\n}\n',
  });

  // Create a conflict: Bob also modifies auth/login.ts on his branch
  commitAs(repoDir, 'Bob', 'bob@x.com', 'fix: update login import', {
    'src/auth/login.ts': 'export function login(user: string): Promise<Token> {\n  return fetch("/api/v2/login");\n}\n',
  });

  // Go back to main for tests
  gitIn(repoDir, ['checkout', 'main']);

  // Set the local user to Jared
  gitIn(repoDir, ['config', 'user.name', 'Jared']);
  gitIn(repoDir, ['config', 'user.email', 'jared@x.com']);
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe('integration: tools against real git repo', () => {
  // We need to run the tools in the context of the test repo.
  // Since git.ts uses execFileSync without a cwd param (it uses process.cwd()),
  // we override cwd for the duration of each test.
  let originalCwd: string;

  beforeAll(() => {
    originalCwd = process.cwd();
    process.chdir(repoDir);
  });

  afterAll(() => {
    process.chdir(originalCwd);
  });

  it('get_team_activity returns Alice and Bob, excludes Jared', async () => {
    const { getTeamActivity } = await import('../../src/tools/get-team-activity.js');
    const result = getTeamActivity({ since: '30d' });

    const names = result.map(r => r.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).not.toContain('Jared');
  });

  it('check_path detects conflict on src/auth/login.ts', async () => {
    const { checkPath: checkPathFn } = await import('../../src/tools/check-path.js');

    // From main, both feat/auth and feat/dashboard modify src/auth/login.ts
    const result = checkPathFn({ path: 'src/auth/login.ts' });

    expect(result.risk).not.toBe('safe');
    expect(result.recent_authors.length).toBeGreaterThan(0);
  });

  it('search_team_code finds login export', async () => {
    const { searchTeamCode: searchFn } = await import('../../src/tools/search-team-code.js');
    const result = searchFn({ query: 'login' });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('login');
    expect(result[0].file).toContain('login.ts');
  });

  it('get_developer returns Alice profile', async () => {
    const { getDeveloper: getDevFn } = await import('../../src/tools/get-developer.js');
    const result = getDevFn({ name: 'Alice' });

    expect(result.name).toBe('Alice');
    expect(result.recent_commits.length).toBeGreaterThan(0);
    expect(result.work_areas).toContain('src/auth');
  });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run tests/integration/mcp-server.test.ts`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/mcp-server.test.ts
git commit -m "test: add integration tests for MCP server tools"
```

---

### Task 13: Clean up old test configs and verify

**Files:**
- Modify: `vitest.config.ts` (if needed)
- Modify: `vitest.integration.config.ts` (if needed)
- Delete: any remaining orphaned test files or directories

- [ ] **Step 1: Verify vitest.config.ts works for new test structure**

Read `vitest.config.ts`. It currently includes `tests/**/*.test.ts` and excludes `tests/integration/**`. This should work as-is for the new structure.

- [ ] **Step 2: Verify vitest.integration.config.ts**

Read the file and confirm it includes `tests/integration/**/*.test.ts`. Update if needed.

- [ ] **Step 3: Run all unit tests**

Run: `npx vitest run`
Expected: all unit tests PASS (git, source-parser, all 5 tools)

- [ ] **Step 4: Run integration tests**

Run: `npx vitest run --config vitest.integration.config.ts`
Expected: all integration tests PASS

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Clean up any orphaned files**

Check for any remaining old files that should have been deleted in Task 1:

```bash
ls src/
ls tests/
```

Verify `src/` contains only: `server.ts`, `types.ts`, `git.ts`, `source-parser.ts`, `cli.ts`, `index.ts`, `tools/`
Verify `tests/` contains only: `git.test.ts`, `source-parser.test.ts`, `tools/`, `integration/`

Delete anything else.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: clean up and verify full test suite"
```
