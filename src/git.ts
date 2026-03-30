import { execFileSync } from 'node:child_process';
import type { GitCommit } from './types.js';

const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };

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

export function getStatusForPath(path: string): string[] {
  const args = ['status', '--porcelain', '--', path];
  const output = runRaw(args);
  if (!output) return [];
  return output.split('\n').filter((l) => l.length > 0).map((l) => l.slice(3));
}
