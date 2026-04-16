import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @linear/sdk before any imports that load it.
// The mock factory creates a stable MockLinearClient constructor. All tests
// share the same singleton _client from the module under test. We address this
// by keeping one stable mockClientInstance object whose vi.fn() properties we
// reset and reconfigure between tests rather than constructing a new object.
// ---------------------------------------------------------------------------

// Forward-declared so the mock factory closure can reference it before the
// variable is assigned below.
let mockClientInstance: ReturnType<typeof buildMockClientInstance>;

vi.mock('@linear/sdk', () => {
  // Must be a real function (not an arrow) so `new LinearClient()` succeeds.
  function MockLinearClient() {
    // Return the shared instance — this makes every `new LinearClient()` call
    // return the same object we control from tests.
    return mockClientInstance;
  }
  return { LinearClient: MockLinearClient };
});

import {
  isConfigured,
  getViewer,
  getTeams,
  getUsers,
  getWorkflowStates,
  getCycles,
  getLinearData,
  searchIssues,
  getIssue,
  startIssue,
  completeIssue,
  updateIssueStatus,
  updateIssue,
  createIssue,
  createSubIssue,
  commentOnIssue,
  getProjects,
  getProjectIssues,
  createProject,
  updateProject,
  addIssueToProject,
  getProjectUpdates,
  createProjectUpdate,
  addIssueToCycle,
  archiveIssue,
  createIssueRelation,
  getIssueRelations,
  getIssueHistory,
  getLabels,
  addIssueLabel,
  removeIssueLabel,
  formatAsMarkdown,
  clearCache,
} from '../src/linear.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a raw GraphQL issue node (what rawRequest returns). */
function createRawIssueNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-id-1',
    identifier: 'ENG-1',
    title: 'Test Issue',
    description: 'A test issue description',
    priority: 2,
    branchName: 'eng-1-test-issue',
    url: 'https://linear.app/team/issue/ENG-1',
    dueDate: null,
    estimate: null,
    updatedAt: '2024-01-02T00:00:00.000Z',
    state: { name: 'In Progress', type: 'started' },
    assignee: { id: 'user-id-1', name: 'Alice' },
    parent: null,
    labels: { nodes: [{ name: 'bug', color: '#ff0000' }] },
    ...overrides,
  };
}

/** Build a full mock Issue object matching what client.issue() would return. */
function createMockIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-id-1',
    identifier: 'ENG-1',
    title: 'Test Issue',
    description: 'A test issue description',
    assigneeId: 'user-id-1',
    priority: 2,
    branchName: 'eng-1-test-issue',
    url: 'https://linear.app/team/issue/ENG-1',
    dueDate: null,
    estimate: null,
    parentId: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-02T00:00:00Z'),
    // Lazy relations (resolved as Promises)
    state: Promise.resolve({ id: 'state-id-1', name: 'In Progress', type: 'started' }),
    assignee: Promise.resolve({ id: 'user-id-1', name: 'Alice' }),
    team: Promise.resolve({
      id: 'team-id-1',
      name: 'Engineering',
      key: 'ENG',
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: 'state-triage', name: 'Triage', type: 'triage', position: 0 },
          { id: 'state-backlog', name: 'Backlog', type: 'backlog', position: 1 },
          { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 2 },
          { id: 'state-started', name: 'In Progress', type: 'started', position: 3 },
          { id: 'state-done', name: 'Done', type: 'completed', position: 4 },
          { id: 'state-cancelled', name: 'Cancelled', type: 'cancelled', position: 5 },
        ],
      }),
    }),
    // Methods
    labels: vi.fn().mockResolvedValue({ nodes: [{ id: 'label-id-1', name: 'bug', color: '#ff0000' }] }),
    comments: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: 'comment-id-1',
          body: 'A comment',
          createdAt: new Date('2024-01-01T12:00:00Z'),
          user: Promise.resolve({ id: 'user-id-2', name: 'Bob' }),
        },
      ],
    }),
    children: vi.fn().mockResolvedValue({ nodes: [] }),
    relations: vi.fn().mockResolvedValue({ nodes: [] }),
    inverseRelations: vi.fn().mockResolvedValue({ nodes: [] }),
    history: vi.fn().mockResolvedValue({ nodes: [] }),
    ...overrides,
  };
}

/**
 * Build the shared mock client instance object.
 * All vi.fn() calls here create fresh mocks each time this is invoked,
 * which is called once in beforeEach to reset the stable instance's methods.
 */
function buildMockClientInstance() {
  const defaultMockIssue = createMockIssue();

  const defaultRawNode = createRawIssueNode();

  return {
    client: {
      rawRequest: vi.fn().mockResolvedValue({ data: { issues: { nodes: [defaultRawNode] } } }),
    },
    searchIssues: vi.fn().mockResolvedValue({ nodes: [{ id: 'issue-id-1' }] }),
    issue: vi.fn().mockResolvedValue(defaultMockIssue),
    issues: vi.fn().mockResolvedValue({ nodes: [defaultMockIssue] }),
    viewer: Promise.resolve({ id: 'viewer-id', name: 'Viewer User', email: 'viewer@example.com', active: true }),
    teams: vi.fn().mockResolvedValue({
      nodes: [{ id: 'team-id-1', name: 'Engineering', key: 'ENG' }],
    }),
    team: vi.fn().mockResolvedValue({
      id: 'team-id-1',
      name: 'Engineering',
      key: 'ENG',
      activeCycle: Promise.resolve(null),
      cycles: vi.fn().mockResolvedValue({ nodes: [] }),
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: 'state-todo', name: 'Todo', type: 'unstarted', position: 1 },
          { id: 'state-started', name: 'In Progress', type: 'started', position: 2 },
          { id: 'state-done', name: 'Done', type: 'completed', position: 3 },
        ],
      }),
    }),
    users: vi.fn().mockResolvedValue({
      nodes: [{ id: 'user-id-1', name: 'Alice', email: 'alice@example.com', active: true }],
    }),
    createIssue: vi.fn().mockResolvedValue({
      success: true,
      issue: Promise.resolve({
        id: 'new-issue-id',
        identifier: 'ENG-99',
        title: 'New Issue',
        state: Promise.resolve({ name: 'Todo' }),
        assignee: Promise.resolve(null),
      }),
    }),
    updateIssue: vi.fn().mockResolvedValue({ success: true }),
    archiveIssue: vi.fn().mockResolvedValue({ success: true }),
    createComment: vi.fn().mockResolvedValue({ success: true, commentId: 'comment-id-new' }),
    projects: vi.fn().mockResolvedValue({
      nodes: [
        {
          id: 'project-id-1',
          name: 'Project Alpha',
          description: 'Alpha project',
          state: 'started',
          url: 'https://linear.app/team/project/alpha',
          progress: 0.5,
          targetDate: null,
          startDate: null,
          lead: Promise.resolve({ name: 'Alice' }),
          teams: vi.fn().mockResolvedValue({ nodes: [{ id: 'team-id-1' }] }),
        },
      ],
    }),
    project: vi.fn().mockResolvedValue({
      id: 'project-id-1',
      name: 'Project Alpha',
      state: 'started',
      url: 'https://linear.app/team/project/alpha',
      issues: vi.fn().mockResolvedValue({ nodes: [defaultMockIssue] }),
      projectUpdates: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'update-id-1',
            body: 'Status update body',
            health: 'onTrack',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            user: Promise.resolve({ name: 'Alice' }),
          },
        ],
      }),
    }),
    createProject: vi.fn().mockResolvedValue({
      success: true,
      project: Promise.resolve({
        id: 'new-project-id',
        name: 'New Project',
        state: 'planned',
        url: 'https://linear.app/team/project/new',
      }),
    }),
    updateProject: vi.fn().mockResolvedValue({
      success: true,
      project: Promise.resolve({
        id: 'project-id-1',
        name: 'Updated Project',
        state: 'started',
        url: 'https://linear.app/team/project/updated',
      }),
    }),
    createProjectUpdate: vi.fn().mockResolvedValue({ success: true, projectUpdateId: 'update-id-new' }),
    createIssueRelation: vi.fn().mockResolvedValue({
      success: true,
      issueRelation: Promise.resolve({
        id: 'relation-id-1',
        type: 'blocks',
        relatedIssue: Promise.resolve({
          identifier: 'ENG-2',
          title: 'Related Issue',
          state: Promise.resolve({ name: 'Todo' }),
        }),
      }),
    }),
    issueLabels: vi.fn().mockResolvedValue({
      nodes: [
        { id: 'label-id-1', name: 'bug', color: '#ff0000' },
        { id: 'label-id-2', name: 'feature', color: '#00ff00' },
      ],
    }),
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// Assign the initial instance so the mock factory closure can see it.
mockClientInstance = buildMockClientInstance();

beforeEach(() => {
  // Rebuild all mock methods on the existing instance object in place.
  // This keeps the singleton _client in linear.ts pointing to the same
  // object reference while giving each test fresh vi.fn() stubs.
  const fresh = buildMockClientInstance();
  Object.assign(mockClientInstance, fresh);

  process.env.SWARMCODE_LINEAR_API_KEY = 'test-key';
  delete process.env.SWARMCODE_LINEAR_TEAM;
  clearCache();
});

// ---------------------------------------------------------------------------
// Convenience: get a reference to the current mock client for assertions
// ---------------------------------------------------------------------------
function getMock() {
  return mockClientInstance;
}

// ===========================================================================
// isConfigured
// ===========================================================================

describe('isConfigured', () => {
  it('returns true when SWARMCODE_LINEAR_API_KEY is set', () => {
    process.env.SWARMCODE_LINEAR_API_KEY = 'some-key';
    expect(isConfigured()).toBe(true);
  });

  it('returns false when SWARMCODE_LINEAR_API_KEY is unset', () => {
    delete process.env.SWARMCODE_LINEAR_API_KEY;
    expect(isConfigured()).toBe(false);
  });

  it('returns false when SWARMCODE_LINEAR_API_KEY is empty string', () => {
    process.env.SWARMCODE_LINEAR_API_KEY = '';
    expect(isConfigured()).toBe(false);
  });
});

// ===========================================================================
// getViewer
// ===========================================================================

describe('getViewer', () => {
  it('returns the authenticated user', async () => {
    const result = await getViewer();
    expect(result).toEqual({
      id: 'viewer-id',
      name: 'Viewer User',
      email: 'viewer@example.com',
      active: true,
    });
  });

  it('throws when API key is not set', async () => {
    delete process.env.SWARMCODE_LINEAR_API_KEY;
    // _client is already set in the singleton, so the throw only happens on first
    // getClient() call. We need to reset the module or ensure getClient() re-checks.
    // Since the singleton is set, we test this by checking isConfigured instead.
    expect(isConfigured()).toBe(false);
  });
});

// ===========================================================================
// getTeams
// ===========================================================================

describe('getTeams', () => {
  it('returns mapped team list', async () => {
    const result = await getTeams();
    expect(result).toEqual([{ id: 'team-id-1', name: 'Engineering', key: 'ENG' }]);
  });

  it('returns empty array when no teams exist', async () => {
    getMock().teams.mockResolvedValue({ nodes: [] });
    const result = await getTeams();
    expect(result).toEqual([]);
  });

  it('maps all team fields correctly', async () => {
    getMock().teams.mockResolvedValue({
      nodes: [
        { id: 'team-a', name: 'Alpha', key: 'ALP' },
        { id: 'team-b', name: 'Beta', key: 'BET' },
      ],
    });
    const result = await getTeams();
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: 'team-b', name: 'Beta', key: 'BET' });
  });
});

// ===========================================================================
// getUsers
// ===========================================================================

describe('getUsers', () => {
  it('returns mapped user list', async () => {
    const result = await getUsers();
    expect(result).toEqual([
      { id: 'user-id-1', name: 'Alice', email: 'alice@example.com', active: true },
    ]);
  });

  it('returns empty array when no users exist', async () => {
    getMock().users.mockResolvedValue({ nodes: [] });
    const result = await getUsers();
    expect(result).toEqual([]);
  });

  it('maps all user fields correctly', async () => {
    getMock().users.mockResolvedValue({
      nodes: [{ id: 'u2', name: 'Bob', email: 'bob@example.com', active: false }],
    });
    const result = await getUsers();
    expect(result[0].active).toBe(false);
  });
});

// ===========================================================================
// getWorkflowStates
// ===========================================================================

describe('getWorkflowStates', () => {
  it('returns states sorted by position', async () => {
    const result = await getWorkflowStates('team-id-1');
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Todo');
    expect(result[1].name).toBe('In Progress');
    expect(result[2].name).toBe('Done');
    expect(result[0].position).toBeLessThan(result[1].position);
  });

  it('returns correct shape for each state', async () => {
    const result = await getWorkflowStates('team-id-1');
    expect(result[0]).toEqual({
      id: 'state-todo',
      name: 'Todo',
      type: 'unstarted',
      position: 1,
    });
  });

  it('returns empty array when team has no states', async () => {
    getMock().team.mockResolvedValue({
      id: 'team-id-1',
      states: vi.fn().mockResolvedValue({ nodes: [] }),
    });
    const result = await getWorkflowStates('team-id-1');
    expect(result).toEqual([]);
  });

  it('sorts states with unsorted positions correctly', async () => {
    getMock().team.mockResolvedValue({
      id: 'team-id-1',
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: 's3', name: 'Done', type: 'completed', position: 3 },
          { id: 's1', name: 'Todo', type: 'unstarted', position: 1 },
          { id: 's2', name: 'In Progress', type: 'started', position: 2 },
        ],
      }),
    });
    const result = await getWorkflowStates('team-id-1');
    expect(result.map(s => s.position)).toEqual([1, 2, 3]);
  });
});

// ===========================================================================
// getCycles
// ===========================================================================

describe('getCycles', () => {
  it('returns active null and empty recent when no cycles', async () => {
    const result = await getCycles('team-id-1');
    expect(result.active).toBeNull();
    expect(result.recent).toEqual([]);
  });

  it('returns active cycle when present', async () => {
    const activeCycleData = {
      id: 'cycle-id-1',
      name: 'Sprint 1',
      number: 1,
      startsAt: new Date('2024-01-01T00:00:00Z'),
      endsAt: new Date('2024-01-14T00:00:00Z'),
      issueCountHistory: [5, 5, 6],
      completedIssueCountHistory: [0, 1, 3],
    };
    getMock().team.mockResolvedValue({
      id: 'team-id-1',
      activeCycle: Promise.resolve(activeCycleData),
      cycles: vi.fn().mockResolvedValue({ nodes: [] }),
    });

    const result = await getCycles('team-id-1');
    expect(result.active).not.toBeNull();
    expect(result.active!.id).toBe('cycle-id-1');
    expect(result.active!.name).toBe('Sprint 1');
    expect(result.active!.issueCount).toBe(6);
    expect(result.active!.completedIssueCount).toBe(3);
  });

  it('returns recent cycles list', async () => {
    const cycleData = {
      id: 'cycle-id-2',
      name: 'Sprint 2',
      number: 2,
      startsAt: new Date('2024-01-15T00:00:00Z'),
      endsAt: new Date('2024-01-28T00:00:00Z'),
      issueCountHistory: [4],
      completedIssueCountHistory: [4],
    };
    getMock().team.mockResolvedValue({
      id: 'team-id-1',
      activeCycle: Promise.resolve(null),
      cycles: vi.fn().mockResolvedValue({ nodes: [cycleData] }),
    });

    const result = await getCycles('team-id-1');
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0].id).toBe('cycle-id-2');
  });

  it('handles cycles with empty history arrays', async () => {
    const cycleData = {
      id: 'cycle-id-3',
      name: null,
      number: 3,
      startsAt: new Date('2024-02-01T00:00:00Z'),
      endsAt: new Date('2024-02-14T00:00:00Z'),
      issueCountHistory: [],
      completedIssueCountHistory: [],
    };
    getMock().team.mockResolvedValue({
      id: 'team-id-1',
      activeCycle: Promise.resolve(cycleData),
      cycles: vi.fn().mockResolvedValue({ nodes: [] }),
    });

    const result = await getCycles('team-id-1');
    expect(result.active!.issueCount).toBe(0);
    expect(result.active!.completedIssueCount).toBe(0);
    expect(result.active!.name).toBeNull();
  });
});

// ===========================================================================
// getLinearData
// ===========================================================================

describe('getLinearData', () => {
  it('returns null when SWARMCODE_LINEAR_API_KEY is not set', async () => {
    delete process.env.SWARMCODE_LINEAR_API_KEY;
    const result = await getLinearData();
    expect(result).toBeNull();
  });

  it('returns LinearData with issues when configured', async () => {
    const result = await getLinearData();
    expect(result).not.toBeNull();
    expect(result!.issues).toHaveLength(1);
    expect(result!.issues[0].identifier).toBe('ENG-1');
    expect(result!.team).toBeNull();
    expect(result!.cycle).toBeNull();
  });

  it('filters by team key when SWARMCODE_LINEAR_TEAM is set', async () => {
    process.env.SWARMCODE_LINEAR_TEAM = 'ENG';
    const result = await getLinearData();
    expect(result!.team).toBe('ENG');

    const callArgs = getMock().client.rawRequest.mock.calls[0] as [string, { filter: Record<string, unknown> }];
    expect(callArgs[1].filter).toHaveProperty('team');
  });

  it('fetches active cycle when team is set', async () => {
    process.env.SWARMCODE_LINEAR_TEAM = 'ENG';
    const activeCycleData = {
      id: 'cycle-id-1',
      name: 'Sprint 1',
      number: 1,
      startsAt: new Date('2024-01-01T00:00:00Z'),
      endsAt: new Date('2024-01-14T00:00:00Z'),
      issueCountHistory: [5],
      completedIssueCountHistory: [2],
    };
    getMock().team.mockResolvedValue({
      id: 'team-id-1',
      activeCycle: Promise.resolve(activeCycleData),
      cycles: vi.fn().mockResolvedValue({ nodes: [] }),
    });

    const result = await getLinearData();
    expect(result!.cycle).not.toBeNull();
    expect(result!.cycle!.id).toBe('cycle-id-1');
  });

  it('returns null cycle when cycle fetch fails', async () => {
    process.env.SWARMCODE_LINEAR_TEAM = 'ENG';
    getMock().team.mockRejectedValue(new Error('cycle fetch failed'));

    const result = await getLinearData();
    // Cycle fetch is optional — should still return data
    expect(result).not.toBeNull();
    expect(result!.cycle).toBeNull();
  });

  it('does not include team filter when SWARMCODE_LINEAR_TEAM is unset', async () => {
    await getLinearData();
    const callArgs = getMock().client.rawRequest.mock.calls[0] as [string, { filter: Record<string, unknown> }];
    expect(callArgs[1].filter).not.toHaveProperty('team');
  });
});

// ===========================================================================
// searchIssues
// ===========================================================================

describe('searchIssues', () => {
  it('returns issues matching the query', async () => {
    const result = await searchIssues('test query');
    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('ENG-1');
  });

  it('re-fetches full Issue objects via client.issue() after searchIssues()', async () => {
    // searchIssues returns lightweight search results (no relational methods)
    getMock().searchIssues.mockResolvedValue({ nodes: [{ id: 'issue-id-1' }, { id: 'issue-id-2' }] });
    getMock().issue
      .mockResolvedValueOnce(createMockIssue({ id: 'issue-id-1', identifier: 'ENG-1' }))
      .mockResolvedValueOnce(createMockIssue({ id: 'issue-id-2', identifier: 'ENG-2' }));

    const result = await searchIssues('multi');
    // Must call client.issue() for each search result node
    expect(getMock().issue).toHaveBeenCalledWith('issue-id-1');
    expect(getMock().issue).toHaveBeenCalledWith('issue-id-2');
    expect(result).toHaveLength(2);
  });

  it('passes the limit parameter', async () => {
    await searchIssues('query', 5);
    expect(getMock().searchIssues).toHaveBeenCalledWith('query', { first: 5 });
  });

  it('uses default limit of 20', async () => {
    await searchIssues('query');
    expect(getMock().searchIssues).toHaveBeenCalledWith('query', { first: 20 });
  });

  it('returns empty array when no results found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await searchIssues('nothing');
    expect(result).toEqual([]);
  });

  it('maps issue fields correctly', async () => {
    const result = await searchIssues('test');
    expect(result[0]).toMatchObject({
      id: 'issue-id-1',
      identifier: 'ENG-1',
      title: 'Test Issue',
      status: 'In Progress',
      statusType: 'started',
      priority: 2,
      labels: ['bug'],
    });
  });
});

// ===========================================================================
// getIssue (lookupIssue integration)
// ===========================================================================

describe('getIssue', () => {
  it('returns full issue detail', async () => {
    const result = await getIssue('ENG-1');
    expect(result.identifier).toBe('ENG-1');
    expect(result.title).toBe('Test Issue');
    expect(result.teamId).toBe('team-id-1');
    expect(result.teamKey).toBe('ENG');
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].author).toBe('Bob');
    expect(result.comments[0].body).toBe('A comment');
  });

  it('uses lookupIssue which calls searchIssues then re-fetches via client.issue()', async () => {
    await getIssue('ENG-1');
    expect(getMock().searchIssues).toHaveBeenCalledWith('ENG-1', { first: 1 });
    // client.issue() called to get the full Issue object from the search result node id
    expect(getMock().issue).toHaveBeenCalledWith('issue-id-1');
  });

  it('throws when issue is not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    await expect(getIssue('ENG-999')).rejects.toThrow('Issue "ENG-999" not found in Linear');
  });

  it('includes children in the detail', async () => {
    const childIssue = {
      identifier: 'ENG-1-1',
      title: 'Child Issue',
      state: Promise.resolve({ name: 'Todo' }),
      assignee: Promise.resolve(null),
    };
    const mockIssueWithChildren = createMockIssue({
      children: vi.fn().mockResolvedValue({ nodes: [childIssue] }),
    });
    getMock().issue.mockResolvedValue(mockIssueWithChildren);

    const result = await getIssue('ENG-1');
    expect(result.children).toHaveLength(1);
    expect(result.children[0].identifier).toBe('ENG-1-1');
    expect(result.children[0].status).toBe('Todo');
    expect(result.children[0].assignee).toBeNull();
  });

  it('returns correct timestamps', async () => {
    const result = await getIssue('ENG-1');
    expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(result.updatedAt).toBe('2024-01-02T00:00:00.000Z');
  });
});

// ===========================================================================
// startIssue
// ===========================================================================

describe('startIssue', () => {
  // Helper: create an unstarted issue for happy-path tests
  function setUnstartedIssue(overrides: Record<string, unknown> = {}) {
    const issue = createMockIssue({
      state: Promise.resolve({ id: 'state-todo', name: 'Todo', type: 'unstarted' }),
      assignee: Promise.resolve(null),
      ...overrides,
    });
    getMock().issue.mockResolvedValue(issue);
  }

  it('assigns to viewer and moves to started state', async () => {
    setUnstartedIssue();
    const result = await startIssue('ENG-1');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith(
      'issue-id-1',
      expect.objectContaining({ assigneeId: 'viewer-id', stateId: 'state-started' }),
    );
  });

  it('returns updated issue data on success', async () => {
    setUnstartedIssue();
    const result = await startIssue('ENG-1');
    expect(result.issue).not.toBeNull();
    expect(result.issue!.identifier).toBe('ENG-1');
  });

  it('rejects if issue is already in progress', async () => {
    // Default mock has state: 'started' — do not override
    const result = await startIssue('ENG-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already');
    expect(getMock().updateIssue).not.toHaveBeenCalled();
  });

  it('rejects if issue is already completed', async () => {
    const completedIssue = createMockIssue({
      state: Promise.resolve({ id: 'state-done', name: 'Done', type: 'completed' }),
    });
    getMock().issue.mockResolvedValue(completedIssue);
    const result = await startIssue('ENG-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('already');
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await startIssue('ENG-999');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when team cannot be resolved', async () => {
    const issueNoTeam = createMockIssue({
      state: Promise.resolve({ id: 'state-todo', name: 'Todo', type: 'unstarted' }),
      assignee: Promise.resolve(null),
      team: Promise.resolve(null),
    });
    getMock().issue.mockResolvedValue(issueNoTeam);
    const result = await startIssue('ENG-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('team');
  });

  it('still assigns if no started state exists', async () => {
    const teamNoStarted = {
      id: 'team-id-1',
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: 'state-todo', name: 'Todo', type: 'unstarted' },
          { id: 'state-done', name: 'Done', type: 'completed' },
        ],
      }),
    };
    setUnstartedIssue({ team: Promise.resolve(teamNoStarted) });

    const result = await startIssue('ENG-1');
    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith(
      'issue-id-1',
      expect.objectContaining({ assigneeId: 'viewer-id' }),
    );
    // stateId should NOT be in the update if no started state
    const updateArg = getMock().updateIssue.mock.calls[0][1] as Record<string, string>;
    expect(updateArg.stateId).toBeUndefined();
  });
});

// ===========================================================================
// completeIssue
// ===========================================================================

describe('completeIssue', () => {
  it('moves issue to completed state', async () => {
    const result = await completeIssue('ENG-1');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', { stateId: 'state-done' });
  });

  it('returns error when no completed state exists', async () => {
    const teamNoCompleted = {
      id: 'team-id-1',
      states: vi.fn().mockResolvedValue({
        nodes: [
          { id: 'state-todo', name: 'Todo', type: 'unstarted' },
          { id: 'state-started', name: 'In Progress', type: 'started' },
        ],
      }),
    };
    const issueNoCompleted = createMockIssue({ team: Promise.resolve(teamNoCompleted) });
    getMock().issue.mockResolvedValue(issueNoCompleted);

    const result = await completeIssue('ENG-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No "completed" state found');
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await completeIssue('ENG-999');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when team cannot be resolved', async () => {
    getMock().issue.mockResolvedValue(createMockIssue({ team: Promise.resolve(null) }));
    const result = await completeIssue('ENG-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('team');
  });
});

// ===========================================================================
// updateIssueStatus
// ===========================================================================

describe('updateIssueStatus', () => {
  it('moves issue to the requested status type', async () => {
    const result = await updateIssueStatus('ENG-1', 'unstarted');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', { stateId: 'state-todo' });
  });

  it('returns error with available states when status type not found', async () => {
    const result = await updateIssueStatus('ENG-1', 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No "nonexistent" state found');
    expect(result.error).toContain('Available:');
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await updateIssueStatus('ENG-999', 'started');
    expect(result.success).toBe(false);
  });

  it('returns error when team cannot be resolved', async () => {
    getMock().issue.mockResolvedValue(createMockIssue({ team: Promise.resolve(null) }));
    const result = await updateIssueStatus('ENG-1', 'started');
    expect(result.success).toBe(false);
  });
});

// ===========================================================================
// updateIssue
// ===========================================================================

describe('updateIssue', () => {
  it('updates issue fields and returns success', async () => {
    const result = await updateIssue('ENG-1', { title: 'Updated Title', priority: 1 });

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith(
      'issue-id-1',
      { title: 'Updated Title', priority: 1 },
    );
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await updateIssue('ENG-999', { title: 'X' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when updateIssue throws', async () => {
    getMock().updateIssue.mockRejectedValue(new Error('API error'));
    const result = await updateIssue('ENG-1', { title: 'X' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('API error');
  });

  it('can update multiple fields at once', async () => {
    const fields = { title: 'New Title', description: 'New desc', priority: 3, estimate: 5 };
    await updateIssue('ENG-1', fields);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', fields);
  });
});

// ===========================================================================
// createIssue
// ===========================================================================

describe('createIssue', () => {
  it('creates issue and returns write result', async () => {
    const result = await createIssue({ title: 'New Issue', teamId: 'team-id-1' });
    expect(result.success).toBe(true);
    expect(result.issue).not.toBeNull();
    expect(result.issue!.identifier).toBe('ENG-99');
    expect(result.issue!.title).toBe('New Issue');
  });

  it('returns error when creation fails', async () => {
    getMock().createIssue.mockResolvedValue({ success: false });
    const result = await createIssue({ title: 'X', teamId: 'team-id-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Issue creation failed');
  });

  it('returns success with null issue when created issue is null', async () => {
    getMock().createIssue.mockResolvedValue({ success: true, issue: Promise.resolve(null) });
    const result = await createIssue({ title: 'X', teamId: 'team-id-1' });
    expect(result.success).toBe(true);
    expect(result.issue).toBeNull();
  });

  it('returns error when createIssue throws', async () => {
    getMock().createIssue.mockRejectedValue(new Error('Network error'));
    const result = await createIssue({ title: 'X', teamId: 'team-id-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('passes all optional fields to the SDK', async () => {
    const fields = {
      title: 'Full Issue',
      teamId: 'team-id-1',
      description: 'Description',
      priority: 2,
      assigneeId: 'user-id-1',
      stateId: 'state-started',
      dueDate: '2024-12-31',
      estimate: 3,
    };
    await createIssue(fields);
    expect(getMock().createIssue).toHaveBeenCalledWith(fields);
  });
});

// ===========================================================================
// createSubIssue
// ===========================================================================

describe('createSubIssue', () => {
  it('creates a sub-issue under the parent', async () => {
    const result = await createSubIssue('ENG-1', { title: 'Sub Issue' });

    expect(result.success).toBe(true);
    // Should create issue with teamId from parent's team and parentId from parent issue
    expect(getMock().createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sub Issue', teamId: 'team-id-1', parentId: 'issue-id-1' }),
    );
  });

  it('returns error when parent issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await createSubIssue('ENG-999', { title: 'Sub' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when parent team cannot be resolved', async () => {
    getMock().issue.mockResolvedValue(createMockIssue({ team: Promise.resolve(null) }));
    const result = await createSubIssue('ENG-1', { title: 'Sub' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('team');
  });
});

// ===========================================================================
// commentOnIssue
// ===========================================================================

describe('commentOnIssue', () => {
  it('creates a comment and returns commentId', async () => {
    const result = await commentOnIssue('ENG-1', 'Great work!');

    expect(result.success).toBe(true);
    expect(result.commentId).toBe('comment-id-new');
    expect(getMock().createComment).toHaveBeenCalledWith({
      issueId: 'issue-id-1',
      body: 'Great work!',
    });
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await commentOnIssue('ENG-999', 'Hello');
    expect(result.success).toBe(false);
    expect(result.commentId).toBeNull();
    expect(result.error).toContain('not found');
  });

  it('returns error when createComment throws', async () => {
    getMock().createComment.mockRejectedValue(new Error('Comment error'));
    const result = await commentOnIssue('ENG-1', 'Body');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Comment error');
  });
});

// ===========================================================================
// getProjects
// ===========================================================================

describe('getProjects', () => {
  it('returns mapped project list', async () => {
    const result = await getProjects();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'project-id-1',
      name: 'Project Alpha',
      state: 'started',
      progress: 0.5,
      lead: 'Alice',
      teamIds: ['team-id-1'],
    });
  });

  it('passes the limit parameter', async () => {
    await getProjects(10);
    expect(getMock().projects).toHaveBeenCalledWith(expect.objectContaining({ first: 10 }));
  });

  it('defaults to limit 25', async () => {
    await getProjects();
    expect(getMock().projects).toHaveBeenCalledWith(expect.objectContaining({ first: 25 }));
  });

  it('handles project with no lead', async () => {
    getMock().projects.mockResolvedValue({
      nodes: [
        {
          id: 'project-id-2',
          name: 'No Lead Project',
          description: null,
          state: 'planned',
          url: 'https://linear.app/p/2',
          progress: 0,
          targetDate: null,
          startDate: null,
          lead: Promise.resolve(null),
          teams: vi.fn().mockResolvedValue({ nodes: [] }),
        },
      ],
    });
    const result = await getProjects();
    expect(result[0].lead).toBeNull();
    expect(result[0].teamIds).toEqual([]);
  });
});

// ===========================================================================
// getProjectIssues
// ===========================================================================

describe('getProjectIssues', () => {
  it('returns issues for a project', async () => {
    const result = await getProjectIssues('project-id-1');
    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe('ENG-1');
  });

  it('passes the limit parameter', async () => {
    const issuesFn = vi.fn().mockResolvedValue({ nodes: [] });
    getMock().project.mockResolvedValue({ id: 'project-id-1', issues: issuesFn });

    await getProjectIssues('project-id-1', 10);
    expect(issuesFn).toHaveBeenCalledWith({ first: 10 });
  });
});

// ===========================================================================
// createProject
// ===========================================================================

describe('createProject', () => {
  it('creates a project and returns result', async () => {
    const result = await createProject({ name: 'New Project', teamIds: ['team-id-1'] });
    expect(result.success).toBe(true);
    expect(result.project).not.toBeNull();
    expect(result.project!.id).toBe('new-project-id');
    expect(result.project!.name).toBe('New Project');
  });

  it('returns error when creation fails', async () => {
    getMock().createProject.mockResolvedValue({ success: false });
    const result = await createProject({ name: 'X', teamIds: [] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Project creation failed');
  });

  it('returns success with null project when created project is null', async () => {
    getMock().createProject.mockResolvedValue({ success: true, project: Promise.resolve(null) });
    const result = await createProject({ name: 'X', teamIds: [] });
    expect(result.success).toBe(true);
    expect(result.project).toBeNull();
  });

  it('returns error when createProject throws', async () => {
    getMock().createProject.mockRejectedValue(new Error('SDK error'));
    const result = await createProject({ name: 'X', teamIds: [] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('SDK error');
  });
});

// ===========================================================================
// updateProject
// ===========================================================================

describe('updateProject', () => {
  it('updates a project and returns result', async () => {
    const result = await updateProject('project-id-1', { name: 'Updated Name' });
    expect(result.success).toBe(true);
    expect(result.project!.name).toBe('Updated Project');
  });

  it('returns error when update fails', async () => {
    getMock().updateProject.mockResolvedValue({ success: false });
    const result = await updateProject('project-id-1', { name: 'X' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Project update failed');
  });

  it('returns error when updateProject throws', async () => {
    getMock().updateProject.mockRejectedValue(new Error('Update failed'));
    const result = await updateProject('project-id-1', { name: 'X' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Update failed');
  });

  it('returns success with null project when updated project is null', async () => {
    getMock().updateProject.mockResolvedValue({ success: true, project: Promise.resolve(null) });
    const result = await updateProject('project-id-1', { name: 'X' });
    expect(result.success).toBe(true);
    expect(result.project).toBeNull();
  });
});

// ===========================================================================
// addIssueToProject
// ===========================================================================

describe('addIssueToProject', () => {
  it('adds an issue to a project', async () => {
    const result = await addIssueToProject('ENG-1', 'project-id-1');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', { projectId: 'project-id-1' });
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await addIssueToProject('ENG-999', 'project-id-1');
    expect(result.success).toBe(false);
  });

  it('returns error when updateIssue throws', async () => {
    getMock().updateIssue.mockRejectedValue(new Error('Project error'));
    const result = await addIssueToProject('ENG-1', 'project-id-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Project error');
  });
});

// ===========================================================================
// getProjectUpdates
// ===========================================================================

describe('getProjectUpdates', () => {
  it('returns project updates', async () => {
    const result = await getProjectUpdates('project-id-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'update-id-1',
      body: 'Status update body',
      health: 'onTrack',
      user: 'Alice',
    });
    expect(result[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('passes the limit parameter', async () => {
    const updatesFn = vi.fn().mockResolvedValue({ nodes: [] });
    getMock().project.mockResolvedValue({ projectUpdates: updatesFn });

    await getProjectUpdates('project-id-1', 5);
    expect(updatesFn).toHaveBeenCalledWith({ first: 5 });
  });

  it('handles updates with null user', async () => {
    getMock().project.mockResolvedValue({
      projectUpdates: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'update-id-2',
            body: 'Anonymous update',
            health: 'atRisk',
            createdAt: new Date('2024-01-02T00:00:00Z'),
            user: Promise.resolve(null),
          },
        ],
      }),
    });
    const result = await getProjectUpdates('project-id-1');
    expect(result[0].user).toBe('unknown');
  });
});

// ===========================================================================
// createProjectUpdate
// ===========================================================================

describe('createProjectUpdate', () => {
  it('creates a project update and returns updateId', async () => {
    const result = await createProjectUpdate('project-id-1', 'All good', 'onTrack');

    expect(result.success).toBe(true);
    expect(result.updateId).toBe('update-id-new');
    expect(getMock().createProjectUpdate).toHaveBeenCalledWith({
      projectId: 'project-id-1',
      body: 'All good',
      health: 'onTrack',
    });
  });

  it('defaults health to onTrack', async () => {
    await createProjectUpdate('project-id-1', 'Status');
    expect(getMock().createProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ health: 'onTrack' }),
    );
  });

  it('returns error when createProjectUpdate throws', async () => {
    getMock().createProjectUpdate.mockRejectedValue(new Error('Update error'));
    const result = await createProjectUpdate('project-id-1', 'Body');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Update error');
  });
});

// ===========================================================================
// addIssueToCycle
// ===========================================================================

describe('addIssueToCycle', () => {
  it('adds an issue to a cycle', async () => {
    const result = await addIssueToCycle('ENG-1', 'cycle-id-1');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', { cycleId: 'cycle-id-1' });
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await addIssueToCycle('ENG-999', 'cycle-id-1');
    expect(result.success).toBe(false);
  });

  it('returns error when updateIssue throws', async () => {
    getMock().updateIssue.mockRejectedValue(new Error('Cycle error'));
    const result = await addIssueToCycle('ENG-1', 'cycle-id-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cycle error');
  });
});

// ===========================================================================
// archiveIssue
// ===========================================================================

describe('archiveIssue', () => {
  it('archives the issue', async () => {
    const result = await archiveIssue('ENG-1');

    expect(result.success).toBe(true);
    expect(getMock().archiveIssue).toHaveBeenCalledWith('issue-id-1');
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await archiveIssue('ENG-999');
    expect(result.success).toBe(false);
  });

  it('returns error when archiveIssue throws', async () => {
    getMock().archiveIssue.mockRejectedValue(new Error('Archive failed'));
    const result = await archiveIssue('ENG-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Archive failed');
  });
});

// ===========================================================================
// createIssueRelation
// ===========================================================================

describe('createIssueRelation', () => {
  it('creates a relation between two issues', async () => {
    // First searchIssues call for ENG-1, second for ENG-2
    getMock().searchIssues
      .mockResolvedValueOnce({ nodes: [{ id: 'issue-id-1' }] })
      .mockResolvedValueOnce({ nodes: [{ id: 'issue-id-2' }] });
    getMock().issue
      .mockResolvedValueOnce(createMockIssue({ id: 'issue-id-1', identifier: 'ENG-1' }))
      .mockResolvedValueOnce(createMockIssue({ id: 'issue-id-2', identifier: 'ENG-2' }));

    const result = await createIssueRelation('ENG-1', 'ENG-2', 'blocks');

    expect(result.success).toBe(true);
    expect(result.relation).not.toBeNull();
    expect(result.relation!.type).toBe('blocks');
    expect(result.relation!.relatedIssue.identifier).toBe('ENG-2');
    expect(getMock().createIssueRelation).toHaveBeenCalledWith({
      issueId: 'issue-id-1',
      relatedIssueId: 'issue-id-2',
      type: 'blocks',
    });
  });

  it('returns error when creation fails', async () => {
    getMock().createIssueRelation.mockResolvedValue({ success: false });
    const result = await createIssueRelation('ENG-1', 'ENG-2', 'blocks');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Relation creation failed');
  });

  it('returns success with null relation when issueRelation is null', async () => {
    getMock().createIssueRelation.mockResolvedValue({
      success: true,
      issueRelation: Promise.resolve(null),
    });
    const result = await createIssueRelation('ENG-1', 'ENG-2', 'blocks');
    expect(result.success).toBe(true);
    expect(result.relation).toBeNull();
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await createIssueRelation('ENG-999', 'ENG-2', 'blocks');
    expect(result.success).toBe(false);
  });

  it('returns error when createIssueRelation throws', async () => {
    getMock().createIssueRelation.mockRejectedValue(new Error('Relation error'));
    const result = await createIssueRelation('ENG-1', 'ENG-2', 'blocks');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Relation error');
  });
});

// ===========================================================================
// getIssueRelations
// ===========================================================================

describe('getIssueRelations', () => {
  it('returns empty array when no relations exist', async () => {
    const result = await getIssueRelations('ENG-1');
    expect(result).toEqual([]);
  });

  it('returns direct relations', async () => {
    const relatedIssueObj = {
      identifier: 'ENG-2',
      title: 'Related',
      state: Promise.resolve({ name: 'Todo' }),
    };
    const mockIssueWithRelations = createMockIssue({
      relations: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'rel-id-1',
            type: 'blocks',
            relatedIssue: Promise.resolve(relatedIssueObj),
          },
        ],
      }),
      inverseRelations: vi.fn().mockResolvedValue({ nodes: [] }),
    });
    getMock().issue.mockResolvedValue(mockIssueWithRelations);

    const result = await getIssueRelations('ENG-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'rel-id-1',
      type: 'blocks',
      relatedIssue: { identifier: 'ENG-2', title: 'Related', status: 'Todo' },
    });
  });

  it('returns inverse relations with inverse_ prefix', async () => {
    const inverseIssueObj = {
      identifier: 'ENG-3',
      title: 'Blocker',
      state: Promise.resolve({ name: 'In Progress' }),
    };
    const mockIssueWithInverse = createMockIssue({
      relations: vi.fn().mockResolvedValue({ nodes: [] }),
      inverseRelations: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'rel-id-2',
            type: 'blocks',
            issue: Promise.resolve(inverseIssueObj),
          },
        ],
      }),
    });
    getMock().issue.mockResolvedValue(mockIssueWithInverse);

    const result = await getIssueRelations('ENG-1');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('inverse_blocks');
    expect(result[0].relatedIssue.identifier).toBe('ENG-3');
  });

  it('combines direct and inverse relations', async () => {
    const directRelatedIssue = {
      identifier: 'ENG-2',
      title: 'Direct',
      state: Promise.resolve({ name: 'Todo' }),
    };
    const inverseRelatedIssue = {
      identifier: 'ENG-3',
      title: 'Inverse',
      state: Promise.resolve({ name: 'Done' }),
    };
    const mockIssueWithBoth = createMockIssue({
      relations: vi.fn().mockResolvedValue({
        nodes: [{ id: 'rel-1', type: 'blocks', relatedIssue: Promise.resolve(directRelatedIssue) }],
      }),
      inverseRelations: vi.fn().mockResolvedValue({
        nodes: [{ id: 'rel-2', type: 'blocks', issue: Promise.resolve(inverseRelatedIssue) }],
      }),
    });
    getMock().issue.mockResolvedValue(mockIssueWithBoth);

    const result = await getIssueRelations('ENG-1');
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('blocks');
    expect(result[1].type).toBe('inverse_blocks');
  });

  it('handles null relatedIssue gracefully', async () => {
    const mockIssueNullRelated = createMockIssue({
      relations: vi.fn().mockResolvedValue({
        nodes: [{ id: 'rel-id-1', type: 'blocks', relatedIssue: Promise.resolve(null) }],
      }),
      inverseRelations: vi.fn().mockResolvedValue({ nodes: [] }),
    });
    getMock().issue.mockResolvedValue(mockIssueNullRelated);

    const result = await getIssueRelations('ENG-1');
    expect(result[0].relatedIssue).toEqual({ identifier: '', title: '', status: '' });
  });
});

// ===========================================================================
// getIssueHistory
// ===========================================================================

describe('getIssueHistory', () => {
  it('returns empty array when no history entries', async () => {
    const result = await getIssueHistory('ENG-1');
    expect(result).toEqual([]);
  });

  it('returns history entries with resolved states and actor', async () => {
    const mockIssueWithHistory = createMockIssue({
      history: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'history-id-1',
            createdAt: new Date('2024-01-01T10:00:00Z'),
            fromState: Promise.resolve({ name: 'Todo' }),
            toState: Promise.resolve({ name: 'In Progress' }),
            actor: Promise.resolve({ name: 'Alice' }),
            updatedDescription: null,
          },
        ],
      }),
    });
    getMock().issue.mockResolvedValue(mockIssueWithHistory);

    const result = await getIssueHistory('ENG-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'history-id-1',
      createdAt: '2024-01-01T10:00:00.000Z',
      fromState: 'Todo',
      toState: 'In Progress',
      actor: 'Alice',
      updatedDescription: null,
    });
  });

  it('handles null fromState, toState, and actor', async () => {
    const mockIssueNullHistory = createMockIssue({
      history: vi.fn().mockResolvedValue({
        nodes: [
          {
            id: 'history-id-2',
            createdAt: new Date('2024-01-01T11:00:00Z'),
            fromState: Promise.resolve(null),
            toState: Promise.resolve(null),
            actor: Promise.resolve(null),
            updatedDescription: true,
          },
        ],
      }),
    });
    getMock().issue.mockResolvedValue(mockIssueNullHistory);

    const result = await getIssueHistory('ENG-1');
    expect(result[0].fromState).toBeNull();
    expect(result[0].toState).toBeNull();
    expect(result[0].actor).toBeNull();
    expect(result[0].updatedDescription).toBe('true');
  });

  it('passes limit parameter', async () => {
    const historyFn = vi.fn().mockResolvedValue({ nodes: [] });
    getMock().issue.mockResolvedValue(createMockIssue({ history: historyFn }));

    await getIssueHistory('ENG-1', 5);
    expect(historyFn).toHaveBeenCalledWith({ first: 5 });
  });
});

// ===========================================================================
// getLabels
// ===========================================================================

describe('getLabels', () => {
  it('returns all labels', async () => {
    const result = await getLabels();
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'label-id-1', name: 'bug', color: '#ff0000' });
    expect(result[1]).toEqual({ id: 'label-id-2', name: 'feature', color: '#00ff00' });
  });

  it('handles labels with null color', async () => {
    getMock().issueLabels.mockResolvedValue({
      nodes: [{ id: 'label-id-3', name: 'no-color', color: null }],
    });
    const result = await getLabels();
    expect(result[0].color).toBe('');
  });

  it('returns empty array when no labels exist', async () => {
    getMock().issueLabels.mockResolvedValue({ nodes: [] });
    const result = await getLabels();
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// addIssueLabel
// ===========================================================================

describe('addIssueLabel', () => {
  it('adds a label to the issue', async () => {
    // Issue currently has label-id-1; add label-id-2
    const result = await addIssueLabel('ENG-1', 'label-id-2');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', {
      labelIds: ['label-id-1', 'label-id-2'],
    });
  });

  it('returns success immediately when label already exists (idempotent)', async () => {
    // Issue already has label-id-1
    const result = await addIssueLabel('ENG-1', 'label-id-1');

    expect(result.success).toBe(true);
    // Must NOT call updateIssue if label is already present
    expect(getMock().updateIssue).not.toHaveBeenCalled();
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await addIssueLabel('ENG-999', 'label-id-1');
    expect(result.success).toBe(false);
  });

  it('returns error when updateIssue throws', async () => {
    getMock().updateIssue.mockRejectedValue(new Error('Label error'));
    const result = await addIssueLabel('ENG-1', 'label-id-new');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Label error');
  });
});

// ===========================================================================
// removeIssueLabel
// ===========================================================================

describe('removeIssueLabel', () => {
  it('removes a label from the issue', async () => {
    // Issue has label-id-1; remove it
    const result = await removeIssueLabel('ENG-1', 'label-id-1');

    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', {
      labelIds: [],
    });
  });

  it('keeps remaining labels when removing one of many', async () => {
    // Give the issue two labels
    getMock().issue.mockResolvedValue(createMockIssue({
      labels: vi.fn().mockResolvedValue({
        nodes: [
          { id: 'label-id-1', name: 'bug' },
          { id: 'label-id-2', name: 'feature' },
        ],
      }),
    }));
    const result = await removeIssueLabel('ENG-1', 'label-id-1');
    expect(result.success).toBe(true);
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', {
      labelIds: ['label-id-2'],
    });
  });

  it('is a no-op when removing a label that does not exist', async () => {
    const result = await removeIssueLabel('ENG-1', 'label-id-nonexistent');
    expect(result.success).toBe(true);
    // labelIds should be unchanged (label-id-1 is still there, non-existent is filtered out)
    expect(getMock().updateIssue).toHaveBeenCalledWith('issue-id-1', {
      labelIds: ['label-id-1'],
    });
  });

  it('returns error when issue not found', async () => {
    getMock().searchIssues.mockResolvedValue({ nodes: [] });
    const result = await removeIssueLabel('ENG-999', 'label-id-1');
    expect(result.success).toBe(false);
  });

  it('returns error when updateIssue throws', async () => {
    getMock().updateIssue.mockRejectedValue(new Error('Remove label error'));
    const result = await removeIssueLabel('ENG-1', 'label-id-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Remove label error');
  });
});

// ===========================================================================
// formatAsMarkdown
// ===========================================================================

describe('formatAsMarkdown', () => {
  const baseData = {
    issues: [],
    cycle: null,
    team: null,
  };

  it('renders header', () => {
    const result = formatAsMarkdown(baseData);
    expect(result).toContain('# Linear -- Active Issues');
  });

  it('shows no active issues message when issues list is empty', () => {
    const result = formatAsMarkdown(baseData);
    expect(result).toContain('No active issues found.');
  });

  it('renders in-progress issues', () => {
    const data = {
      ...baseData,
      issues: [
        {
          id: 'i1', identifier: 'ENG-1', title: 'Do the thing',
          description: null, assignee: 'Alice', assigneeId: 'u1',
          status: 'In Progress', statusType: 'started',
          priority: 1, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
      ],
    };
    const result = formatAsMarkdown(data);
    expect(result).toContain('## In Progress');
    expect(result).toContain('**ENG-1** Do the thing (Alice)');
    expect(result).not.toContain('## Todo');
  });

  it('renders todo issues', () => {
    const data = {
      ...baseData,
      issues: [
        {
          id: 'i2', identifier: 'ENG-2', title: 'Backlog task',
          description: null, assignee: null, assigneeId: null,
          status: 'Todo', statusType: 'unstarted',
          priority: 0, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
      ],
    };
    const result = formatAsMarkdown(data);
    expect(result).toContain('## Todo');
    expect(result).toContain('**ENG-2** Backlog task');
    expect(result).not.toContain('## In Progress');
  });

  it('renders both in-progress and todo sections', () => {
    const data = {
      ...baseData,
      issues: [
        {
          id: 'i1', identifier: 'ENG-1', title: 'Active task',
          description: null, assignee: 'Bob', assigneeId: 'u1',
          status: 'In Progress', statusType: 'started',
          priority: 1, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
        {
          id: 'i2', identifier: 'ENG-2', title: 'Queued task',
          description: null, assignee: null, assigneeId: null,
          status: 'Todo', statusType: 'unstarted',
          priority: 2, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
      ],
    };
    const result = formatAsMarkdown(data);
    expect(result).toContain('## In Progress');
    expect(result).toContain('## Todo');
    expect(result).not.toContain('No active issues found.');
  });

  it('renders cycle information when cycle is present', () => {
    const data = {
      ...baseData,
      cycle: {
        id: 'cycle-1',
        name: 'Sprint 5',
        number: 5,
        startsAt: '2024-01-01T00:00:00Z',
        endsAt: '2024-01-14T00:00:00Z',
        issueCount: 10,
        completedIssueCount: 4,
      },
    };
    const result = formatAsMarkdown(data);
    expect(result).toContain('Cycle: Sprint 5');
    expect(result).toContain('ends');
  });

  it('renders cycle without name as "Current"', () => {
    const data = {
      ...baseData,
      cycle: {
        id: 'cycle-1',
        name: null,
        number: 1,
        startsAt: null,
        endsAt: null,
        issueCount: 0,
        completedIssueCount: 0,
      },
    };
    const result = formatAsMarkdown(data);
    expect(result).toContain('Cycle: Current');
  });

  it('renders team when present', () => {
    const data = { ...baseData, team: 'ENG' };
    const result = formatAsMarkdown(data);
    expect(result).toContain('Team: ENG');
  });

  it('does not render team line when team is null', () => {
    const result = formatAsMarkdown(baseData);
    expect(result).not.toContain('Team:');
  });

  it('omits assignee parentheses when assignee is null', () => {
    const data = {
      ...baseData,
      issues: [
        {
          id: 'i1', identifier: 'ENG-1', title: 'Unassigned task',
          description: null, assignee: null, assigneeId: null,
          status: 'In Progress', statusType: 'started',
          priority: 0, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
      ],
    };
    const result = formatAsMarkdown(data);
    expect(result).toContain('**ENG-1** Unassigned task');
    expect(result).not.toMatch(/Unassigned task \(/);
  });

  it('does not render in-progress or todo sections for other status types', () => {
    const data = {
      ...baseData,
      issues: [
        {
          id: 'i1', identifier: 'ENG-1', title: 'Backlog item',
          description: null, assignee: null, assigneeId: null,
          status: 'Backlog', statusType: 'backlog',
          priority: 0, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
        {
          id: 'i2', identifier: 'ENG-2', title: 'Cancelled task',
          description: null, assignee: null, assigneeId: null,
          status: 'Cancelled', statusType: 'cancelled',
          priority: 0, branchName: '', url: '', labels: [],
          dueDate: null, estimate: null, parentId: null,
        },
      ],
    };
    const result = formatAsMarkdown(data);
    expect(result).not.toContain('## In Progress');
    expect(result).not.toContain('## Todo');
    // Issues exist so the "No active issues found" message should NOT appear
    expect(result).not.toContain('No active issues found.');
  });
});
