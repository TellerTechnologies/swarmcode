import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Scenario, RunConfig, AgentRun, Scorecard, MergeResult } from './types.js';
import { parseScenario } from './types.js';
import { EventCollector } from './event-collector.js';
import { launchAgent, createWorktree, removeWorktree } from './agent-launcher.js';
import { computeGrade, formatScorecard, saveScorecard } from './scorecard.js';
import * as linear from '../linear.js';

const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };
const AGENT_STAGGER_MS = 5_000;

export function generateRunId(scenarioName: string): string {
  const now = new Date();
  const date = now.toISOString().replace(/[-:T]/g, '').slice(0, 8);
  const time = now.toISOString().replace(/[-:T]/g, '').slice(8, 14);
  return `${scenarioName}-${date}-${time}`;
}

export function buildRunConfig(scenario: Scenario, linearTeamId: string, linearTeamKey: string): RunConfig {
  const runId = generateRunId(scenario.name);
  return {
    runId,
    scenario,
    resultsDir: join('test', 'results', runId),
    linearTeamId,
    linearTeamKey,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRepoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], EXEC_OPTS).trim();
}

async function createTestIssues(scenario: Scenario, teamId: string): Promise<string[]> {
  const identifiers: string[] = [];
  for (const issueDef of scenario.issues) {
    const result = await linear.createIssue({
      title: `[SWARMCODE-TEST] ${issueDef.title}`,
      teamId,
      description: issueDef.description,
    });
    if (!result.success || !result.issue) {
      throw new Error(`Failed to create issue: ${issueDef.title} — ${result.error}`);
    }
    try {
      const labels = await linear.getLabels();
      const testLabel = labels.find(l => l.name === 'swarmcode-test');
      if (testLabel) {
        await linear.addIssueLabel(result.issue.identifier, testLabel.id);
      }
    } catch {
      // Label not found — fine
    }
    identifiers.push(result.issue.identifier);
  }
  return identifiers;
}

async function archiveTestIssues(identifiers: string[]): Promise<void> {
  for (const id of identifiers) {
    try {
      await linear.archiveIssue(id);
    } catch { /* best effort */ }
  }
}

function mergeAgentBranches(repoRoot: string, testBranch: string, agents: AgentRun[]): MergeResult[] {
  const results: MergeResult[] = [];

  const sorted = [...agents].sort((a, b) => {
    try {
      const timeA = parseInt(execFileSync('git', ['log', '-1', '--format=%ct', a.branchName], { ...EXEC_OPTS, cwd: repoRoot }).trim(), 10);
      const timeB = parseInt(execFileSync('git', ['log', '-1', '--format=%ct', b.branchName], { ...EXEC_OPTS, cwd: repoRoot }).trim(), 10);
      return timeA - timeB;
    } catch {
      return 0;
    }
  });

  execFileSync('git', ['checkout', testBranch], { ...EXEC_OPTS, cwd: repoRoot });

  for (const agent of sorted) {
    try {
      execFileSync('git', ['merge', agent.branchName, '--no-edit'], { ...EXEC_OPTS, cwd: repoRoot });
      results.push({ branch: agent.branchName, success: true, conflictFiles: [] });
    } catch {
      const conflictFiles: string[] = [];
      try {
        const status = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { ...EXEC_OPTS, cwd: repoRoot }).trim();
        if (status) conflictFiles.push(...status.split('\n'));
      } catch { /* ignore */ }

      try {
        execFileSync('git', ['merge', '--abort'], { ...EXEC_OPTS, cwd: repoRoot });
      } catch { /* ignore */ }

      results.push({ branch: agent.branchName, success: false, conflictFiles });
    }
  }

  return results;
}

function detectFileOverlap(repoRoot: string, agents: AgentRun[], baseBranch: string): Array<{ file: string; agents: string[] }> {
  const fileAgentMap = new Map<string, string[]>();

  for (const agent of agents) {
    try {
      const files = execFileSync(
        'git', ['diff', '--name-only', `${baseBranch}...${agent.branchName}`],
        { ...EXEC_OPTS, cwd: repoRoot },
      ).trim();
      if (!files) continue;
      for (const file of files.split('\n')) {
        const existing = fileAgentMap.get(file) ?? [];
        existing.push(agent.id);
        fileAgentMap.set(file, existing);
      }
    } catch { /* Branch may not have commits yet */ }
  }

  return Array.from(fileAgentMap.entries())
    .filter(([, agentIds]) => agentIds.length > 1)
    .map(([file, agentIds]) => ({ file, agents: agentIds }));
}

function runTests(repoRoot: string, testCommand: string): boolean {
  try {
    const [cmd, ...args] = testCommand.split(' ');
    execFileSync(cmd, args, { ...EXEC_OPTS, cwd: repoRoot, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

function waitForAgent(
  agent: AgentRun,
  child: ReturnType<typeof launchAgent>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    child.on('exit', () => {
      agent.completedAt = new Date().toISOString();
      done();
    });

    setTimeout(() => {
      if (!resolved) {
        agent.timedOut = true;
        agent.completedAt = new Date().toISOString();
        child.kill('SIGTERM');
        done();
      }
    }, timeoutMs);
  });
}

async function pollLinearCompletion(identifiers: string[], collector: EventCollector): Promise<Map<string, boolean>> {
  const status = new Map<string, boolean>();
  for (const id of identifiers) {
    try {
      const issue = await linear.getIssue(id);
      const isComplete = issue.statusType === 'completed';
      const wasPrevComplete = status.get(id);
      if (isComplete && !wasPrevComplete) {
        collector.record({
          timestamp: new Date().toISOString(),
          agent: 'harness',
          type: 'linear_state_change',
          data: { issue: id, status: issue.status, statusType: issue.statusType },
        });
      }
      status.set(id, isComplete);
    } catch {
      status.set(id, false);
    }
  }
  return status;
}

export async function runScenario(scenarioPath: string): Promise<Scorecard> {
  const yamlContent = readFileSync(scenarioPath, 'utf-8');
  const scenario = parseScenario(yamlContent);

  console.log(`\nRunning scenario: ${scenario.name}`);
  console.log(`   ${scenario.agents} agents · ${scenario.issues.length} issues\n`);

  const teams = await linear.getTeams();
  const teamKey = process.env.SWARMCODE_LINEAR_TEAM ?? 'TEL';
  const team = teams.find(t => t.key === teamKey);
  if (!team) throw new Error(`Linear team '${teamKey}' not found`);

  const config = buildRunConfig(scenario, team.id, team.key);
  mkdirSync(config.resultsDir, { recursive: true });

  const repoRoot = getRepoRoot();
  const testBranch = `swarmcode-test/${config.runId}`;
  const startTime = Date.now();

  execFileSync('git', ['checkout', '-b', testBranch], { ...EXEC_OPTS, cwd: repoRoot });
  execFileSync('git', ['checkout', '-'], { ...EXEC_OPTS, cwd: repoRoot });

  console.log('   Creating Linear issues...');
  const issueIdentifiers = await createTestIssues(scenario, team.id);
  console.log(`   Created: ${issueIdentifiers.join(', ')}`);

  const agents: AgentRun[] = scenario.issues.map((issue, i) => ({
    id: `agent-${i + 1}`,
    worktreePath: join(repoRoot, '.swarmcode-test', config.runId, `agent-${i + 1}`),
    branchName: `swarmcode-test-agent-${i + 1}-${config.runId}`,
    issueIdentifier: issueIdentifiers[i],
    agentType: issue.agent,
    timedOut: false,
    issueCompleted: false,
  }));

  const collector = new EventCollector(agents, issueIdentifiers);

  console.log('   Launching agents...');
  const children: Array<ReturnType<typeof launchAgent>> = [];
  for (const agent of agents) {
    mkdirSync(join(repoRoot, '.swarmcode-test', config.runId), { recursive: true });
    createWorktree(repoRoot, agent.worktreePath, scenario.base_branch, agent.branchName);
    agent.startedAt = new Date().toISOString();

    collector.record({
      timestamp: agent.startedAt,
      agent: agent.id,
      type: 'agent_started',
      data: { worktree: agent.worktreePath, branch: agent.branchName },
    });

    const child = launchAgent(agent, config);
    agent.pid = child.pid;
    children.push(child);

    console.log(`   ${agent.id} launched (PID ${child.pid})`);

    if (agents.indexOf(agent) < agents.length - 1) {
      await sleep(AGENT_STAGGER_MS);
    }
  }

  collector.startGitPolling(10_000);

  const linearPollId = setInterval(async () => {
    const status = await pollLinearCompletion(issueIdentifiers, collector);
    for (const agent of agents) {
      if (status.get(agent.issueIdentifier)) {
        agent.issueCompleted = true;
      }
    }
  }, 15_000);

  const timeoutMs = scenario.timeout_minutes * 60 * 1000;
  console.log(`   Waiting for agents (timeout: ${scenario.timeout_minutes}m)...\n`);
  await Promise.all(agents.map((agent, i) => waitForAgent(agent, children[i], timeoutMs)));

  clearInterval(linearPollId);
  collector.stop();

  // Resolve actual issue→agent mapping from Linear state.
  // Agents freely pick from the backlog, so the static mapping (agent-N → issue-N)
  // may not match reality. Check which issues are actually completed.
  const completedIssues: string[] = [];
  for (const id of issueIdentifiers) {
    try {
      const issue = await linear.getIssue(id);
      if (issue.statusType === 'completed') {
        completedIssues.push(id);
      }
    } catch { /* ignore */ }
  }

  // Update agent completion based on total issues completed, not per-agent mapping.
  // We can't know exactly which agent did which issue without MCP interception (v2),
  // but we CAN check: did agent-N's branch contain commits referencing an issue ID?
  for (const agent of agents) {
    // First check if the originally-assigned issue is done
    if (completedIssues.includes(agent.issueIdentifier)) {
      agent.issueCompleted = true;
      continue;
    }
    // Otherwise, check if the agent completed a DIFFERENT test issue
    // by scanning its branch commits for issue IDs
    try {
      const log = execFileSync('git', ['log', agent.branchName, '--format=%s', '--not', scenario.base_branch],
        { ...EXEC_OPTS, cwd: repoRoot }).trim();
      for (const completedId of completedIssues) {
        if (log.toLowerCase().includes(completedId.toLowerCase())) {
          // Agent worked on a different issue than expected — update the mapping
          agent.issueIdentifier = completedId;
          agent.issueCompleted = true;
          break;
        }
      }
    } catch { /* branch may not exist */ }
  }

  // Check if all test issues got completed (regardless of which agent did them)
  const allIssuesDone = issueIdentifiers.every(id => completedIssues.includes(id));

  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  // Deduplication: check that no two agents ended up with the same issue
  const resolvedIssues = agents.map(a => a.issueIdentifier);
  const issueDeduplication = new Set(resolvedIssues).size === agents.length;

  console.log('   Merging agent branches...');
  execFileSync('git', ['fetch', '--all'], { ...EXEC_OPTS, cwd: repoRoot });

  // Resolve actual branches agents worked on.
  // Agents may have created new branches via pick_issue (e.g. jared/tel-7-...)
  // instead of committing to the harness-created worktree branch.
  for (const agent of agents) {
    try {
      // Check if the harness branch has any commits ahead of base
      const count = execFileSync('git', ['rev-list', '--count', `${scenario.base_branch}..${agent.branchName}`],
        { ...EXEC_OPTS, cwd: repoRoot }).trim();
      if (parseInt(count, 10) > 0) continue; // Agent committed on the harness branch

      // No commits on harness branch — look for a branch containing the issue ID
      const issueId = agent.issueIdentifier.toLowerCase();
      const allBranches = execFileSync('git', ['branch', '--list'], { ...EXEC_OPTS, cwd: repoRoot }).trim()
        .split('\n').map(b => b.trim().replace(/^\* /, ''));
      const match = allBranches.find(b => b.toLowerCase().includes(issueId));
      if (match) {
        agent.branchName = match;
      }
    } catch { /* ignore */ }
  }

  const mergeResults = mergeAgentBranches(repoRoot, testBranch, agents);

  const filesOverlap = detectFileOverlap(repoRoot, agents, scenario.base_branch);

  console.log('   Running tests on merged result...');
  const allMerged = mergeResults.every(m => m.success);
  const testsPass = allMerged ? runTests(repoRoot, scenario.test_command) : false;

  const events = collector.getEvents();
  const agentMetrics = agents.map(agent => ({
    agentId: agent.id,
    commits: events.filter(e => e.agent === agent.id && e.type === 'git_commit').length,
    pushes: events.filter(e => e.agent === agent.id && e.type === 'git_push').length,
    issueIdentifier: agent.issueIdentifier,
    issueCompleted: agent.issueCompleted,
    timedOut: agent.timedOut,
    durationSeconds: agent.startedAt && agent.completedAt
      ? Math.round((new Date(agent.completedAt).getTime() - new Date(agent.startedAt).getTime()) / 1000)
      : 0,
  }));

  const conflictsHit = mergeResults.filter(m => m.conflictFiles.length > 0).length;
  const scorecard: Scorecard = {
    runId: config.runId,
    scenarioName: scenario.name,
    totalAgents: scenario.agents,
    totalDurationSeconds: totalDuration,
    agents: agentMetrics,
    mergeResults,
    testsPass,
    issueDeduplication,
    conflictsHit,
    conflictsAvoided: 0,
    duplicateWork: 0,
    grade: 'A',
    gradeReason: '',
    filesOverlap,
  };

  const { grade, gradeReason } = computeGrade(scorecard);
  scorecard.grade = grade;
  scorecard.gradeReason = gradeReason;

  saveScorecard(scorecard, join(config.resultsDir, 'scorecard.json'));
  writeFileSync(join(config.resultsDir, 'events.json'), collector.toJSON());

  console.log(formatScorecard(scorecard));

  console.log('   Cleaning up...');
  try {
    execFileSync('git', ['checkout', scenario.base_branch], { ...EXEC_OPTS, cwd: repoRoot });
  } catch { /* ignore */ }

  for (const agent of agents) {
    removeWorktree(repoRoot, agent.worktreePath);
  }

  try {
    rmSync(join(repoRoot, '.swarmcode-test', config.runId), { recursive: true, force: true });
  } catch { /* ignore */ }

  // Clean up parent .swarmcode-test dir if empty
  try {
    const testDir = join(repoRoot, '.swarmcode-test');
    if (existsSync(testDir) && readdirSync(testDir).length === 0) {
      rmSync(testDir, { recursive: true, force: true });
    }
  } catch { /* ignore */ }

  // Delete test branches (harness branches + agent-created branches)
  const branchOutput = execFileSync('git', ['branch', '--list'], { ...EXEC_OPTS, cwd: repoRoot }).trim();
  const testBranches = branchOutput.split('\n')
    .map(b => b.trim().replace(/^\* /, ''))
    .filter(b => b.startsWith('swarmcode-test') || b.includes('swarmcode-test'));
  for (const branch of testBranches) {
    try {
      execFileSync('git', ['branch', '-D', branch], { ...EXEC_OPTS, cwd: repoRoot });
    } catch { /* ignore */ }
  }

  // Also delete branches agents created via pick_issue (contain issue identifiers)
  for (const id of issueIdentifiers) {
    const idLower = id.toLowerCase();
    const allBranches = branchOutput.split('\n')
      .map(b => b.trim().replace(/^\* /, ''))
      .filter(b => b.toLowerCase().includes(idLower));
    for (const branch of allBranches) {
      try {
        execFileSync('git', ['branch', '-D', branch], { ...EXEC_OPTS, cwd: repoRoot });
      } catch { /* ignore */ }
    }
  }

  await archiveTestIssues(issueIdentifiers);

  return scorecard;
}

export function listScenarios(): Array<{ name: string; file: string; agents: number; description: string }> {
  const scenariosDir = join(getRepoRoot(), 'test', 'scenarios');
  if (!existsSync(scenariosDir)) return [];

  const files: string[] = readdirSync(scenariosDir).filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files.map((file: string) => {
    const content = readFileSync(join(scenariosDir, file), 'utf-8');
    try {
      const scenario = parseScenario(content);
      return { name: scenario.name, file, agents: scenario.agents, description: scenario.description };
    } catch {
      return { name: file, file, agents: 0, description: 'Invalid scenario' };
    }
  });
}

export async function cleanupOrphans(): Promise<{ worktreesRemoved: number; issuesArchived: number }> {
  const repoRoot = getRepoRoot();
  let worktreesRemoved = 0;
  let issuesArchived = 0;

  const testDir = join(repoRoot, '.swarmcode-test');
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
    worktreesRemoved++;
  }

  try {
    execFileSync('git', ['worktree', 'prune'], { ...EXEC_OPTS, cwd: repoRoot });
  } catch { /* ignore */ }

  try {
    const issues = await linear.searchIssues('[SWARMCODE-TEST]', 50);
    for (const issue of issues) {
      if (issue.title.startsWith('[SWARMCODE-TEST]')) {
        await linear.archiveIssue(issue.identifier);
        issuesArchived++;
      }
    }
  } catch { /* ignore */ }

  return { worktreesRemoved, issuesArchived };
}
