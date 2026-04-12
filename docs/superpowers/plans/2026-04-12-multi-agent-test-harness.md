# Multi-Agent Test Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI command (`swarmcode test`) that orchestrates N concurrent Claude Code agents on the same repo with real Linear tickets, measures coordination quality, and produces a graded scorecard.

**Architecture:** Four modules — orchestrator (lifecycle), agent-launcher (worktree + subprocess), event-collector (git/Linear polling), scorecard (metrics + grading). The harness observes but never intercepts swarmcode's behavior. Agents use the same swarmcode MCP they'd use in production.

**Tech Stack:** TypeScript/Node.js (ESM), Commander (CLI), @linear/sdk, yaml (new dep for scenario parsing), vitest (tests), child_process.spawn (Claude Code subprocesses)

---

## File Structure

```
src/test/
  types.ts              — Shared types for scenario, events, metrics, scorecard
  orchestrator.ts       — Scenario parsing, lifecycle management, top-level run/cleanup
  agent-launcher.ts     — Worktree creation, .mcp.json setup, Claude Code subprocess, completion detection
  event-collector.ts    — Git/Linear polling on intervals, structured event logging
  scorecard.ts          — Merge attempt, test run, metrics crunching, grading, terminal output

test/
  scenarios/
    independent-tasks.yaml   — Baseline: 2 agents, non-overlapping work
    overlapping-files.yaml   — Stress test: 3 agents, shared file areas
  results/                   — Gitignored, created at runtime

tests/
  test-harness/
    types.test.ts            — Scenario parsing validation
    scorecard.test.ts        — Grading logic, metrics crunching
    event-collector.test.ts  — Event polling and logging
    agent-launcher.test.ts   — Worktree setup, process management
    orchestrator.test.ts     — End-to-end lifecycle (mocked subprocesses)
```

---

### Task 1: Add yaml dependency and test types

**Files:**
- Modify: `package.json`
- Create: `src/test/types.ts`
- Test: `tests/test-harness/types.test.ts`

- [ ] **Step 1: Install yaml package**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npm install yaml
```

- [ ] **Step 2: Write the failing test for scenario parsing**

Create `tests/test-harness/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseScenario } from '../../src/test/types.js';

const VALID_YAML = `
name: test-scenario
description: "Two agents on independent tasks"
agents: 2
base_branch: main
test_command: "npm test"
timeout_minutes: 30

issues:
  - title: "Add feature A"
    description: |
      - [ ] Implement feature A
      - [ ] Add tests
    labels: [backend]
  - title: "Add feature B"
    description: |
      - [ ] Implement feature B
      - [ ] Add tests
    labels: [frontend]

overlap_profile: low
expected_conflicts: 0
success_criteria:
  - all_issues_completed: true
  - no_duplicate_implementations: true
`;

describe('parseScenario', () => {
  it('parses valid scenario YAML', () => {
    const scenario = parseScenario(VALID_YAML);
    expect(scenario.name).toBe('test-scenario');
    expect(scenario.agents).toBe(2);
    expect(scenario.issues).toHaveLength(2);
    expect(scenario.issues[0].title).toBe('Add feature A');
    expect(scenario.issues[0].labels).toEqual(['backend']);
    expect(scenario.test_command).toBe('npm test');
    expect(scenario.timeout_minutes).toBe(30);
  });

  it('defaults test_command to npm test', () => {
    const minimal = `
name: minimal
description: "test"
agents: 1
base_branch: main
issues:
  - title: "Do a thing"
    description: "desc"
`;
    const scenario = parseScenario(minimal);
    expect(scenario.test_command).toBe('npm test');
    expect(scenario.timeout_minutes).toBe(30);
  });

  it('throws if agents count does not match issue count', () => {
    const mismatch = `
name: bad
description: "mismatch"
agents: 3
base_branch: main
issues:
  - title: "Only one issue"
    description: "desc"
`;
    expect(() => parseScenario(mismatch)).toThrow('agents count (3) must match issue count (1)');
  });

  it('throws if name is missing', () => {
    const noName = `
description: "no name"
agents: 1
base_branch: main
issues:
  - title: "Task"
    description: "desc"
`;
    expect(() => parseScenario(noName)).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/types.test.ts
```

Expected: FAIL — `Cannot find module '../../src/test/types.js'`

- [ ] **Step 4: Implement types and parseScenario**

Create `src/test/types.ts`:

```typescript
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Scenario (parsed from YAML)
// ---------------------------------------------------------------------------

export interface ScenarioIssue {
  title: string;
  description: string;
  labels?: string[];
}

export interface Scenario {
  name: string;
  description: string;
  agents: number;
  base_branch: string;
  test_command: string;
  timeout_minutes: number;
  issues: ScenarioIssue[];
  overlap_profile?: string;
  expected_conflicts?: string | number;
  success_criteria?: Array<Record<string, boolean>>;
}

export function parseScenario(yamlContent: string): Scenario {
  const raw = parseYaml(yamlContent);
  if (!raw || typeof raw !== 'object') throw new Error('Invalid scenario YAML');
  if (!raw.name) throw new Error('Scenario must have a name');
  if (!raw.issues || !Array.isArray(raw.issues) || raw.issues.length === 0) {
    throw new Error('Scenario must have at least one issue');
  }

  const agents = raw.agents ?? raw.issues.length;
  if (agents !== raw.issues.length) {
    throw new Error(`agents count (${agents}) must match issue count (${raw.issues.length})`);
  }

  return {
    name: raw.name,
    description: raw.description ?? '',
    agents,
    base_branch: raw.base_branch ?? 'main',
    test_command: raw.test_command ?? 'npm test',
    timeout_minutes: raw.timeout_minutes ?? 30,
    issues: raw.issues.map((i: any) => ({
      title: i.title,
      description: i.description ?? '',
      labels: i.labels ?? [],
    })),
    overlap_profile: raw.overlap_profile,
    expected_conflicts: raw.expected_conflicts,
    success_criteria: raw.success_criteria,
  };
}

// ---------------------------------------------------------------------------
// Events (collected during a run)
// ---------------------------------------------------------------------------

export type EventType = 'git_commit' | 'git_push' | 'linear_state_change' | 'agent_started' | 'agent_completed' | 'agent_timeout';

export interface TestEvent {
  timestamp: string;
  agent: string;
  type: EventType;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export interface AgentRun {
  id: string;               // "agent-1", "agent-2", etc.
  worktreePath: string;
  branchName: string;
  issueIdentifier: string;  // "TEL-123"
  pid?: number;
  startedAt?: string;
  completedAt?: string;
  timedOut: boolean;
  issueCompleted: boolean;
}

export interface RunConfig {
  runId: string;
  scenario: Scenario;
  resultsDir: string;
  linearTeamId: string;
  linearTeamKey: string;
}

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------

export interface AgentMetrics {
  agentId: string;
  commits: number;
  pushes: number;
  issueIdentifier: string;
  issueCompleted: boolean;
  timedOut: boolean;
  durationSeconds: number;
}

export interface MergeResult {
  branch: string;
  success: boolean;
  conflictFiles: string[];
}

export interface Scorecard {
  runId: string;
  scenarioName: string;
  totalAgents: number;
  totalDurationSeconds: number;
  agents: AgentMetrics[];
  mergeResults: MergeResult[];
  testsPass: boolean;
  issueDeduplication: boolean;
  conflictsHit: number;
  conflictsAvoided: number;
  duplicateWork: number;
  grade: 'A' | 'B' | 'C' | 'D';
  gradeReason: string;
  filesOverlap: Array<{ file: string; agents: string[] }>;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/types.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add src/test/types.ts tests/test-harness/types.test.ts package.json package-lock.json && git commit -m "feat(test-harness): add scenario types and YAML parser"
```

---

### Task 2: Scorecard grading logic

**Files:**
- Create: `src/test/scorecard.ts`
- Test: `tests/test-harness/scorecard.test.ts`

- [ ] **Step 1: Write failing tests for grading logic**

Create `tests/test-harness/scorecard.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeGrade, formatScorecard } from '../../src/test/scorecard.js';
import type { Scorecard } from '../../src/test/types.js';

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    runId: 'test-run-1',
    scenarioName: 'test-scenario',
    totalAgents: 2,
    totalDurationSeconds: 600,
    agents: [
      { agentId: 'agent-1', commits: 4, pushes: 2, issueIdentifier: 'TEL-1', issueCompleted: true, timedOut: false, durationSeconds: 500 },
      { agentId: 'agent-2', commits: 3, pushes: 2, issueIdentifier: 'TEL-2', issueCompleted: true, timedOut: false, durationSeconds: 600 },
    ],
    mergeResults: [
      { branch: 'feat/tel-1-feature-a', success: true, conflictFiles: [] },
      { branch: 'feat/tel-2-feature-b', success: true, conflictFiles: [] },
    ],
    testsPass: true,
    issueDeduplication: true,
    conflictsHit: 0,
    conflictsAvoided: 0,
    duplicateWork: 0,
    grade: 'A',
    gradeReason: '',
    filesOverlap: [],
    ...overrides,
  };
}

describe('computeGrade', () => {
  it('gives A for perfect run', () => {
    const card = makeScorecard();
    const { grade, gradeReason } = computeGrade(card);
    expect(grade).toBe('A');
    expect(gradeReason).toContain('zero conflicts');
  });

  it('gives B for minor conflicts resolved cleanly', () => {
    const card = makeScorecard({
      conflictsHit: 1,
      mergeResults: [
        { branch: 'feat/tel-1', success: true, conflictFiles: [] },
        { branch: 'feat/tel-2', success: true, conflictFiles: ['src/shared.ts'] },
      ],
    });
    const { grade } = computeGrade(card);
    expect(grade).toBe('B');
  });

  it('gives C for merge failures', () => {
    const card = makeScorecard({
      conflictsHit: 2,
      mergeResults: [
        { branch: 'feat/tel-1', success: false, conflictFiles: ['src/a.ts', 'src/b.ts'] },
        { branch: 'feat/tel-2', success: true, conflictFiles: [] },
      ],
    });
    const { grade } = computeGrade(card);
    expect(grade).toBe('C');
  });

  it('gives D for incomplete issues', () => {
    const card = makeScorecard({
      agents: [
        { agentId: 'agent-1', commits: 4, pushes: 2, issueIdentifier: 'TEL-1', issueCompleted: true, timedOut: false, durationSeconds: 500 },
        { agentId: 'agent-2', commits: 0, pushes: 0, issueIdentifier: 'TEL-2', issueCompleted: false, timedOut: true, durationSeconds: 1800 },
      ],
    });
    const { grade } = computeGrade(card);
    expect(grade).toBe('D');
  });

  it('gives D for duplicate issue claims', () => {
    const card = makeScorecard({ issueDeduplication: false });
    const { grade } = computeGrade(card);
    expect(grade).toBe('D');
  });

  it('gives D when tests fail on merged result', () => {
    const card = makeScorecard({ testsPass: false });
    const { grade } = computeGrade(card);
    expect(grade).toBe('D');
  });
});

describe('formatScorecard', () => {
  it('produces terminal output with scenario name and grade', () => {
    const card = makeScorecard({ grade: 'A', gradeReason: 'Perfect run. Zero conflicts, zero duplication.' });
    const output = formatScorecard(card);
    expect(output).toContain('test-scenario');
    expect(output).toContain('GRADE: A');
    expect(output).toContain('2 agents');
    expect(output).toContain('agent-1');
    expect(output).toContain('agent-2');
    expect(output).toContain('TEL-1');
    expect(output).toContain('TEL-2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/scorecard.test.ts
```

Expected: FAIL — `Cannot find module '../../src/test/scorecard.js'`

- [ ] **Step 3: Implement scorecard module**

Create `src/test/scorecard.ts`:

```typescript
import { writeFileSync } from 'node:fs';
import type { Scorecard } from './types.js';

export function computeGrade(card: Scorecard): { grade: Scorecard['grade']; gradeReason: string } {
  const allCompleted = card.agents.every(a => a.issueCompleted);
  const anyTimedOut = card.agents.some(a => a.timedOut);
  const mergeFailures = card.mergeResults.filter(m => !m.success).length;

  // D: fundamental failures
  if (!card.issueDeduplication) {
    return { grade: 'D', gradeReason: 'Agents claimed the same issue. Issue deduplication failed.' };
  }
  if (!allCompleted || anyTimedOut) {
    return { grade: 'D', gradeReason: `Agents failed to complete work. ${card.agents.filter(a => !a.issueCompleted).length} issue(s) incomplete.` };
  }
  if (!card.testsPass) {
    return { grade: 'D', gradeReason: 'Tests fail on merged result. Agents produced incompatible code.' };
  }
  if (card.duplicateWork > 0) {
    return { grade: 'D', gradeReason: `Duplicate work detected: ${card.duplicateWork} instance(s).` };
  }

  // C: merge problems
  if (mergeFailures > 0) {
    return { grade: 'C', gradeReason: `${mergeFailures} branch(es) failed to merge. Conflicts require manual resolution.` };
  }

  // B: conflicts hit but resolved
  if (card.conflictsHit > 0) {
    return { grade: 'B', gradeReason: `Good coordination. ${card.conflictsHit} conflict(s) on shared files, but all resolved cleanly.` };
  }

  // A: perfect
  return { grade: 'A', gradeReason: 'Perfect run. Zero conflicts, zero duplication, all tests pass.' };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function formatScorecard(card: Scorecard): string {
  const sep = '═'.repeat(50);
  const allIssuesCompleted = card.agents.every(a => a.issueCompleted);
  const allMerged = card.mergeResults.every(m => m.success);
  const conflictFiles = card.mergeResults.flatMap(m => m.conflictFiles);

  const lines: string[] = [
    sep,
    `  SWARMCODE TEST: ${card.scenarioName}`,
    `  ${card.totalAgents} agents · ${card.agents.length} issues · ${formatDuration(card.totalDurationSeconds)} total`,
    sep,
    '',
    '  OUTCOME',
    `  ${allIssuesCompleted ? '✓' : '✗'} All issues completed`,
    `  ${allMerged ? '✓' : '✗'} All branches merged`,
    `  ${card.testsPass ? '✓' : '✗'} Tests pass on merged result`,
  ];

  if (conflictFiles.length > 0) {
    lines.push(`  ✗ ${conflictFiles.length} conflict(s) (${conflictFiles.join(', ')})`);
  }

  lines.push('');
  lines.push('  COORDINATION');
  lines.push(`  Issue deduplication:  ${card.issueDeduplication ? '✓' : '✗'}  (${card.issueDeduplication ? 'all agents picked unique issues' : 'DUPLICATE CLAIMS'})`);
  lines.push(`  Conflicts hit:        ${card.conflictsHit}`);
  lines.push(`  Duplicate work:       ${card.duplicateWork}`);
  lines.push(`  Files touched by 2+:  ${card.filesOverlap.length}`);

  lines.push('');
  lines.push('  PER AGENT');
  lines.push('  ┌──────────┬──────────┬──────────┬────────────┐');
  lines.push('  │ Agent    │ Commits  │ Time     │ Issue      │');
  lines.push('  ├──────────┼──────────┼──────────┼────────────┤');
  for (const a of card.agents) {
    const status = a.timedOut ? '⏱' : a.issueCompleted ? '✓' : '✗';
    lines.push(`  │ ${a.agentId.padEnd(8)} │ ${String(a.commits).padEnd(8)} │ ${formatDuration(a.durationSeconds).padEnd(8)} │ ${a.issueIdentifier} ${status} │`);
  }
  lines.push('  └──────────┴──────────┴──────────┴────────────┘');

  lines.push('');
  lines.push(`  GRADE: ${card.grade}`);
  lines.push(`  ${card.gradeReason}`);
  lines.push(sep);

  return lines.join('\n');
}

export function saveScorecard(card: Scorecard, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(card, null, 2) + '\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/scorecard.test.ts
```

Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add src/test/scorecard.ts tests/test-harness/scorecard.test.ts && git commit -m "feat(test-harness): add scorecard grading logic and terminal formatting"
```

---

### Task 3: Event collector

**Files:**
- Create: `src/test/event-collector.ts`
- Test: `tests/test-harness/event-collector.test.ts`

- [ ] **Step 1: Write failing tests for event collector**

Create `tests/test-harness/event-collector.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventCollector } from '../../src/test/event-collector.js';
import type { AgentRun } from '../../src/test/types.js';

describe('EventCollector', () => {
  let collector: EventCollector;

  const agents: AgentRun[] = [
    {
      id: 'agent-1',
      worktreePath: '/tmp/test-wt-1',
      branchName: 'feat/tel-1-feature-a',
      issueIdentifier: 'TEL-1',
      timedOut: false,
      issueCompleted: false,
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    collector = new EventCollector(agents, ['TEL-1']);
  });

  afterEach(() => {
    collector.stop();
    vi.useRealTimers();
  });

  it('records manually pushed events', () => {
    collector.record({
      timestamp: new Date().toISOString(),
      agent: 'agent-1',
      type: 'agent_started',
      data: {},
    });
    expect(collector.getEvents()).toHaveLength(1);
    expect(collector.getEvents()[0].type).toBe('agent_started');
  });

  it('returns empty events before start', () => {
    expect(collector.getEvents()).toEqual([]);
  });

  it('exports events as JSON string', () => {
    collector.record({
      timestamp: '2026-04-12T00:00:00Z',
      agent: 'agent-1',
      type: 'git_commit',
      data: { hash: 'abc123' },
    });
    const json = collector.toJSON();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].data.hash).toBe('abc123');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/event-collector.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement event collector**

Create `src/test/event-collector.ts`:

```typescript
import { execFileSync } from 'node:child_process';
import type { TestEvent, AgentRun } from './types.js';

const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };

export class EventCollector {
  private events: TestEvent[] = [];
  private gitPollId: ReturnType<typeof setInterval> | null = null;
  private lastCommitShas: Map<string, string> = new Map();
  private agents: AgentRun[];
  private issueIdentifiers: string[];

  constructor(agents: AgentRun[], issueIdentifiers: string[]) {
    this.agents = agents;
    this.issueIdentifiers = issueIdentifiers;
  }

  /** Start polling git for new commits across worktrees. */
  startGitPolling(intervalMs: number = 10_000): void {
    // Snapshot initial HEADs
    for (const agent of this.agents) {
      const sha = this.getHeadSha(agent.worktreePath);
      if (sha) this.lastCommitShas.set(agent.id, sha);
    }

    this.gitPollId = setInterval(() => this.pollGit(), intervalMs);
  }

  private pollGit(): void {
    for (const agent of this.agents) {
      try {
        const currentSha = this.getHeadSha(agent.worktreePath);
        if (!currentSha) continue;

        const lastSha = this.lastCommitShas.get(agent.id);
        if (currentSha === lastSha) continue;

        // New commit(s) detected
        const newCommits = this.getCommitsSince(agent.worktreePath, lastSha ?? '');
        for (const commit of newCommits) {
          this.record({
            timestamp: new Date().toISOString(),
            agent: agent.id,
            type: 'git_commit',
            data: { hash: commit.hash, message: commit.message },
          });
        }

        this.lastCommitShas.set(agent.id, currentSha);
      } catch {
        // Worktree may not exist yet or may be cleaned up
      }
    }
  }

  private getHeadSha(cwd: string): string | null {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { ...EXEC_OPTS, cwd }).trim();
    } catch {
      return null;
    }
  }

  private getCommitsSince(cwd: string, sinceSha: string): Array<{ hash: string; message: string }> {
    try {
      const range = sinceSha ? `${sinceSha}..HEAD` : 'HEAD~5..HEAD';
      const output = execFileSync('git', ['log', range, '--format=%H|%s'], { ...EXEC_OPTS, cwd }).trim();
      if (!output) return [];
      return output.split('\n').map(line => {
        const [hash, ...rest] = line.split('|');
        return { hash, message: rest.join('|') };
      });
    } catch {
      return [];
    }
  }

  /** Record an event. */
  record(event: TestEvent): void {
    this.events.push(event);
  }

  /** Stop all polling. */
  stop(): void {
    if (this.gitPollId) {
      clearInterval(this.gitPollId);
      this.gitPollId = null;
    }
  }

  /** Get all collected events. */
  getEvents(): TestEvent[] {
    return [...this.events];
  }

  /** Serialize events to JSON. */
  toJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/event-collector.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add src/test/event-collector.ts tests/test-harness/event-collector.test.ts && git commit -m "feat(test-harness): add event collector with git polling"
```

---

### Task 4: Agent launcher

**Files:**
- Create: `src/test/agent-launcher.ts`
- Test: `tests/test-harness/agent-launcher.test.ts`

- [ ] **Step 1: Write failing tests for agent launcher**

Create `tests/test-harness/agent-launcher.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildAgentPrompt, buildMcpConfig, createWorktree, removeWorktree } from '../../src/test/agent-launcher.js';

describe('buildAgentPrompt', () => {
  it('includes start_session and pick_issue instructions', () => {
    const prompt = buildAgentPrompt();
    expect(prompt).toContain('start_session');
    expect(prompt).toContain('pick_issue');
    expect(prompt).toContain('complete_issue');
    expect(prompt).toContain('commit');
  });

  it('does not include a specific issue ID', () => {
    const prompt = buildAgentPrompt();
    expect(prompt).not.toMatch(/TEL-\d+/);
  });
});

describe('buildMcpConfig', () => {
  it('returns valid MCP JSON with swarmcode server', () => {
    const config = buildMcpConfig();
    const parsed = JSON.parse(config);
    expect(parsed.mcpServers.swarmcode).toBeDefined();
    expect(parsed.mcpServers.swarmcode.command).toBeDefined();
    expect(parsed.mcpServers.swarmcode.args).toContain('swarmcode');
  });
});

describe('createWorktree', () => {
  it('is a function', () => {
    expect(typeof createWorktree).toBe('function');
  });
});

describe('removeWorktree', () => {
  it('is a function', () => {
    expect(typeof removeWorktree).toBe('function');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/agent-launcher.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement agent launcher**

Create `src/test/agent-launcher.ts`:

```typescript
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
    'Implement the work described in the issue. Commit and push frequently.',
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

  const child = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/agent-launcher.test.ts
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add src/test/agent-launcher.ts tests/test-harness/agent-launcher.test.ts && git commit -m "feat(test-harness): add agent launcher with worktree and subprocess management"
```

---

### Task 5: Orchestrator

**Files:**
- Create: `src/test/orchestrator.ts`
- Test: `tests/test-harness/orchestrator.test.ts`

- [ ] **Step 1: Write failing tests for orchestrator**

Create `tests/test-harness/orchestrator.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { generateRunId, buildRunConfig } from '../../src/test/orchestrator.js';
import type { Scenario } from '../../src/test/types.js';

describe('generateRunId', () => {
  it('returns a string with scenario name and timestamp', () => {
    const id = generateRunId('overlapping-files');
    expect(id).toMatch(/^overlapping-files-\d{8}-\d{6}$/);
  });
});

describe('buildRunConfig', () => {
  const scenario: Scenario = {
    name: 'test',
    description: 'test scenario',
    agents: 2,
    base_branch: 'main',
    test_command: 'npm test',
    timeout_minutes: 30,
    issues: [
      { title: 'Issue 1', description: 'desc', labels: [] },
      { title: 'Issue 2', description: 'desc', labels: [] },
    ],
  };

  it('builds config with run ID and results dir', () => {
    const config = buildRunConfig(scenario, 'team-id-123', 'TEL');
    expect(config.runId).toMatch(/^test-/);
    expect(config.resultsDir).toContain('test/results/');
    expect(config.scenario).toBe(scenario);
    expect(config.linearTeamId).toBe('team-id-123');
    expect(config.linearTeamKey).toBe('TEL');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/orchestrator.test.ts
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement orchestrator**

Create `src/test/orchestrator.ts`:

```typescript
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Scenario, RunConfig, AgentRun, Scorecard, MergeResult } from './types.js';
import { parseScenario } from './types.js';
import { EventCollector } from './event-collector.js';
import { launchAgent, createWorktree, removeWorktree, buildMcpConfig } from './agent-launcher.js';
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

/** Create Linear issues from scenario definition. Returns issue identifiers. */
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
    // Add swarmcode-test label if available
    try {
      const labels = await linear.getLabels();
      const testLabel = labels.find(l => l.name === 'swarmcode-test');
      if (testLabel) {
        await linear.addIssueLabel(result.issue.identifier, testLabel.id);
      }
    } catch {
      // Label not found — fine, proceed without it
    }
    identifiers.push(result.issue.identifier);
  }
  return identifiers;
}

/** Archive all test issues after a run. */
async function archiveTestIssues(identifiers: string[]): Promise<void> {
  for (const id of identifiers) {
    try {
      await linear.archiveIssue(id);
    } catch {
      // Best effort
    }
  }
}

/** Attempt to merge all agent branches into test branch, in chronological order. */
function mergeAgentBranches(repoRoot: string, testBranch: string, agents: AgentRun[]): MergeResult[] {
  const results: MergeResult[] = [];

  // Sort by last commit time (chronological)
  const sorted = [...agents].sort((a, b) => {
    try {
      const timeA = parseInt(execFileSync('git', ['log', '-1', '--format=%ct', a.branchName], { ...EXEC_OPTS, cwd: repoRoot }).trim(), 10);
      const timeB = parseInt(execFileSync('git', ['log', '-1', '--format=%ct', b.branchName], { ...EXEC_OPTS, cwd: repoRoot }).trim(), 10);
      return timeA - timeB;
    } catch {
      return 0;
    }
  });

  // Checkout test branch
  execFileSync('git', ['checkout', testBranch], { ...EXEC_OPTS, cwd: repoRoot });

  for (const agent of sorted) {
    try {
      execFileSync('git', ['merge', agent.branchName, '--no-edit'], { ...EXEC_OPTS, cwd: repoRoot });
      results.push({ branch: agent.branchName, success: true, conflictFiles: [] });
    } catch (err: any) {
      // Merge conflict — record which files
      const conflictFiles: string[] = [];
      try {
        const status = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], { ...EXEC_OPTS, cwd: repoRoot }).trim();
        if (status) conflictFiles.push(...status.split('\n'));
      } catch { /* ignore */ }

      // Abort the failed merge
      try {
        execFileSync('git', ['merge', '--abort'], { ...EXEC_OPTS, cwd: repoRoot });
      } catch { /* ignore */ }

      results.push({ branch: agent.branchName, success: false, conflictFiles });
    }
  }

  return results;
}

/** Detect files touched by multiple agents. */
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
    } catch {
      // Branch may not have commits yet
    }
  }

  return Array.from(fileAgentMap.entries())
    .filter(([, agents]) => agents.length > 1)
    .map(([file, agents]) => ({ file, agents }));
}

/** Run the test command on the merged result. */
function runTests(repoRoot: string, testCommand: string): boolean {
  try {
    const [cmd, ...args] = testCommand.split(' ');
    execFileSync(cmd, args, { ...EXEC_OPTS, cwd: repoRoot, timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

/** Wait for an agent's process to exit or its issue to be completed. */
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

    // Timeout
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

/** Poll Linear to check if all test issues are completed. */
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runScenario(scenarioPath: string): Promise<Scorecard> {
  const yamlContent = readFileSync(scenarioPath, 'utf-8');
  const scenario = parseScenario(yamlContent);

  console.log(`\n🔬 Running scenario: ${scenario.name}`);
  console.log(`   ${scenario.agents} agents · ${scenario.issues.length} issues\n`);

  // Resolve Linear team
  const teams = await linear.getTeams();
  const teamKey = process.env.SWARMCODE_LINEAR_TEAM ?? 'TEL';
  const team = teams.find(t => t.key === teamKey);
  if (!team) throw new Error(`Linear team '${teamKey}' not found`);

  const config = buildRunConfig(scenario, team.id, team.key);
  mkdirSync(config.resultsDir, { recursive: true });

  const repoRoot = getRepoRoot();
  const testBranch = `swarmcode-test/${config.runId}`;
  const startTime = Date.now();

  // Create test branch
  execFileSync('git', ['checkout', '-b', testBranch], { ...EXEC_OPTS, cwd: repoRoot });
  execFileSync('git', ['checkout', '-'], { ...EXEC_OPTS, cwd: repoRoot });

  // Create Linear issues
  console.log('   Creating Linear issues...');
  const issueIdentifiers = await createTestIssues(scenario, team.id);
  console.log(`   Created: ${issueIdentifiers.join(', ')}`);

  // Prepare agents
  const agents: AgentRun[] = scenario.issues.map((_, i) => ({
    id: `agent-${i + 1}`,
    worktreePath: join(repoRoot, '.swarmcode-test', config.runId, `agent-${i + 1}`),
    branchName: `swarmcode-test-agent-${i + 1}-${config.runId}`,
    issueIdentifier: issueIdentifiers[i],
    timedOut: false,
    issueCompleted: false,
  }));

  // Start event collector
  const collector = new EventCollector(agents, issueIdentifiers);

  // Create worktrees and launch agents with stagger
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

    // Stagger next agent launch
    if (agents.indexOf(agent) < agents.length - 1) {
      await sleep(AGENT_STAGGER_MS);
    }
  }

  // Start git polling
  collector.startGitPolling(10_000);

  // Poll Linear for completion every 15s
  const linearPollId = setInterval(async () => {
    const status = await pollLinearCompletion(issueIdentifiers, collector);
    for (const agent of agents) {
      if (status.get(agent.issueIdentifier)) {
        agent.issueCompleted = true;
      }
    }
  }, 15_000);

  // Wait for all agents
  const timeoutMs = scenario.timeout_minutes * 60 * 1000;
  console.log(`   Waiting for agents (timeout: ${scenario.timeout_minutes}m)...\n`);
  await Promise.all(agents.map((agent, i) => waitForAgent(agent, children[i], timeoutMs)));

  // Stop polling
  clearInterval(linearPollId);
  collector.stop();

  // Final Linear status check
  const finalStatus = await pollLinearCompletion(issueIdentifiers, collector);
  for (const agent of agents) {
    agent.issueCompleted = finalStatus.get(agent.issueIdentifier) ?? false;
  }

  const totalDuration = Math.round((Date.now() - startTime) / 1000);

  // Check for duplicate issue claims
  const issueDeduplication = new Set(agents.map(a => a.issueIdentifier)).size === agents.length;

  // Fetch remote branches and merge
  console.log('   Merging agent branches...');
  execFileSync('git', ['fetch', '--all'], { ...EXEC_OPTS, cwd: repoRoot });
  const mergeResults = mergeAgentBranches(repoRoot, testBranch, agents);

  // Detect file overlap
  const filesOverlap = detectFileOverlap(repoRoot, agents, scenario.base_branch);

  // Run tests on merged result
  console.log('   Running tests on merged result...');
  const allMerged = mergeResults.every(m => m.success);
  const testsPass = allMerged ? runTests(repoRoot, scenario.test_command) : false;

  // Count git events per agent
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

  // Build scorecard
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
    conflictsAvoided: 0, // Cannot measure without MCP interception (v2)
    duplicateWork: 0,     // TODO: detect via file diff similarity
    grade: 'A',
    gradeReason: '',
    filesOverlap,
  };

  const { grade, gradeReason } = computeGrade(scorecard);
  scorecard.grade = grade;
  scorecard.gradeReason = gradeReason;

  // Save results
  saveScorecard(scorecard, join(config.resultsDir, 'scorecard.json'));
  writeFileSync(join(config.resultsDir, 'events.json'), collector.toJSON());

  // Print scorecard
  console.log(formatScorecard(scorecard));

  // Cleanup
  console.log('   Cleaning up...');
  // Go back to original branch
  try {
    execFileSync('git', ['checkout', scenario.base_branch], { ...EXEC_OPTS, cwd: repoRoot });
  } catch { /* ignore */ }

  // Remove worktrees
  for (const agent of agents) {
    removeWorktree(repoRoot, agent.worktreePath);
  }

  // Remove worktree temp dir
  try {
    rmSync(join(repoRoot, '.swarmcode-test', config.runId), { recursive: true, force: true });
  } catch { /* ignore */ }

  // Archive Linear issues
  await archiveTestIssues(issueIdentifiers);

  return scorecard;
}

/** List available scenarios from test/scenarios/. */
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

/** Clean up orphaned worktrees and archived test issues. */
export async function cleanupOrphans(): Promise<{ worktreesRemoved: number; issuesArchived: number }> {
  const repoRoot = getRepoRoot();
  let worktreesRemoved = 0;
  let issuesArchived = 0;

  // Remove .swarmcode-test directory
  const testDir = join(repoRoot, '.swarmcode-test');
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
    worktreesRemoved++;
  }

  // Prune worktrees
  try {
    execFileSync('git', ['worktree', 'prune'], { ...EXEC_OPTS, cwd: repoRoot });
  } catch { /* ignore */ }

  // Archive any remaining swarmcode-test labeled issues
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/orchestrator.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add src/test/orchestrator.ts tests/test-harness/orchestrator.test.ts && git commit -m "feat(test-harness): add orchestrator with full lifecycle management"
```

---

### Task 6: CLI commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing test for the test command registration**

Create `tests/test-harness/cli-test.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createCLI } from '../../src/cli.js';

describe('swarmcode test commands', () => {
  it('registers test command with run subcommand', () => {
    const program = createCLI();
    const testCmd = program.commands.find(c => c.name() === 'test');
    expect(testCmd).toBeDefined();
  });

  it('test command has run, list, report, and cleanup subcommands', () => {
    const program = createCLI();
    const testCmd = program.commands.find(c => c.name() === 'test');
    const subcommands = testCmd?.commands.map(c => c.name()) ?? [];
    expect(subcommands).toContain('run');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('cleanup');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/cli-test.test.ts
```

Expected: FAIL — no `test` command found

- [ ] **Step 3: Add test command to CLI**

In `src/cli.ts`, add the test subcommand after the dashboard command (before `return program;`):

```typescript
  // ---------------------------------------------------------------------------
  // Test harness
  // ---------------------------------------------------------------------------

  const testCmd = program
    .command('test')
    .description('Multi-agent test harness for coordination testing');

  testCmd
    .command('run')
    .description('Run a test scenario with concurrent agents')
    .requiredOption('--scenario <path>', 'Path to scenario YAML file')
    .option('--agents <count>', 'Override agent count from scenario')
    .action(async (options) => {
      const { runScenario } = await import('./test/orchestrator.js');
      const { resolve } = await import('node:path');
      const scenarioPath = resolve(options.scenario);
      try {
        await runScenario(scenarioPath);
      } catch (e: any) {
        console.error(`Test run failed: ${e.message}`);
        process.exitCode = 1;
      }
    });

  testCmd
    .command('list')
    .description('List available test scenarios')
    .action(async () => {
      const { listScenarios } = await import('./test/orchestrator.js');
      const scenarios = listScenarios();
      if (scenarios.length === 0) {
        console.log('No scenarios found in test/scenarios/');
        return;
      }
      console.log('Available scenarios:\n');
      for (const s of scenarios) {
        console.log(`  ${s.name.padEnd(30)} ${s.agents} agents  ${s.description}`);
      }
    });

  testCmd
    .command('cleanup')
    .description('Remove orphaned worktrees and archive stale test issues')
    .action(async () => {
      const { cleanupOrphans } = await import('./test/orchestrator.js');
      const result = await cleanupOrphans();
      console.log(`Cleaned up: ${result.worktreesRemoved} worktree(s), ${result.issuesArchived} issue(s)`);
    });

  testCmd
    .command('report')
    .description('Reprint a past scorecard')
    .argument('<run-id>', 'Run ID to display')
    .action(async (runId: string) => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { formatScorecard } = await import('./test/scorecard.js');
      try {
        const cardPath = join('test', 'results', runId, 'scorecard.json');
        const card = JSON.parse(readFileSync(cardPath, 'utf-8'));
        console.log(formatScorecard(card));
      } catch {
        console.error(`No scorecard found for run: ${runId}`);
        process.exitCode = 1;
      }
    });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/cli-test.test.ts
```

Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add src/cli.ts tests/test-harness/cli-test.test.ts && git commit -m "feat(test-harness): add swarmcode test CLI commands (run, list, cleanup, report)"
```

---

### Task 7: Scenario files and gitignore

**Files:**
- Create: `test/scenarios/independent-tasks.yaml`
- Create: `test/scenarios/overlapping-files.yaml`
- Modify: `.gitignore`

- [ ] **Step 1: Create independent-tasks scenario**

Create `test/scenarios/independent-tasks.yaml`:

```yaml
name: independent-tasks
description: "Baseline: 2 agents working on non-overlapping areas"
agents: 2
base_branch: master
test_command: "npm test"
timeout_minutes: 30

issues:
  - title: "Add JSDoc comments to branch-parser.ts"
    description: |
      Add JSDoc documentation to all exported functions in src/branch-parser.ts.
      
      - [ ] Add JSDoc to extractIssueId
      - [ ] Add JSDoc to messageHasIssueId
      - [ ] Add JSDoc to prependIssueId
    labels: [docs]

  - title: "Add JSDoc comments to source-parser.ts exports"
    description: |
      Add JSDoc documentation to the main exported functions in src/source-parser.ts.
      
      - [ ] Add JSDoc to searchExports
      - [ ] Add JSDoc to LANGUAGE_PATTERNS type
    labels: [docs]

overlap_profile: low
expected_conflicts: 0
success_criteria:
  - all_issues_completed: true
  - no_duplicate_implementations: true
```

- [ ] **Step 2: Create overlapping-files scenario**

Create `test/scenarios/overlapping-files.yaml`:

```yaml
name: overlapping-files
description: "Stress test: 3 agents modifying shared modules"
agents: 3
base_branch: master
test_command: "npm test"
timeout_minutes: 30

issues:
  - title: "Add getMainBranch helper to git.ts"
    description: |
      The getMainBranch function in git.ts should be exported and documented.
      Also add a unit test for it.
      
      - [ ] Ensure getMainBranch is exported
      - [ ] Add JSDoc comment
      - [ ] Add unit test in tests/git.test.ts
    labels: [backend]

  - title: "Add ensureFresh documentation and test"
    description: |
      The ensureFresh function in git.ts needs JSDoc and a unit test.
      
      - [ ] Add JSDoc to ensureFresh
      - [ ] Add unit test for the staleness throttle behavior
    labels: [backend]

  - title: "Add run helper documentation in git.ts"
    description: |
      Document the internal run and runOrNull helpers in git.ts with inline comments.
      Also add a test for getRepoRoot.
      
      - [ ] Add inline comments to run and runOrNull
      - [ ] Add unit test for getRepoRoot in tests/git.test.ts
    labels: [backend]

overlap_profile: high
expected_conflicts: 1-3
success_criteria:
  - all_issues_completed: true
  - merge_conflicts_resolved: true
  - all_tests_pass: true
```

- [ ] **Step 3: Update .gitignore**

Add to `.gitignore`:

```
test/results/
.swarmcode-test/
```

- [ ] **Step 4: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add test/scenarios/ .gitignore && git commit -m "feat(test-harness): add scenario files and gitignore test artifacts"
```

---

### Task 8: Integration smoke test

**Files:**
- Create: `tests/test-harness/integration.test.ts`

- [ ] **Step 1: Write integration test that validates the full pipeline sans Claude Code**

Create `tests/test-harness/integration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseScenario } from '../../src/test/types.js';
import { generateRunId, buildRunConfig } from '../../src/test/orchestrator.js';
import { buildAgentPrompt, buildMcpConfig } from '../../src/test/agent-launcher.js';
import { EventCollector } from '../../src/test/event-collector.js';
import { computeGrade, formatScorecard } from '../../src/test/scorecard.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('test harness integration', () => {
  it('scenario → config → scorecard pipeline works end-to-end', () => {
    const scenarioPath = join(process.cwd(), 'test', 'scenarios', 'independent-tasks.yaml');
    const yaml = readFileSync(scenarioPath, 'utf-8');
    const scenario = parseScenario(yaml);

    expect(scenario.name).toBe('independent-tasks');
    expect(scenario.agents).toBe(2);

    const config = buildRunConfig(scenario, 'team-id', 'TEL');
    expect(config.runId).toContain('independent-tasks');

    const prompt = buildAgentPrompt();
    expect(prompt).toContain('pick_issue');

    const mcpConfig = JSON.parse(buildMcpConfig());
    expect(mcpConfig.mcpServers.swarmcode).toBeDefined();

    const collector = new EventCollector([], []);
    collector.record({
      timestamp: new Date().toISOString(),
      agent: 'agent-1',
      type: 'git_commit',
      data: { hash: 'abc' },
    });
    expect(collector.getEvents()).toHaveLength(1);

    // Build a mock scorecard and verify grading
    const card = {
      runId: config.runId,
      scenarioName: scenario.name,
      totalAgents: 2,
      totalDurationSeconds: 300,
      agents: [
        { agentId: 'agent-1', commits: 3, pushes: 1, issueIdentifier: 'TEL-1', issueCompleted: true, timedOut: false, durationSeconds: 250 },
        { agentId: 'agent-2', commits: 2, pushes: 1, issueIdentifier: 'TEL-2', issueCompleted: true, timedOut: false, durationSeconds: 300 },
      ],
      mergeResults: [
        { branch: 'feat/tel-1', success: true, conflictFiles: [] },
        { branch: 'feat/tel-2', success: true, conflictFiles: [] },
      ],
      testsPass: true,
      issueDeduplication: true,
      conflictsHit: 0,
      conflictsAvoided: 0,
      duplicateWork: 0,
      grade: 'A' as const,
      gradeReason: '',
      filesOverlap: [],
    };

    const { grade, gradeReason } = computeGrade(card);
    expect(grade).toBe('A');

    card.grade = grade;
    card.gradeReason = gradeReason;

    const output = formatScorecard(card);
    expect(output).toContain('GRADE: A');
    expect(output).toContain('independent-tasks');
  });
});
```

- [ ] **Step 2: Run integration test**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run tests/test-harness/integration.test.ts
```

Expected: 1 test PASS

- [ ] **Step 3: Run full test suite to check for regressions**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && npx vitest run
```

Expected: all existing tests still pass, all new tests pass

- [ ] **Step 4: Commit**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && git add tests/test-harness/integration.test.ts && git commit -m "feat(test-harness): add integration smoke test for full pipeline"
```

---

### Task 9: First live test run

This is the manual validation step. No code to write — run the harness for real.

- [ ] **Step 1: Verify environment**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && source .env && echo "Linear key: ${SWARMCODE_LINEAR_API_KEY:0:10}..." && echo "Team: $SWARMCODE_LINEAR_TEAM" && which claude
```

Expected: key present, team is TEL, `claude` CLI is on PATH

- [ ] **Step 2: Run independent-tasks scenario with 2 agents**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && swarmcode test run --scenario test/scenarios/independent-tasks.yaml
```

Expected: 2 agents launch, work on separate files, both complete, scorecard prints with grade A

- [ ] **Step 3: Review the scorecard and agent logs**

```bash
ls test/results/  # Find the run ID
cat test/results/<run-id>/scorecard.json
cat test/results/<run-id>/agent-1.log | tail -50
cat test/results/<run-id>/agent-2.log | tail -50
```

- [ ] **Step 4: Clean up test artifacts**

```bash
cd /home/tellertech/projects/tellertech/swarmcode && swarmcode test cleanup
```

- [ ] **Step 5: If successful, commit any fixes discovered during the live run**
