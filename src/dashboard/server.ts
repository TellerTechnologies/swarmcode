import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as git from '../git.js';
import { checkConflicts } from '../tools/check-conflicts.js';
import { getProjectContext } from '../tools/get-project-context.js';
import { getLinearDataForDashboard, getTeams, isConfigured as linearConfigured, type LinearData, type LinearTeam } from '../linear.js';
import type { ConflictReport, ProjectContextResult, GitCommit, StatusChange } from '../types.js';

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

export interface DashboardData {
  activity: DashboardAuthor[];
  conflicts: ConflictReport;
  context: ProjectContextResult;
  linear: LinearData | null;
  teams: LinearTeam[];
  statusChanges: StatusChange[];
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

// Cache Linear data separately (API call is slower than git)
let cachedLinear: LinearData | null = null;
let linearFetchedAt = 0;
const LINEAR_STALENESS_SECS = 60; // refresh Linear every 60s

// Track Linear issue statuses between ticks for change detection
let previousStatuses = new Map<string, string>();

function detectStatusChanges(issues: LinearData['issues']): StatusChange[] {
  const changes: StatusChange[] = [];
  const currentStatuses = new Map<string, string>();

  for (const issue of issues) {
    currentStatuses.set(issue.id, issue.status);

    const prev = previousStatuses.get(issue.id);
    if (prev && prev !== issue.status) {
      changes.push({
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        fromStatus: prev,
        toStatus: issue.status,
        actor: issue.assignee,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
  }

  previousStatuses = currentStatuses;
  return changes;
}

let cachedLinearTeam: string | undefined;

async function fetchLinearIfNeeded(teamKey?: string): Promise<LinearData | null> {
  if (!linearConfigured()) return null;

  const now = Date.now() / 1000;
  const teamChanged = teamKey !== cachedLinearTeam;
  if (!teamChanged && now - linearFetchedAt < LINEAR_STALENESS_SECS) return cachedLinear;

  if (teamChanged) {
    previousStatuses = new Map();
  }

  try {
    cachedLinear = await getLinearDataForDashboard(teamKey);
    cachedLinearTeam = teamKey;
    linearFetchedAt = now;
  } catch (err: any) {
    console.error(`[swarmcode] Linear fetch failed: ${err.message}`);
  }

  return cachedLinear;
}

let cachedTeams: LinearTeam[] = [];
let teamsFetchedAt = 0;

async function fetchTeamsIfNeeded(): Promise<LinearTeam[]> {
  if (!linearConfigured()) return [];

  const now = Date.now() / 1000;
  if (now - teamsFetchedAt < 300) return cachedTeams; // refresh every 5 min

  try {
    cachedTeams = await getTeams();
    teamsFetchedAt = now;
  } catch (err: any) {
    console.error(`[swarmcode] Teams fetch failed: ${err.message}`);
  }

  return cachedTeams;
}

async function getAllData(teamKey?: string): Promise<DashboardData> {
  git.ensureFresh();

  const repoRoot = git.getRepoRoot() ?? process.cwd();
  const repo = repoRoot.split('/').pop() ?? 'unknown';

  const linear = await fetchLinearIfNeeded(teamKey);
  const teams = await fetchTeamsIfNeeded();

  return {
    activity: getDashboardActivity(),
    conflicts: checkConflicts(),
    context: getProjectContext({}),
    linear,
    teams,
    statusChanges: [],
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

  if (url === '/api/all' || url.startsWith('/api/all?')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const teamKey = params.get('team') || undefined;
    sendJson(res, await getAllData(teamKey));
    return;
  }

  if (url === '/events' || url.startsWith('/events?')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const teamKey = params.get('team') || undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const initial = await getAllData(teamKey);
    initial.statusChanges = initial.linear ? detectStatusChanges(initial.linear.issues ?? []) : [];
    res.write(`data: ${JSON.stringify(initial)}\n\n`);

    const interval = setInterval(async () => {
      try {
        const data = await getAllData(teamKey);
        data.statusChanges = detectStatusChanges(data.linear?.issues ?? []);
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
