import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Scenario (parsed from YAML)
// ---------------------------------------------------------------------------

export interface ScenarioIssue {
  title: string;
  description: string;
  labels?: string[];
  agent?: string;  // Claude Code agent name (e.g. "typescript-pro")
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
      agent: i.agent,
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
  id: string;
  worktreePath: string;
  branchName: string;
  issueIdentifier: string;
  agentType?: string;  // Claude Code agent name (e.g. "typescript-pro")
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
  agentType?: string;
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
  autoResolved: boolean;
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
  conflictsAutoResolved: number;
  conflictsUnresolved: number;
  conflictsAvoided: number;
  duplicateWork: number;
  grade: 'A' | 'B' | 'C' | 'D';
  gradeReason: string;
  filesOverlap: Array<{ file: string; agents: string[] }>;
}
