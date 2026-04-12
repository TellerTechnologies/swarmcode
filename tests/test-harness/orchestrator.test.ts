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
