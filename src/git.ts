import { execFileSync } from 'node:child_process';
import type { GitCommit } from './types.js';

const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };

// ---------------------------------------------------------------------------
// Auto-fetch: throttled fetch-on-demand
// ---------------------------------------------------------------------------

const DEFAULT_FETCH_STALENESS_SECS = 30;
let lastFetchTimestamp = 0;

/**
 * Ensures remote refs are fresh by running `git fetch --all --prune` if the
 * last fetch was more than `stalenessSeconds` ago. Safe to call frequently —
 * the throttle prevents hammering the remote.
 *
 * The staleness check uses a module-level timestamp that persists for the
 * lifetime of the process, so repeated calls within the window are no-ops.
 * If the fetch command fails (e.g. no network, no remote configured), the
 * timestamp is **not** updated — the next call will retry immediately.
 *
 * @param stalenessSeconds - Maximum age (in seconds) of the last successful
 *   fetch before a new one is triggered. Defaults to {@link DEFAULT_FETCH_STALENESS_SECS} (30s).
 * @returns `true` if a fetch was actually performed, `false` if the data was
 *   still fresh or the fetch failed.
 */
export function ensureFresh(stalenessSeconds: number = DEFAULT_FETCH_STALENESS_SECS): boolean {
  const now = Date.now() / 1000;
  if (now - lastFetchTimestamp < stalenessSeconds) return false;

  try {
    execFileSync('git', ['fetch', '--all', '--prune'], {
      ...EXEC_OPTS,
      timeout: 15_000, // 15s timeout so a slow remote doesn't hang the tool
    });
    lastFetchTimestamp = now;
    return true;
  } catch {
    // Fetch failed (no network, no remote, etc.) — continue with stale data
    return false;
  }
}

// Internal helpers

function run(args: string[]): string {
  try {
    return (execFileSync('git', args, EXEC_OPTS) as string).trim();
  } catch {
    return '';
  }
}

// Like run() but preserves internal whitespace (only strips trailing newline).
// Needed for porcelain output where leading spaces carry meaning.
function runRaw(args: string[]): string {
  try {
    return (execFileSync('git', args, EXEC_OPTS) as string).replace(/\n$/, '');
  } catch {
    return '';
  }
}

function runOrNull(args: string[]): string | null {
  try {
    return (execFileSync('git', args, EXEC_OPTS) as string).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

export function getRepoRoot(): string | null {
  return runOrNull(['rev-parse', '--show-toplevel']);
}

export function getCurrentUser(): string | null {
  return runOrNull(['config', 'user.name']);
}

export function getCurrentBranch(): string | null {
  const result = runOrNull(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (result === null || result === 'HEAD') return null;
  return result;
}

export interface LogOptions {
  all?: boolean;
  since?: string;
  author?: string;
  path?: string;
}

// Unique sentinel used to delimit commits in getLog output.
// Must not appear in commit messages or file paths.
const COMMIT_SEP = '---SWARMCODE_COMMIT---';

export function getLog(opts: LogOptions): GitCommit[] {
  // Prepend sentinel to format so we can split commits reliably.
  // git --name-only places a blank line between the header and file list within
  // a commit, and another blank line separates consecutive commits — meaning a
  // naive split on blank lines mis-associates headers with the wrong file list.
  // Using a sentinel at the start of each header line is more reliable.
  const args = ['log', `--format=${COMMIT_SEP}%H|%an|%ae|%at|%s`, '--name-only', '--no-merges'];
  if (opts.all) args.push('--all');
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.author) args.push(`--author=${opts.author}`);
  if (opts.path) {
    args.push('--');
    args.push(opts.path);
  }

  const output = run(args);
  if (!output) return [];

  // Split on the sentinel — first element will be empty string (before first sentinel)
  const blocks = output.split(COMMIT_SEP);
  const commits: GitCommit[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;

    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const header = lines[0];
    const parts = header.split('|');
    if (parts.length < 5) continue;

    const [hash, author, email, timestampStr, ...messageParts] = parts;
    const message = messageParts.join('|'); // re-join in case message has pipes
    const timestamp = parseInt(timestampStr, 10);
    const files = lines.slice(1).filter((l) => l.length > 0);

    commits.push({ hash, author, email, timestamp, message, files });
  }

  return commits;
}

export function getActiveRemoteBranches(): string[] {
  try {
    const output = (
      execFileSync('git', ['branch', '-r', '--sort=-committerdate'], EXEC_OPTS) as string
    );
    return output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.includes('->'));
  } catch {
    return [];
  }
}

export function getMergeBase(branch1: string, branch2: string): string | null {
  return runOrNull(['merge-base', branch1, branch2]);
}

export function getFilesChangedOnBranch(currentBranch: string, remoteBranch: string): string[] {
  const base = getMergeBase(currentBranch, remoteBranch);
  if (!base) return [];

  const output = run(['diff', '--name-only', `${base}..${remoteBranch}`]);
  if (!output) return [];
  return output.split('\n').filter((l) => l.length > 0);
}

export function getLocallyModifiedFiles(path?: string): string[] {
  const args = ['status', '--porcelain'];
  if (path !== undefined) {
    args.push('--');
    args.push(path);
  }
  const output = runRaw(args);
  if (!output) return [];
  return output.split('\n').filter((l) => l.length > 0).map((l) => l.slice(3));
}

export function getBranchAuthor(branch: string): string | null {
  return runOrNull(['log', '-1', '--format=%an', branch]);
}

export function getAllAuthors(): string[] {
  try {
    const output = (execFileSync('git', ['log', '--all', '--format=%an'], EXEC_OPTS) as string);
    const names = output.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    return [...new Set(names)];
  } catch {
    return [];
  }
}

export function getLastModifier(filePath: string): { author: string; timestamp: number } | null {
  const result = runOrNull(['log', '-1', '--format=%an|%at', '--', filePath]);
  if (!result) return null;
  const pipeIdx = result.indexOf('|');
  if (pipeIdx === -1) return null;
  const author = result.slice(0, pipeIdx);
  const timestamp = parseInt(result.slice(pipeIdx + 1), 10);
  if (!author || isNaN(timestamp)) return null;
  return { author, timestamp };
}

export function getFileFromBranch(branch: string, path: string): string | null {
  return runOrNull(['show', `${branch}:${path}`]);
}

export function getStatusForPath(path: string): string[] {
  const args = ['status', '--porcelain', '--', path];
  const output = runRaw(args);
  if (!output) return [];
  return output.split('\n').filter((l) => l.length > 0).map((l) => l.slice(3));
}

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

/**
 * Detects the main/default branch by checking remote then local branches.
 * Prefers `origin/main` over `origin/master`, falls back to local `main` or
 * `master`, and returns `'HEAD'` if none are found.
 */
export function getMainBranch(): string {
  const remote = run(['branch', '-r']);
  if (remote.includes('origin/main')) return 'origin/main';
  if (remote.includes('origin/master')) return 'origin/master';
  const local = run(['branch']);
  if (local.includes('main')) return 'main';
  if (local.includes('master')) return 'master';
  return 'HEAD';
}

export function getBranchAheadBehind(
  branch: string,
  base: string,
): { ahead: number; behind: number } {
  const result = runOrNull(['rev-list', '--count', '--left-right', `${base}...${branch}`]);
  if (!result) return { ahead: 0, behind: 0 };
  const parts = result.split('\t');
  if (parts.length < 2) return { ahead: 0, behind: 0 };
  return { ahead: parseInt(parts[1], 10) || 0, behind: parseInt(parts[0], 10) || 0 };
}

export function getBranchLog(branch: string, since: string): GitCommit[] {
  const main = getMainBranch();

  // Try range (branch-specific commits), fall back to plain log if no merge-base
  let output = run([
    'log',
    `--format=${COMMIT_SEP}%H|%an|%ae|%at|%s`,
    '--name-only',
    '--no-merges',
    `--since=${since}`,
    `${main}..${branch}`,
  ]);

  if (!output) {
    // Fallback: just show recent commits on this branch
    output = run([
      'log',
      `--format=${COMMIT_SEP}%H|%an|%ae|%at|%s`,
      '--name-only',
      '--no-merges',
      `--since=${since}`,
      '-20',
      branch,
    ]);
  }

  if (!output) return [];

  const blocks = output.split(COMMIT_SEP);
  const commits: GitCommit[] = [];

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const header = lines[0];
    const parts = header.split('|');
    if (parts.length < 5) continue;

    const [hash, author, email, timestampStr, ...messageParts] = parts;
    const message = messageParts.join('|');
    const timestamp = parseInt(timestampStr, 10);
    const files = lines.slice(1).filter((l) => l.length > 0);
    commits.push({ hash, author, email, timestamp, message, files });
  }

  return commits;
}

/** Get remote branches that are fully merged into a base branch. */
export function getMergedRemoteBranches(base?: string): string[] {
  const mainBranch = base ?? getMainBranch();
  const output = run(['branch', '-r', '--merged', mainBranch]);
  if (!output) return [];
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes('->'))
    .filter((l) => {
      // Exclude the main branch itself
      const short = l.replace(/^origin\//, '');
      const mainShort = mainBranch.replace(/^origin\//, '');
      return short !== mainShort;
    });
}

/** Get the timestamp of the most recent commit on a branch. */
export function getBranchLastCommitTime(branch: string): number {
  const result = runOrNull(['log', '-1', '--format=%at', branch]);
  if (!result) return 0;
  return parseInt(result, 10) || 0;
}

/** Get recent commit messages on the current branch since a given SHA. */
export function getCommitMessagesSince(sinceSha: string): Array<{ hash: string; message: string }> {
  const output = run(['log', `${sinceSha}..HEAD`, '--format=%H|%s']);
  if (!output) return [];
  return output.split('\n').filter(l => l.length > 0).map(l => {
    const idx = l.indexOf('|');
    return { hash: l.slice(0, idx), message: l.slice(idx + 1) };
  });
}

/** Check if the current branch has an open PR on GitHub. */
export function hasOpenPR(): boolean {
  try {
    const result = execFileSync('gh', ['pr', 'view', '--json', 'state', '--jq', '.state'], {
      ...EXEC_OPTS,
      timeout: 10_000,
    }) as string;
    return result.trim() === 'OPEN';
  } catch {
    return false;
  }
}

export interface MergeConflict {
  branch: string;
  conflictingFiles: string[];
}

/**
 * Run `git merge-tree` against another branch to detect if merging would produce conflicts.
 * Returns conflicting file paths, or empty array if merge would be clean.
 * Requires Git 2.38+.
 */
export function getMergeTreeConflicts(otherBranch: string): string[] {
  try {
    execFileSync('git', ['merge-tree', 'HEAD', otherBranch], EXEC_OPTS);
    // Exit code 0 = clean merge, no conflicts
    return [];
  } catch (err: any) {
    // Exit code 1 = conflicts detected
    // The stdout contains the merged tree info, stderr may have conflict details
    // Parse stdout for conflict markers — lines with "CONFLICT" contain file paths
    const output = (err.stdout ?? '').toString();
    const files: string[] = [];
    for (const line of output.split('\n')) {
      // Format: "CONFLICT (content): Merge conflict in <filepath>"
      const match = line.match(/Merge conflict in (.+)/);
      if (match) files.push(match[1].trim());
      // Also: "CONFLICT (add/add): Merge conflict in <filepath>"
      // Also: "Auto-merging <filepath>" lines are NOT conflicts
    }
    return files;
  }
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
