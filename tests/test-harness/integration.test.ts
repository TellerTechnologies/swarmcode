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
        { branch: 'feat/tel-1', success: true, conflictFiles: [] as string[] },
        { branch: 'feat/tel-2', success: true, conflictFiles: [] as string[] },
      ],
      testsPass: true,
      issueDeduplication: true,
      conflictsHit: 0,
      conflictsAvoided: 0,
      duplicateWork: 0,
      grade: 'A' as const,
      gradeReason: '',
      filesOverlap: [] as Array<{ file: string; agents: string[] }>,
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
