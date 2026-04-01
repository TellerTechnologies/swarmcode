import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as git from '../git.js';
import { checkConflicts } from '../tools/check-conflicts.js';
import { getProjectContext } from '../tools/get-project-context.js';
import { getLinearData, isConfigured as linearConfigured, type LinearData } from '../linear.js';
import type { ConflictReport, ProjectContextResult, GitCommit } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DashboardAuthor {
  name: string;
  active_branches: string[];
  work_areas: string[];
  recent_files: string[];
  last_active: number;
  recent_commits: Array<{ message: string; timestamp: number; hash: string }>;
}

export interface BranchTimelineEntry {
  name: string;
  author: string;
  commits: Array<{ hash: string; message: string; timestamp: number }>;
  ahead: number;
  behind: number;
  last_active: number;
  is_current: boolean;
}

export interface DashboardData {
  activity: DashboardAuthor[];
  conflicts: ConflictReport;
  branches: BranchTimelineEntry[];
  context: ProjectContextResult;
  linear: LinearData | null;
  repo: string;
  timestamp: number;
}

/**
 * Dashboard-specific team activity — includes ALL developers (including current user)
 * and returns richer data (commit hashes, work areas, more commits).
 */
function getDashboardActivity(): DashboardAuthor[] {
  const commits = git.getLog({ all: true, since: '7d' });
  const activeBranches = git.getActiveRemoteBranches();

  const byAuthor = new Map<string, GitCommit[]>();
  for (const commit of commits) {
    const existing = byAuthor.get(commit.author);
    if (existing) {
      existing.push(commit);
    } else {
      byAuthor.set(commit.author, [commit]);
    }
  }

  const results: DashboardAuthor[] = [];

  for (const [author, authorCommits] of byAuthor) {
    const authorBranches = activeBranches.filter(
      (branch) => git.getBranchAuthor(branch) === author,
    );

    const allFiles: string[] = [];
    for (const commit of authorCommits) {
      allFiles.push(...commit.files);
    }

    // Infer work areas (top directories by frequency)
    const dirCounts = new Map<string, number>();
    for (const file of allFiles) {
      const lastSlash = file.lastIndexOf('/');
      if (lastSlash === -1) continue;
      const dir = file.slice(0, lastSlash);
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
    const workAreas = [...dirCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dir]) => dir);

    // Unique recent files
    const seen = new Set<string>();
    const recentFiles: string[] = [];
    for (const file of allFiles) {
      if (seen.has(file)) continue;
      seen.add(file);
      recentFiles.push(file);
      if (recentFiles.length >= 20) break;
    }

    const lastActive = Math.max(...authorCommits.map((c) => c.timestamp));

    // More commits with hashes for the dashboard
    const recentCommits = authorCommits.slice(0, 10).map((c) => ({
      message: c.message,
      timestamp: c.timestamp,
      hash: c.hash.slice(0, 7),
    }));

    results.push({
      name: author,
      active_branches: authorBranches,
      work_areas: workAreas,
      recent_files: recentFiles,
      last_active: lastActive,
      recent_commits: recentCommits,
    });
  }

  results.sort((a, b) => b.last_active - a.last_active);
  return results;
}

function getBranchTimeline(): BranchTimelineEntry[] {
  const currentBranch = git.getCurrentBranch();
  const mainBranch = git.getMainBranch();
  const remoteBranches = git.getActiveRemoteBranches();

  const entries: BranchTimelineEntry[] = [];

  const mainShort = mainBranch.replace(/^origin\//, '');

  for (const branch of remoteBranches.slice(0, 30)) {
    // Skip HEAD pointer and main branch (we compare against it)
    if (branch.includes('->')) continue;
    const shortName = branch.replace(/^origin\//, '');
    if (shortName === mainShort) continue;

    const author = git.getBranchAuthor(branch) ?? 'unknown';
    const commits = git.getBranchLog(branch, '48h');
    const { ahead, behind } = git.getBranchAheadBehind(branch, mainBranch);

    // Skip branches with no activity and no divergence
    if (commits.length === 0 && ahead === 0) continue;

    const last_active = commits.length > 0
      ? Math.max(...commits.map((c) => c.timestamp))
      : 0;

    const is_current = shortName === currentBranch;

    entries.push({
      name: shortName,
      author,
      commits: commits.slice(0, 50).map((c) => ({
        hash: c.hash.slice(0, 7),
        message: c.message,
        timestamp: c.timestamp,
      })),
      ahead,
      behind,
      last_active,
      is_current,
    });
  }

  // Sort by last_active descending, then by name
  entries.sort((a, b) => b.last_active - a.last_active || a.name.localeCompare(b.name));

  return entries;
}

// Cache Linear data separately (API call is slower than git)
let cachedLinear: LinearData | null = null;
let linearFetchedAt = 0;
const LINEAR_STALENESS_SECS = 60; // refresh Linear every 60s

async function fetchLinearIfNeeded(): Promise<LinearData | null> {
  if (!linearConfigured()) return null;

  const now = Date.now() / 1000;
  if (now - linearFetchedAt < LINEAR_STALENESS_SECS) return cachedLinear;

  try {
    cachedLinear = await getLinearData();
    linearFetchedAt = now;
  } catch (err: any) {
    console.error(`[swarmcode] Linear fetch failed: ${err.message}`);
    // Keep stale cache if we have it
  }

  return cachedLinear;
}

async function getAllData(): Promise<DashboardData> {
  git.ensureFresh();

  const repoRoot = git.getRepoRoot() ?? process.cwd();
  const repo = repoRoot.split('/').pop() ?? 'unknown';

  const linear = await fetchLinearIfNeeded();

  return {
    activity: getDashboardActivity(),
    conflicts: checkConflicts(),
    branches: getBranchTimeline(),
    context: getProjectContext({}),
    linear,
    repo,
    timestamp: Date.now(),
  };
}

function sendJson(res: ServerResponse, data: unknown): void {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, html: string): Promise<void> {
  const url = req.url ?? '/';

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url === '/api/all') {
    sendJson(res, await getAllData());
    return;
  }

  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial data
    const initial = await getAllData();
    res.write(`data: ${JSON.stringify(initial)}\n\n`);

    // Push updates every 30 seconds
    const interval = setInterval(async () => {
      try {
        const data = await getAllData();
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        clearInterval(interval);
      }
    }, 30_000);

    req.on('close', () => clearInterval(interval));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

export function startDashboard(port: number): void {
  let html: string;
  try {
    html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
  } catch {
    // When running via tsx, __dirname points to src/dashboard/
    // Try the source location
    html = readFileSync(join(__dirname, '..', '..', 'src', 'dashboard', 'index.html'), 'utf-8');
  }

  const server = createHttpServer((req, res) => handleRequest(req, res, html));

  server.listen(port, () => {
    console.log(`\n  Swarmcode Dashboard`);
    console.log(`  http://localhost:${port}\n`);
    console.log(`  Live-updating every 30 seconds. Press Ctrl+C to stop.\n`);
  });
}
