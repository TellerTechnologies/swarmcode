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
