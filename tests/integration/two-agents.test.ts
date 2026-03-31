/**
 * Two-agent integration test for swarmcode.
 *
 * Proves that two AI agents on the same repo (sharing a bare remote) can see
 * each other's work through swarmcode's MCP tools. Uses real git commands,
 * real files, and real parsing — no mocking.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { getTeamActivity } from '../../src/tools/get-team-activity.js';
import { checkPath } from '../../src/tools/check-path.js';
import { searchTeamCode } from '../../src/tools/search-team-code.js';
import { checkConflicts } from '../../src/tools/check-conflicts.js';
import { getDeveloper } from '../../src/tools/get-developer.js';
import { enableAutoPush, disableAutoPush } from '../../src/tools/auto-push.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

function writeFile(repoDir: string, filePath: string, content: string): void {
  const fullPath = join(repoDir, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

function commitAs(
  dir: string,
  author: string,
  email: string,
  message: string,
  files: Record<string, string>,
): void {
  for (const [filePath, content] of Object.entries(files)) {
    writeFile(dir, filePath, content);
  }
  gitIn(dir, ['add', '-A']);
  gitIn(dir, [
    '-c', `user.name=${author}`,
    '-c', `user.email=${email}`,
    'commit', '-m', message,
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let bareDir: string;
let agent1Dir: string;
let agent2Dir: string;
let originalCwd: string;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  originalCwd = process.cwd();

  // 1. Create a bare remote repo
  bareDir = mkdtempSync(join(tmpdir(), 'swarmcode-bare-'));
  gitIn(bareDir, ['init', '--bare']);

  // 2. Clone into agent1_dir (Alice)
  agent1Dir = mkdtempSync(join(tmpdir(), 'swarmcode-agent1-'));
  execFileSync('git', ['clone', bareDir, agent1Dir], { encoding: 'utf-8' });
  gitIn(agent1Dir, ['config', 'user.name', 'Alice']);
  gitIn(agent1Dir, ['config', 'user.email', 'alice@x.com']);

  // 3. Clone into agent2_dir (Bob)
  agent2Dir = mkdtempSync(join(tmpdir(), 'swarmcode-agent2-'));
  execFileSync('git', ['clone', bareDir, agent2Dir], { encoding: 'utf-8' });
  gitIn(agent2Dir, ['config', 'user.name', 'Bob']);
  gitIn(agent2Dir, ['config', 'user.email', 'bob@x.com']);

  // 4. Initial commit on main from agent1 and push
  //    (bare repo starts empty, so we need to create the initial branch)
  commitAs(agent1Dir, 'Alice', 'alice@x.com', 'chore: initial commit', {
    'README.md': '# SwarmCode Two-Agent Test\n',
  });
  gitIn(agent1Dir, ['branch', '-M', 'main']);
  gitIn(agent1Dir, ['push', '-u', 'origin', 'main']);

  // Pull the initial commit into agent2
  gitIn(agent2Dir, ['fetch', 'origin']);
  gitIn(agent2Dir, ['checkout', '-b', 'main', 'origin/main']);
});

afterAll(() => {
  // Restore original cwd to prevent leaking into other test suites
  process.chdir(originalCwd);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration: two-agent coordination', () => {
  // -----------------------------------------------------------------------
  // Step 2: Agent 1 (Alice) creates feat/auth
  // -----------------------------------------------------------------------
  it('Agent 1 (Alice) creates feat/auth with login.ts', () => {
    gitIn(agent1Dir, ['checkout', '-b', 'feat/auth']);
    commitAs(agent1Dir, 'Alice', 'alice@x.com', 'feat: add auth login', {
      'src/auth/login.ts':
        'export function login(user: string): Promise<void> {\n  return fetch(\'/login\', { body: user }).then(() => {});\n}\n',
    });
    gitIn(agent1Dir, ['push', '-u', 'origin', 'feat/auth']);

    // Verify push succeeded
    const lsRemote = gitIn(agent1Dir, ['ls-remote', '--heads', 'origin', 'feat/auth']);
    expect(lsRemote).toContain('feat/auth');
  });

  // -----------------------------------------------------------------------
  // Step 3: Agent 2 (Bob) queries and sees Alice's work
  // -----------------------------------------------------------------------
  describe('Agent 2 (Bob) queries from agent2_dir', () => {
    beforeAll(() => {
      // Bob fetches to see Alice's remote branch
      gitIn(agent2Dir, ['fetch', 'origin']);
      process.chdir(agent2Dir);
    });

    it('getTeamActivity returns Alice', () => {
      const result = getTeamActivity({ since: '1 year ago' });
      const names = result.map((a) => a.name);
      expect(names).toContain('Alice');
    });

    it('checkPath shows Alice as recent author of src/auth/login.ts', () => {
      const result = checkPath({ path: 'src/auth/login.ts' });
      const authorNames = result.recent_authors.map((a) => a.name);
      expect(authorNames).toContain('Alice');
    });

    it('searchTeamCode finds the login export on feat/auth', () => {
      // Checkout feat/auth so file exists on disk, then search
      gitIn(agent2Dir, ['checkout', '-b', 'feat/auth', 'origin/feat/auth']);
      try {
        const result = searchTeamCode({ query: 'login' });
        const names = result.map((m) => m.name);
        expect(names).toContain('login');

        const loginMatch = result.find((m) => m.name === 'login');
        expect(loginMatch).toBeDefined();
        expect(loginMatch!.file).toBe('src/auth/login.ts');
        expect(loginMatch!.signature).toContain('login');
      } finally {
        gitIn(agent2Dir, ['checkout', 'main']);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Step 4: Agent 2 (Bob) creates feat/dashboard modifying same file
  // -----------------------------------------------------------------------
  it('Agent 2 (Bob) creates feat/dashboard with modified login.ts', () => {
    process.chdir(agent2Dir);
    gitIn(agent2Dir, ['checkout', '-b', 'feat/dashboard', 'main']);
    commitAs(agent2Dir, 'Bob', 'bob@x.com', 'feat: improve login with timeout', {
      'src/auth/login.ts':
        'export function login(user: string, timeout = 5000): Promise<void> {\n  return fetch(\'/login\', { body: user, signal: AbortSignal.timeout(timeout) }).then(() => {});\n}\n',
    });
    gitIn(agent2Dir, ['push', '-u', 'origin', 'feat/dashboard']);

    // Verify push succeeded
    const lsRemote = gitIn(agent2Dir, ['ls-remote', '--heads', 'origin', 'feat/dashboard']);
    expect(lsRemote).toContain('feat/dashboard');
  });

  // -----------------------------------------------------------------------
  // Step 5: Agent 1 (Alice) queries and sees conflicts + Bob's profile
  // -----------------------------------------------------------------------
  describe('Agent 1 (Alice) queries from agent1_dir', () => {
    beforeAll(() => {
      // Alice fetches to see Bob's remote branch
      gitIn(agent1Dir, ['fetch', 'origin']);
      gitIn(agent1Dir, ['checkout', 'main']);
      process.chdir(agent1Dir);
    });

    it('checkConflicts detects src/auth/login.ts on multiple branches', () => {
      const result = checkConflicts();
      expect(result.conflicts.length).toBeGreaterThan(0);

      const loginConflict = result.conflicts.find((c) => c.file === 'src/auth/login.ts');
      expect(loginConflict).toBeDefined();
      expect(loginConflict!.severity).toBe('high');

      // Should mention both branches
      const branchNames = loginConflict!.branches.map((b) => b.branch);
      expect(branchNames.some((b) => b.includes('feat/auth'))).toBe(true);
      expect(branchNames.some((b) => b.includes('feat/dashboard'))).toBe(true);
    });

    it('getDeveloper shows Bob profile with recent commits', () => {
      const result = getDeveloper({ name: 'Bob' });
      expect(result.name).toBe('Bob');
      expect(result.recent_commits.length).toBeGreaterThan(0);

      // Bob's commit should reference login
      const hasLoginCommit = result.recent_commits.some(
        (c) => c.message.includes('login') || c.files.some((f) => f.includes('login')),
      );
      expect(hasLoginCommit).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Step 6: Auto-push from Alice's feat/auth
  // -----------------------------------------------------------------------
  it('auto-push pushes new commits to remote', async () => {
    process.chdir(agent1Dir);
    gitIn(agent1Dir, ['checkout', 'feat/auth']);

    try {
      // Enable with 1-second interval for the test
      const apResult = enableAutoPush({ interval: 1 });
      expect(apResult.enabled).toBe(true);
      expect(apResult.branch).toBe('feat/auth');
      expect(apResult.interval).toBe(1);

      // Record the HEAD sha before the new commit
      const shaBefore = gitIn(agent1Dir, ['rev-parse', 'HEAD']);

      // Make a new commit
      commitAs(agent1Dir, 'Alice', 'alice@x.com', 'feat: add session helpers', {
        'src/auth/session.ts':
          'export function getSession(): string | null {\n  return localStorage.getItem("session");\n}\n',
      });

      const shaAfter = gitIn(agent1Dir, ['rev-parse', 'HEAD']);
      expect(shaAfter).not.toBe(shaBefore);

      // Wait for the auto-push interval to fire (1s interval + buffer)
      await sleep(2500);

      // Verify the commit was pushed to remote
      const lsRemote = gitIn(agent1Dir, ['ls-remote', '--heads', 'origin', 'feat/auth']);
      expect(lsRemote).toContain(shaAfter);
    } finally {
      // Always disable to prevent interval leaks
      const disableResult = disableAutoPush();
      expect(disableResult.enabled).toBe(false);
      expect(disableResult.pushes_made).toBeGreaterThanOrEqual(1);
    }
  });
});
