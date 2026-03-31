/**
 * demo-two-agents.ts
 *
 * A runnable demo that simulates two AI agents (Alice and Bob) coordinating on
 * the same project using swarmcode's MCP tools.
 *
 * Run with: npx tsx scripts/demo-two-agents.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { getTeamActivity } from '../src/tools/get-team-activity.js';
import { checkPath } from '../src/tools/check-path.js';
import { searchTeamCode } from '../src/tools/search-team-code.js';
import { checkConflicts } from '../src/tools/check-conflicts.js';
import { getDeveloper } from '../src/tools/get-developer.js';
import { enableAutoPush, disableAutoPush } from '../src/tools/auto-push.js';

// ---------------------------------------------------------------------------
// Colors (ANSI escape codes, no emoji)
// ---------------------------------------------------------------------------

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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

function section(title: string): void {
  console.log(`\n${BOLD}--- ${title} ---${RESET}\n`);
}

function tool(name: string): void {
  console.log(`  ${YELLOW}[${name}]${RESET}`);
}

function info(msg: string): void {
  console.log(`  ${msg}`);
}

function result(msg: string): void {
  console.log(`    ${GREEN}${msg}${RESET}`);
}

function warn(msg: string): void {
  console.log(`    ${RED}${msg}${RESET}`);
}

function dim(msg: string): void {
  console.log(`    ${DIM}${msg}${RESET}`);
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const originalCwd = process.cwd();

  // Create temp directories
  const base = mkdtempSync(join(tmpdir(), 'swarmcode-demo-'));
  const bareDir = join(base, 'remote.git');
  const aliceDir = join(base, 'alice');
  const bobDir = join(base, 'bob');

  try {
    // =====================================================================
    // Step 1: Setup
    // =====================================================================

    console.log(`\n${BOLD}=== Two-Agent Coordination Demo ===${RESET}\n`);
    console.log('Setting up: bare remote, two clones (Alice, Bob)...');

    // Create a bare remote with 'main' as default branch
    mkdirSync(bareDir);
    gitIn(bareDir, ['init', '--bare', '--initial-branch=main']);

    // Initialize Alice's repo manually (avoid cloning an empty repo)
    mkdirSync(aliceDir);
    gitIn(aliceDir, ['init', '-b', 'main']);
    gitIn(aliceDir, ['remote', 'add', 'origin', bareDir]);
    gitIn(aliceDir, ['config', 'user.name', 'Alice']);
    gitIn(aliceDir, ['config', 'user.email', 'alice@example.com']);

    // Initial commit from Alice's clone (so there is a root commit)
    commitAs(aliceDir, 'Alice', 'alice@example.com', 'chore: initial commit', {
      'README.md': '# Demo Project\n',
    });
    gitIn(aliceDir, ['push', '-u', 'origin', 'main']);

    // Clone for Bob (now the remote has content)
    execFileSync('git', ['clone', bareDir, bobDir], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    gitIn(bobDir, ['config', 'user.name', 'Bob']);
    gitIn(bobDir, ['config', 'user.email', 'bob@example.com']);

    console.log(`${GREEN}Done.${RESET}`);

    // =====================================================================
    // Step 2: Alice starts her session
    // =====================================================================

    section(`Agent ${CYAN}Alice${RESET}: Starting session`);

    process.chdir(aliceDir);

    // Alice calls get_team_activity
    tool('get_team_activity');
    const aliceTeam1 = getTeamActivity({ since: '7d' });
    if (aliceTeam1.length === 0) {
      result('No teammates found yet.');
    } else {
      for (const a of aliceTeam1) {
        result(`${a.name} - last active ${timeAgo(a.last_active)}`);
      }
    }

    // Alice creates feat/auth branch
    info(`${CYAN}Alice${RESET} creates feat/auth branch`);
    gitIn(aliceDir, ['checkout', '-b', 'feat/auth']);

    // Alice writes src/auth/login.ts
    info(`${CYAN}Alice${RESET} writes src/auth/login.ts`);
    commitAs(aliceDir, 'Alice', 'alice@example.com', 'feat: add auth login module', {
      'src/auth/login.ts': [
        "import type { Token } from './types';",
        '',
        'export function login(user: string, password: string): Promise<Token> {',
        "  return fetch('/api/auth/login', {",
        "    method: 'POST',",
        '    body: JSON.stringify({ user, password }),',
        '  }).then(r => r.json());',
        '}',
        '',
        'export function validateToken(token: Token): boolean {',
        '  return token.expiresAt > Date.now();',
        '}',
        '',
      ].join('\n'),
      'src/auth/types.ts': [
        'export interface Token {',
        '  value: string;',
        '  expiresAt: number;',
        '}',
        '',
      ].join('\n'),
    });

    // Alice pushes
    info(`${CYAN}Alice${RESET} commits and pushes`);
    gitIn(aliceDir, ['push', '-u', 'origin', 'feat/auth']);

    // =====================================================================
    // Step 3: Bob starts his session
    // =====================================================================

    section(`Agent ${CYAN}Bob${RESET}: Starting session`);

    process.chdir(bobDir);

    // Bob needs to see Alice's remote branches
    gitIn(bobDir, ['fetch', 'origin']);

    // Bob calls get_team_activity
    tool('get_team_activity');
    const bobTeam = getTeamActivity({ since: '7d' });
    if (bobTeam.length === 0) {
      result('No teammates found.');
    } else {
      for (const a of bobTeam) {
        result(`${a.name} - last active ${timeAgo(a.last_active)}`);
        if (a.work_areas.length > 0) {
          dim(`Working in: ${a.work_areas.join(', ')}`);
        }
        if (a.active_branches.length > 0) {
          dim(`Branches: ${a.active_branches.join(', ')}`);
        }
      }
    }

    // Bob calls check_path on Alice's file
    tool('check_path');
    info('  path: src/auth/login.ts');
    const pathResult = checkPath({ path: 'src/auth/login.ts' });
    if (pathResult.primary_owner) {
      result(`Primary author: ${pathResult.primary_owner} (${pathResult.recent_authors[0]?.commit_count ?? 0} commit(s))`);
    } else {
      result('No recent authors found');
    }
    result(`Risk: ${pathResult.risk} - ${pathResult.risk_reason}`);

    // Bob calls search_team_code — need to checkout a branch where files exist
    // First, create a temporary tracking branch so we can read Alice's files
    gitIn(bobDir, ['checkout', '-b', 'temp-search', 'origin/feat/auth']);
    tool('search_team_code');
    info('  query: "login"');
    const searchResults = searchTeamCode({ query: 'login' });
    if (searchResults.length === 0) {
      result('No matching exports found.');
    } else {
      for (const match of searchResults) {
        result(`Found: ${match.name}() in ${match.file}`);
        dim(`Last modified by: ${match.last_modified_by}`);
      }
    }
    // Return to main
    gitIn(bobDir, ['checkout', 'main']);
    gitIn(bobDir, ['branch', '-D', 'temp-search']);

    // =====================================================================
    // Step 4: Bob works in a safe area
    // =====================================================================

    info(`\n  ${CYAN}Bob${RESET} creates feat/dashboard branch`);
    gitIn(bobDir, ['checkout', '-b', 'feat/dashboard']);

    info(`  ${CYAN}Bob${RESET} writes src/components/Dashboard.tsx ${DIM}(safe area)${RESET}`);
    commitAs(bobDir, 'Bob', 'bob@example.com', 'feat: add Dashboard component', {
      'src/components/Dashboard.tsx': [
        "import { validateToken } from '../auth/login';",
        '',
        'export function Dashboard() {',
        '  return (',
        '    <div className="dashboard">',
        '      <h1>Welcome to the Dashboard</h1>',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
    });

    // =====================================================================
    // Step 5: Bob also modifies Alice's file (risky!)
    // =====================================================================

    info(`  ${CYAN}Bob${RESET} also modifies src/auth/login.ts ${RED}(risky!)${RESET}`);
    commitAs(bobDir, 'Bob', 'bob@example.com', 'feat: add session timeout to login', {
      'src/auth/login.ts': [
        "import type { Token } from './types';",
        '',
        'export function login(user: string, password: string, timeout = 5000): Promise<Token> {',
        '  const controller = new AbortController();',
        '  setTimeout(() => controller.abort(), timeout);',
        "  return fetch('/api/auth/login', {",
        "    method: 'POST',",
        '    body: JSON.stringify({ user, password }),',
        '    signal: controller.signal,',
        '  }).then(r => r.json());',
        '}',
        '',
        'export function validateToken(token: Token): boolean {',
        '  return token.expiresAt > Date.now();',
        '}',
        '',
      ].join('\n'),
    });

    info(`  ${CYAN}Bob${RESET} commits and pushes`);
    gitIn(bobDir, ['push', '-u', 'origin', 'feat/dashboard']);

    // =====================================================================
    // Step 6: Alice checks for problems
    // =====================================================================

    section(`Agent ${CYAN}Alice${RESET}: Checking for problems`);

    process.chdir(aliceDir);

    // Alice switches to main and fetches to see all remote branches
    gitIn(aliceDir, ['checkout', 'main']);
    gitIn(aliceDir, ['fetch', 'origin']);

    // Alice calls check_conflicts (from main, both feat branches are "other")
    tool('check_conflicts');
    const conflicts = checkConflicts();
    if (conflicts.conflicts.length === 0) {
      result('No potential conflicts detected.');
    } else {
      for (const c of conflicts.conflicts) {
        warn(`WARNING: ${c.file} modified on ${c.branches.length + (c.local ? 1 : 0)} branch(es)`);
        for (const b of c.branches) {
          dim(`- ${b.branch} (${b.author})`);
        }
        if (c.local) {
          dim('- (local working copy)');
        }
        warn(`Severity: ${c.severity}`);
      }
    }
    result(conflicts.summary);

    // Alice calls get_developer for Bob
    tool('get_developer');
    info('  name: "Bob"');
    const bobProfile = getDeveloper({ name: 'Bob' });
    if (bobProfile.recent_commits.length > 0) {
      result(`Recent commits:`);
      for (const c of bobProfile.recent_commits) {
        dim(`  ${c.message}`);
      }
    }
    if (bobProfile.work_areas.length > 0) {
      result(`Working in: ${bobProfile.work_areas.join(', ')}`);
    }

    // =====================================================================
    // Step 7: Auto-push demo
    // =====================================================================

    section('Auto-Push Demo');

    // Switch back to feat/auth for auto-push (auto-push rejects protected branches)
    gitIn(aliceDir, ['checkout', 'feat/auth']);

    info(`  ${CYAN}Alice${RESET} enables auto-push (interval: 1s)`);
    const apResult = enableAutoPush({ interval: 1 });
    result(`Auto-push enabled on branch: ${apResult.branch}, interval: ${apResult.interval}s`);

    try {
      info(`  ${CYAN}Alice${RESET} makes a new commit...`);
      commitAs(aliceDir, 'Alice', 'alice@example.com', 'feat: add token refresh utility', {
        'src/auth/refresh.ts': [
          "import type { Token } from './types';",
          '',
          'export async function refreshToken(token: Token): Promise<Token> {',
          "  return fetch('/api/auth/refresh', {",
          "    method: 'POST',",
          '    headers: { Authorization: `Bearer ${token.value}` },',
          '  }).then(r => r.json());',
          '}',
          '',
        ].join('\n'),
      });

      info('  Waiting for auto-push...');
      await sleep(2500);
    } finally {
      const disableResult = disableAutoPush();
      info(`  ${CYAN}Alice${RESET} disables auto-push: ${GREEN}${disableResult.pushes_made} push(es) made${RESET}`);
    }

    // =====================================================================
    // Done
    // =====================================================================

    console.log(`\n${BOLD}=== Demo complete ===${RESET}\n`);

  } finally {
    // Always restore original cwd and clean up
    process.chdir(originalCwd);
    disableAutoPush(); // safety net

    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

main().catch((err) => {
  console.error(`${RED}Demo failed:${RESET}`, err);
  process.exit(1);
});
