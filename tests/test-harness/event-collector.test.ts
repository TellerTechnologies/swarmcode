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
