import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { AgentRun, RunConfig } from './types.js';

const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };

export function buildAgentPrompt(): string {
  return [
    'You have swarmcode available as an MCP server.',
    'Call start_session to initialize, then look at available issues using linear_get_issues.',
    'Pick an available issue using pick_issue — choose one that is NOT already In Progress or assigned.',
    'Create your branch using the branchName returned by pick_issue.',
    'Implement the work described in the issue, commit and push frequently.',
    'When done, call complete_issue to mark it Done.',
    'Do not work on issues that are already In Progress and assigned to someone else.',
  ].join(' ');
}

export function buildMcpConfig(): string {
  const isWindows = process.platform === 'win32';
  const mcpServer = isWindows
    ? { command: 'cmd', args: ['/c', 'npx', 'swarmcode'] }
    : { command: 'npx', args: ['swarmcode'] };

  return JSON.stringify({ mcpServers: { swarmcode: mcpServer } }, null, 2);
}

export function createWorktree(repoRoot: string, worktreePath: string, baseBranch: string, newBranch: string): void {
  execFileSync('git', ['worktree', 'add', '-b', newBranch, worktreePath, baseBranch], {
    ...EXEC_OPTS,
    cwd: repoRoot,
  });
}

export function removeWorktree(repoRoot: string, worktreePath: string): void {
  try {
    execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
      ...EXEC_OPTS,
      cwd: repoRoot,
    });
  } catch {
    // Worktree may already be removed
  }
}

export function launchAgent(agent: AgentRun, config: RunConfig): ChildProcess {
  const prompt = buildAgentPrompt();

  // Write .mcp.json into the worktree
  writeFileSync(join(agent.worktreePath, '.mcp.json'), buildMcpConfig());

  // Create log directory
  mkdirSync(config.resultsDir, { recursive: true });
  const logPath = join(config.resultsDir, `${agent.id}.log`);
  const logStream = createWriteStream(logPath);

  const args = ['-p', prompt, '--dangerously-skip-permissions'];
  if (agent.agentType) {
    args.push('--agent', agent.agentType);
  }

  const child = spawn('claude', args, {
    cwd: agent.worktreePath,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      SWARMCODE_LINEAR_API_KEY: process.env.SWARMCODE_LINEAR_API_KEY,
      SWARMCODE_LINEAR_TEAM: config.linearTeamKey,
    },
  });

  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  return child;
}
