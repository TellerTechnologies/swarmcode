/**
 * Integration tests for MCP server tools against a real git repository.
 *
 * NO mocking — real git commands, real files, real parsing.
 *
 * NOTE: There is no remote in this test repo, so getActiveRemoteBranches()
 * returns []. As a result:
 *   - check_conflicts: no remote branches → no cross-branch conflicts detected
 *   - check_path: pending_changes will be empty → risk is always 'safe'
 *   - search_team_code: files only on other branches won't exist on disk when
 *     checked out to main; the tool skips them gracefully
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

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

// ---------------------------------------------------------------------------
// Test repo setup
// ---------------------------------------------------------------------------

let repoDir: string;

beforeAll(() => {
  // 1. Create temp directory
  repoDir = mkdtempSync(join(tmpdir(), 'swarmcode-integration-'));

  // 2. git init with main as the default branch
  gitIn(repoDir, ['init', '-b', 'main']);

  // 3. Set local user to Jared
  gitIn(repoDir, ['config', 'user.name', 'Jared']);
  gitIn(repoDir, ['config', 'user.email', 'jared@x.com']);

  // 4. Initial commit by Jared: just README.md
  commitAs(repoDir, 'Jared', 'jared@x.com', 'chore: initial commit', {
    'README.md': '# SwarmCode Test Repo\n',
  });

  // 5. feat/auth branch — commits by Alice
  gitIn(repoDir, ['checkout', '-b', 'feat/auth']);

  commitAs(repoDir, 'Alice', 'alice@x.com', 'feat: add auth login and types', {
    'src/auth/login.ts':
      "export function login(user: string): Promise<Token> { return fetch('/login', { body: user }) as any; }\n",
    'src/auth/types.ts':
      'export interface Token { value: string; expiresAt: number; }\n',
  });

  commitAs(repoDir, 'Alice', 'alice@x.com', 'feat: add logout', {
    'src/auth/logout.ts':
      'export function logout(): void { localStorage.removeItem("token"); }\n',
  });

  // 6. feat/dashboard branch from main — commits by Bob
  gitIn(repoDir, ['checkout', 'main']);
  gitIn(repoDir, ['checkout', '-b', 'feat/dashboard']);

  commitAs(repoDir, 'Bob', 'bob@x.com', 'feat: add Dashboard component', {
    'src/components/Dashboard.tsx':
      'export function Dashboard() { return <div>Dashboard</div>; }\n',
  });

  // Second commit: Bob modifies src/auth/login.ts (cross-branch conflict with Alice)
  commitAs(repoDir, 'Bob', 'bob@x.com', 'feat: improve login with timeout', {
    'src/auth/login.ts':
      "export function login(user: string, timeout = 5000): Promise<Token> { return fetch('/login', { body: user }) as any; }\n",
  });

  // 7. Back to main, ensure local user is Jared
  gitIn(repoDir, ['checkout', 'main']);

  // Now change cwd so all tools run against our test repo
  process.chdir(repoDir);
});

// ---------------------------------------------------------------------------
// Tool imports (after beforeAll changes cwd — imported lazily via dynamic
// import to avoid the module-level cwd being captured at import time)
// ---------------------------------------------------------------------------
//
// Since Vitest / Node ESM caches modules at import time and the git helpers
// read process.cwd() at call time (not import time), we can safely do static
// imports here. The git functions all call execFileSync('git', ...) without a
// cwd override, so they inherit process.cwd() at call time — which will be
// repoDir after beforeAll runs.

import { getTeamActivity } from '../../src/tools/get-team-activity.js';
import { checkPath } from '../../src/tools/check-path.js';
import { searchTeamCode } from '../../src/tools/search-team-code.js';
import { checkConflicts } from '../../src/tools/check-conflicts.js';
import { getDeveloper } from '../../src/tools/get-developer.js';
import { enableAutoPush, disableAutoPush } from '../../src/tools/auto-push.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('integration: tools against real git repo', () => {
  it('get_team_activity returns Alice and Bob, excludes Jared', () => {
    const result = getTeamActivity({ since: '1 year ago' });

    const names = result.map((a) => a.name);

    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).not.toContain('Jared');
  });

  it('get_team_activity returns correct work areas for Alice', () => {
    const result = getTeamActivity({ since: '1 year ago' });
    const alice = result.find((a) => a.name === 'Alice');

    expect(alice).toBeDefined();
    // Alice committed to src/auth/* files
    expect(alice!.work_areas).toContain('src/auth');
    // Alice has recent commits
    expect(alice!.recent_commits.length).toBeGreaterThan(0);
  });

  it('check_path detects activity on src/auth/login.ts', () => {
    const result = checkPath({ path: 'src/auth/login.ts' });

    // Both Alice and Bob committed to this file (on their respective branches)
    const authorNames = result.recent_authors.map((a) => a.name);
    expect(authorNames).toContain('Alice');
    expect(authorNames).toContain('Bob');

    // primary_owner should be set (the author with the most commits)
    expect(result.primary_owner).not.toBeNull();
  });

  it('check_path returns a valid PathCheckResult structure', () => {
    const result = checkPath({ path: 'src/auth/login.ts' });

    expect(result).toHaveProperty('recent_authors');
    expect(result).toHaveProperty('primary_owner');
    expect(result).toHaveProperty('pending_changes');
    expect(result).toHaveProperty('locally_modified');
    expect(result).toHaveProperty('risk');
    expect(result).toHaveProperty('risk_reason');
    expect(Array.isArray(result.recent_authors)).toBe(true);
    expect(Array.isArray(result.pending_changes)).toBe(true);
    // No remote → no pending changes → risk is 'safe'
    expect(result.risk).toBe('safe');
  });

  it('search_team_code does not crash and returns an array', () => {
    // On main, src/auth/login.ts does NOT exist on disk (only on feat/* branches).
    // The tool should gracefully skip unreadable files and return whatever it can.
    const result = searchTeamCode({ query: 'login' });

    expect(Array.isArray(result)).toBe(true);
    // Each result must have the required shape
    for (const match of result) {
      expect(match).toHaveProperty('file');
      expect(match).toHaveProperty('name');
      expect(match).toHaveProperty('signature');
      expect(match).toHaveProperty('last_modified_by');
      expect(match).toHaveProperty('last_modified_at');
      expect(match).toHaveProperty('in_flux');
    }
  });

  it('search_team_code finds login export when on feat/auth branch', () => {
    // Temporarily checkout feat/auth so login.ts is on disk
    gitIn(repoDir, ['checkout', 'feat/auth']);
    try {
      const result = searchTeamCode({ query: 'login' });

      const names = result.map((m) => m.name);
      expect(names).toContain('login');

      const loginMatch = result.find((m) => m.name === 'login');
      expect(loginMatch).toBeDefined();
      expect(loginMatch!.file).toBe('src/auth/login.ts');
      expect(loginMatch!.signature).toContain('login');
    } finally {
      // Always return to main so subsequent tests work correctly
      gitIn(repoDir, ['checkout', 'main']);
    }
  });

  it('check_conflicts runs without error and returns a valid ConflictReport', () => {
    const result = checkConflicts();

    expect(result).toHaveProperty('conflicts');
    expect(result).toHaveProperty('summary');
    expect(Array.isArray(result.conflicts)).toBe(true);
    expect(typeof result.summary).toBe('string');

    // No remote branches → no cross-branch conflicts detected
    expect(result.conflicts).toHaveLength(0);
    expect(result.summary).toContain('No potential conflicts');
  });

  it('get_developer returns Alice profile with her commits', () => {
    const result = getDeveloper({ name: 'Alice' });

    expect(result.name).toBe('Alice');
    expect(result.recent_commits.length).toBeGreaterThan(0);

    // Alice committed auth files
    const allFiles = result.files;
    const hasAuthFiles = allFiles.some((f) => f.startsWith('src/auth/'));
    expect(hasAuthFiles).toBe(true);

    // Work areas should include src/auth
    expect(result.work_areas).toContain('src/auth');
  });

  it('get_developer returns empty profile for unknown developer', () => {
    const result = getDeveloper({ name: 'NonExistentPerson' });

    expect(result.name).toBe('NonExistentPerson');
    expect(result.recent_commits).toHaveLength(0);
    expect(result.files).toHaveLength(0);
    expect(result.work_areas).toHaveLength(0);
  });

  it('get_developer fuzzy-matches partial name', () => {
    // 'alic' should match 'Alice'
    const result = getDeveloper({ name: 'alic' });
    expect(result.name).toBe('Alice');
    expect(result.recent_commits.length).toBeGreaterThan(0);
  });

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
        expect(result.interval).toBe(30);
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
});
