import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as git from '../git.js';
import { getTeamActivity } from '../tools/get-team-activity.js';
import { checkConflicts } from '../tools/check-conflicts.js';
import { getProjectContext } from '../tools/get-project-context.js';
import type { AuthorActivity, ConflictReport, ProjectContextResult } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  activity: AuthorActivity[];
  conflicts: ConflictReport;
  branches: BranchTimelineEntry[];
  context: ProjectContextResult;
  repo: string;
  timestamp: number;
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
    const commits = git.getBranchLog(branch, '14d');
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

function getAllData(): DashboardData {
  git.ensureFresh();

  const repoRoot = git.getRepoRoot() ?? process.cwd();
  const repo = repoRoot.split('/').pop() ?? 'unknown';

  return {
    activity: getTeamActivity({ since: '24h' }),
    conflicts: checkConflicts(),
    branches: getBranchTimeline(),
    context: getProjectContext({}),
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

function handleRequest(req: IncomingMessage, res: ServerResponse, html: string): void {
  const url = req.url ?? '/';

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url === '/api/all') {
    sendJson(res, getAllData());
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
    res.write(`data: ${JSON.stringify(getAllData())}\n\n`);

    // Push updates every 30 seconds
    const interval = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify(getAllData())}\n\n`);
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
