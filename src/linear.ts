/**
 * Linear integration. Full issue lifecycle management via the @linear/sdk.
 *
 * Env vars:
 *   SWARMCODE_LINEAR_API_KEY  -- Linear personal API key (required, skip if unset)
 *   SWARMCODE_LINEAR_TEAM     -- Team key to filter by, e.g. "ENG" (optional, fetches all teams if unset)
 */

import { LinearClient } from '@linear/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  assignee: string | null;
  assigneeId: string | null;
  status: string;
  statusType: string;
  priority: number;
  branchName: string;
  url: string;
  labels: string[];
  dueDate: string | null;
  estimate: number | null;
  parentId: string | null;
}

export interface LinearIssueDetail extends LinearIssue {
  teamId: string;
  teamKey: string;
  createdAt: string;
  updatedAt: string;
  comments: Array<{ author: string; body: string; createdAt: string }>;
  children: Array<{ identifier: string; title: string; status: string; assignee: string | null }>;
}

export interface LinearCycle {
  id: string;
  name: string | null;
  number: number;
  startsAt: string | null;
  endsAt: string | null;
  issueCount: number;
  completedIssueCount: number;
}

export interface LinearTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
}

export interface LinearData {
  issues: LinearIssue[];
  cycle: LinearCycle | null;
  team: string | null;
}

export interface LinearWriteResult {
  success: boolean;
  issue: { id: string; identifier: string; title: string; status: string; assignee: string | null } | null;
  error?: string;
}

export interface LinearCommentResult {
  success: boolean;
  commentId: string | null;
  error?: string;
}

export interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  state: string;
  url: string;
  progress: number;
  targetDate: string | null;
  startDate: string | null;
  lead: string | null;
  teamIds: string[];
}

export interface LinearProjectUpdate {
  id: string;
  body: string;
  health: string;
  createdAt: string;
  user: string;
}

export interface LinearIssueRelation {
  id: string;
  type: string;
  relatedIssue: { identifier: string; title: string; status: string };
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

export interface LinearHistoryEntry {
  id: string;
  createdAt: string;
  fromState: string | null;
  toState: string | null;
  actor: string | null;
  updatedDescription: string | null;
}

export interface GenericResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let _client: LinearClient | null = null;

function getClient(): LinearClient {
  if (_client) return _client;
  const apiKey = process.env.SWARMCODE_LINEAR_API_KEY;
  if (!apiKey) throw new Error('SWARMCODE_LINEAR_API_KEY is not set');
  _client = new LinearClient({ apiKey });
  return _client;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up an issue by its human-readable identifier (e.g. "ENG-42").
 * Uses searchIssues and returns the SDK Issue object.
 */
async function lookupIssue(identifier: string) {
  const client = getClient();
  const results = await client.searchIssues(identifier, { first: 1 });
  const node = results.nodes[0];
  if (!node) throw new Error(`Issue "${identifier}" not found in Linear`);
  // Re-fetch via client.issue() to get the full Issue object with relational
  // methods (comments, children, relations, history, labels, etc.) that
  // IssueSearchResult does not expose.
  return client.issue(node.id);
}

/**
 * Convert an SDK Issue into our LinearIssue shape.
 * Resolves the lazy `state`, `assignee`, `labels`, and `parent` fields.
 */
async function toLinearIssue(issue: Awaited<ReturnType<typeof lookupIssue>>): Promise<LinearIssue> {
  const [state, assignee, labelsConn] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.labels(),
  ]);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    assignee: assignee?.name ?? null,
    assigneeId: issue.assigneeId ?? null,
    status: state?.name ?? 'Unknown',
    statusType: state?.type ?? 'unstarted',
    priority: issue.priority ?? 0,
    branchName: issue.branchName ?? '',
    url: issue.url ?? '',
    labels: labelsConn.nodes.map(l => l.name),
    dueDate: issue.dueDate ?? null,
    estimate: issue.estimate ?? null,
    parentId: issue.parentId ?? null,
  };
}

/**
 * Convert an SDK Issue into our LinearIssueDetail shape (includes comments, children, team info).
 */
async function toLinearIssueDetail(issue: Awaited<ReturnType<typeof lookupIssue>>): Promise<LinearIssueDetail> {
  const [base, team, commentsConn, childrenConn] = await Promise.all([
    toLinearIssue(issue),
    issue.team,
    issue.comments({ first: 20 }),
    issue.children(),
  ]);

  const comments = await Promise.all(
    commentsConn.nodes.map(async c => {
      const user = await c.user;
      return {
        author: user?.name ?? 'unknown',
        body: c.body ?? '',
        createdAt: c.createdAt?.toISOString() ?? '',
      };
    }),
  );

  const children = await Promise.all(
    childrenConn.nodes.map(async c => {
      const [childState, childAssignee] = await Promise.all([c.state, c.assignee]);
      return {
        identifier: c.identifier,
        title: c.title,
        status: childState?.name ?? 'Unknown',
        assignee: childAssignee?.name ?? null,
      };
    }),
  );

  return {
    ...base,
    teamId: team?.id ?? '',
    teamKey: team?.key ?? '',
    createdAt: issue.createdAt?.toISOString() ?? '',
    updatedAt: issue.updatedAt?.toISOString() ?? '',
    comments,
    children,
  };
}

/**
 * Find a workflow state ID by type (e.g. "started", "completed") from a list of states.
 * Returns the state with the lowest position (earliest in the workflow).
 */
function findStateId(
  states: Array<{ id: string; type: string; position?: number }>,
  targetType: string,
): string | null {
  const matching = states.filter(s => s.type === targetType);
  if (matching.length === 0) return null;
  matching.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  return matching[0].id;
}

/**
 * Find a workflow state ID by name (case-insensitive substring match).
 */
function findStateIdByName(
  states: Array<{ id: string; name: string }>,
  targetName: string,
): string | null {
  const lower = targetName.toLowerCase();
  const state = states.find(s => s.name.toLowerCase().includes(lower));
  return state?.id ?? null;
}

/**
 * After an issue mutation, fetch the updated issue and build a LinearWriteResult.
 */
async function buildWriteResult(issueId: string): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const updated = await client.issue(issueId);
    const [state, assignee] = await Promise.all([updated.state, updated.assignee]);
    return {
      success: true,
      issue: {
        id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        status: state?.name ?? 'unknown',
        assignee: assignee?.name ?? null,
      },
    };
  } catch {
    // If we can't fetch the updated issue details, still report success
    return { success: true, issue: null };
  }
}

// ---------------------------------------------------------------------------
// Public API -- Read operations
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!process.env.SWARMCODE_LINEAR_API_KEY;
}

/** Get the authenticated user. */
export async function getViewer(): Promise<LinearUser> {
  const client = getClient();
  const viewer = await client.viewer;
  return { id: viewer.id, name: viewer.name, email: viewer.email, active: viewer.active };
}

/** List teams in the workspace. */
export async function getTeams(): Promise<LinearTeam[]> {
  const client = getClient();
  const teamsConn = await client.teams();
  return teamsConn.nodes.map(t => ({ id: t.id, name: t.name, key: t.key }));
}

/** List users in the workspace. */
export async function getUsers(): Promise<LinearUser[]> {
  const client = getClient();
  const usersConn = await client.users();
  return usersConn.nodes.map(u => ({
    id: u.id, name: u.name, email: u.email, active: u.active,
  }));
}

/** Get workflow states for a team. */
export async function getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
  const client = getClient();
  const team = await client.team(teamId);
  const statesConn = await team.states();
  return statesConn.nodes
    .map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position }))
    .sort((a, b) => a.position - b.position);
}

/** Get cycles for a team (returns active cycle + recent cycles). */
export async function getCycles(teamId: string): Promise<{ active: LinearCycle | null; recent: LinearCycle[] }> {
  const client = getClient();
  const team = await client.team(teamId);

  function parseCycle(c: { id: string; name?: string | null; number: number; startsAt: Date; endsAt: Date; completedIssueCountHistory: number[]; issueCountHistory: number[] }): LinearCycle {
    return {
      id: c.id,
      name: c.name ?? null,
      number: c.number ?? 0,
      startsAt: c.startsAt?.toISOString() ?? null,
      endsAt: c.endsAt?.toISOString() ?? null,
      issueCount: c.issueCountHistory?.length > 0 ? c.issueCountHistory[c.issueCountHistory.length - 1] : 0,
      completedIssueCount: c.completedIssueCountHistory?.length > 0 ? c.completedIssueCountHistory[c.completedIssueCountHistory.length - 1] : 0,
    };
  }

  const activeCycleObj = await team.activeCycle;
  const activeCycle = activeCycleObj ? parseCycle(activeCycleObj) : null;

  const cyclesConn = await team.cycles({ first: 5, orderBy: 'createdAt' as never });
  const recent = cyclesConn.nodes.map(parseCycle);

  return { active: activeCycle, recent };
}

/** Fetch active issues (used by dashboard). */
export async function getLinearData(overrideTeamKey?: string): Promise<LinearData | null> {
  if (!process.env.SWARMCODE_LINEAR_API_KEY) return null;

  const client = getClient();
  const teamKey = overrideTeamKey ?? process.env.SWARMCODE_LINEAR_TEAM ?? null;

  // Build filter for all open issues (exclude completed/cancelled)
  const filter: Record<string, unknown> = {
    state: { type: { in: ['triage', 'backlog', 'unstarted', 'started'] } },
  };
  if (teamKey) {
    filter.team = { key: { eq: teamKey } };
  }

  const issuesConn = await client.issues({
    filter: filter as never,
    first: 50,
    orderBy: 'updatedAt' as never,
  });

  const issues = await Promise.all(issuesConn.nodes.map(toLinearIssue));

  // Fetch active cycle if team is specified
  let cycle: LinearCycle | null = null;
  if (teamKey) {
    try {
      const teams = await getTeams();
      const team = teams.find(t => t.key === teamKey);
      if (team) {
        const cycles = await getCycles(team.id);
        cycle = cycles.active;
      }
    } catch {
      // Cycle fetch is optional
    }
  }

  return { issues, cycle, team: teamKey };
}

/** Search issues by text query. */
export async function searchIssues(query: string, limit: number = 20): Promise<LinearIssue[]> {
  const client = getClient();
  const results = await client.searchIssues(query, { first: limit });
  // Re-fetch full Issue objects since IssueSearchResult lacks relational methods
  const fullIssues = await Promise.all(results.nodes.map(n => client.issue(n.id)));
  return Promise.all(fullIssues.map(toLinearIssue));
}

/** Get full details on a specific issue by identifier. */
export async function getIssue(identifier: string): Promise<LinearIssueDetail> {
  const issue = await lookupIssue(identifier);
  return toLinearIssueDetail(issue);
}

// ---------------------------------------------------------------------------
// Public API -- Write operations
// ---------------------------------------------------------------------------

/** Start working on an issue: assign to current user + move to In Progress. */
export async function startIssue(identifier: string): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const viewer = await client.viewer;

    const team = await issue.team;
    if (!team) return { success: false, issue: null, error: 'Could not resolve team for issue' };
    const statesConn = await team.states();
    const states = statesConn.nodes.map(s => ({ id: s.id, type: s.type, position: s.position }));

    const startedStateId = findStateId(states, 'started');
    const input: Record<string, string> = { assigneeId: viewer.id };
    if (startedStateId) input.stateId = startedStateId;

    await client.updateIssue(issue.id, input);
    return buildWriteResult(issue.id);
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Mark an issue as complete. */
export async function completeIssue(identifier: string): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);

    const team = await issue.team;
    if (!team) return { success: false, issue: null, error: 'Could not resolve team for issue' };
    const statesConn = await team.states();
    const states = statesConn.nodes.map(s => ({ id: s.id, type: s.type, position: s.position }));

    const completedStateId = findStateId(states, 'completed');
    if (!completedStateId) {
      return { success: false, issue: null, error: 'No "completed" state found for this team' };
    }

    await client.updateIssue(issue.id, { stateId: completedStateId });
    return buildWriteResult(issue.id);
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Move an issue to "In Review" state. */
export async function reviewIssue(identifier: string): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);

    const team = await issue.team;
    if (!team) return { success: false, issue: null, error: 'Could not resolve team for issue' };
    const statesConn = await team.states();
    const states = statesConn.nodes.map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position }));

    const reviewStateId = findStateIdByName(states, 'review');
    if (!reviewStateId) {
      return { success: false, issue: null, error: 'No "In Review" state found for this team' };
    }

    await client.updateIssue(issue.id, { stateId: reviewStateId });
    return buildWriteResult(issue.id);
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Move an issue to a status by type. */
export async function updateIssueStatus(identifier: string, statusType: string): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);

    const team = await issue.team;
    if (!team) return { success: false, issue: null, error: 'Could not resolve team for issue' };
    const statesConn = await team.states();
    const states = statesConn.nodes.map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position }));

    const stateId = findStateId(states, statusType);
    if (!stateId) {
      const available = states.map(s => `${s.name} (${s.type})`).join(', ');
      return { success: false, issue: null, error: `No "${statusType}" state found. Available: ${available}` };
    }

    await client.updateIssue(issue.id, { stateId });
    return buildWriteResult(issue.id);
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Update an issue's fields (title, description, priority, assignee, etc). */
export async function updateIssue(
  identifier: string,
  fields: {
    title?: string;
    description?: string;
    priority?: number;
    assigneeId?: string;
    stateId?: string;
    dueDate?: string;
    estimate?: number;
  },
): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    await client.updateIssue(issue.id, fields);
    return buildWriteResult(issue.id);
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Create a new issue. */
export async function createIssue(fields: {
  title: string;
  teamId: string;
  description?: string;
  priority?: number;
  assigneeId?: string;
  stateId?: string;
  parentId?: string;
  dueDate?: string;
  estimate?: number;
}): Promise<LinearWriteResult> {
  try {
    const client = getClient();
    const payload = await client.createIssue(fields);
    if (!payload.success) {
      return { success: false, issue: null, error: 'Issue creation failed' };
    }
    const created = await payload.issue;
    if (!created) {
      return { success: true, issue: null };
    }
    const [state, assignee] = await Promise.all([created.state, created.assignee]);
    return {
      success: true,
      issue: {
        id: created.id,
        identifier: created.identifier,
        title: created.title,
        status: state?.name ?? 'unknown',
        assignee: assignee?.name ?? null,
      },
    };
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Create a sub-issue under a parent. */
export async function createSubIssue(
  parentIdentifier: string,
  fields: {
    title: string;
    description?: string;
    priority?: number;
    assigneeId?: string;
  },
): Promise<LinearWriteResult> {
  try {
    const parent = await lookupIssue(parentIdentifier);
    const team = await parent.team;
    if (!team) return { success: false, issue: null, error: 'Could not resolve team for parent issue' };
    return createIssue({
      ...fields,
      teamId: team.id,
      parentId: parent.id,
    });
  } catch (err: unknown) {
    return { success: false, issue: null, error: (err as Error).message };
  }
}

/** Add a comment to an issue. */
export async function commentOnIssue(identifier: string, body: string): Promise<LinearCommentResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const payload = await client.createComment({ issueId: issue.id, body });
    return {
      success: payload.success,
      commentId: payload.commentId ?? null,
    };
  } catch (err: unknown) {
    return { success: false, commentId: null, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Public API -- Projects
// ---------------------------------------------------------------------------

/** List projects. */
export async function getProjects(limit: number = 25): Promise<LinearProject[]> {
  const client = getClient();
  const projectsConn = await client.projects({
    first: limit,
    orderBy: 'updatedAt' as never,
  });
  return Promise.all(
    projectsConn.nodes.map(async p => {
      const [lead, teamsConn] = await Promise.all([p.lead, p.teams()]);
      return {
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        state: p.state ?? 'planned',
        url: p.url ?? '',
        progress: p.progress ?? 0,
        targetDate: p.targetDate ?? null,
        startDate: p.startDate ?? null,
        lead: lead?.name ?? null,
        teamIds: teamsConn.nodes.map(t => t.id),
      };
    }),
  );
}

/** Get issues in a project. */
export async function getProjectIssues(projectId: string, limit: number = 50): Promise<LinearIssue[]> {
  const client = getClient();
  const project = await client.project(projectId);
  const issuesConn = await project.issues({ first: limit });
  return Promise.all(issuesConn.nodes.map(toLinearIssue));
}

/** Create a project. */
export async function createProject(fields: {
  name: string;
  teamIds: string[];
  description?: string;
  state?: string;
  targetDate?: string;
}): Promise<{ success: boolean; project: { id: string; name: string; state: string; url: string } | null; error?: string }> {
  try {
    const client = getClient();
    const payload = await client.createProject(fields);
    if (!payload.success) {
      return { success: false, project: null, error: 'Project creation failed' };
    }
    const p = await payload.project;
    if (!p) return { success: true, project: null };
    return {
      success: true,
      project: { id: p.id, name: p.name, state: p.state, url: p.url },
    };
  } catch (err: unknown) {
    return { success: false, project: null, error: (err as Error).message };
  }
}

/** Update a project. */
export async function updateProject(
  projectId: string,
  fields: { name?: string; description?: string; state?: string; targetDate?: string },
): Promise<{ success: boolean; project: { id: string; name: string; state: string; url: string } | null; error?: string }> {
  try {
    const client = getClient();
    const payload = await client.updateProject(projectId, fields);
    if (!payload.success) {
      return { success: false, project: null, error: 'Project update failed' };
    }
    const p = await payload.project;
    if (!p) return { success: true, project: null };
    return {
      success: true,
      project: { id: p.id, name: p.name, state: p.state, url: p.url },
    };
  } catch (err: unknown) {
    return { success: false, project: null, error: (err as Error).message };
  }
}

/** Add an issue to a project. */
export async function addIssueToProject(identifier: string, projectId: string): Promise<GenericResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const payload = await client.updateIssue(issue.id, { projectId });
    return { success: payload.success };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Public API -- Project Updates
// ---------------------------------------------------------------------------

/** Get project updates (status reports with health). */
export async function getProjectUpdates(projectId: string, limit: number = 10): Promise<LinearProjectUpdate[]> {
  const client = getClient();
  const project = await client.project(projectId);
  const updatesConn = await project.projectUpdates({ first: limit });
  return Promise.all(
    updatesConn.nodes.map(async u => {
      const user = await u.user;
      return {
        id: u.id,
        body: u.body ?? '',
        health: u.health ?? 'onTrack',
        createdAt: u.createdAt?.toISOString() ?? '',
        user: user?.name ?? 'unknown',
      };
    }),
  );
}

/** Create a project update (status report). */
export async function createProjectUpdate(
  projectId: string,
  body: string,
  health: string = 'onTrack',
): Promise<{ success: boolean; updateId: string | null; error?: string }> {
  try {
    const client = getClient();
    const payload = await client.createProjectUpdate({
      projectId,
      body,
      health: health as never,
    });
    return {
      success: payload.success,
      updateId: payload.projectUpdateId ?? null,
    };
  } catch (err: unknown) {
    return { success: false, updateId: null, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Public API -- Issue extras
// ---------------------------------------------------------------------------

/** Add an issue to a cycle. */
export async function addIssueToCycle(identifier: string, cycleId: string): Promise<GenericResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const payload = await client.updateIssue(issue.id, { cycleId });
    return { success: payload.success };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

/** Archive an issue. */
export async function archiveIssue(identifier: string): Promise<GenericResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const payload = await client.archiveIssue(issue.id);
    return { success: payload.success };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

/** Create a relation between two issues. */
export async function createIssueRelation(
  identifier: string,
  relatedIdentifier: string,
  type: string,
): Promise<{ success: boolean; relation: LinearIssueRelation | null; error?: string }> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const related = await lookupIssue(relatedIdentifier);
    const payload = await client.createIssueRelation({
      issueId: issue.id,
      relatedIssueId: related.id,
      type: type as never,
    });
    if (!payload.success) {
      return { success: false, relation: null, error: 'Relation creation failed' };
    }
    const rel = await payload.issueRelation;
    if (!rel) return { success: true, relation: null };

    const relatedIssue = await rel.relatedIssue;
    const relatedState = relatedIssue ? await relatedIssue.state : null;
    return {
      success: true,
      relation: {
        id: rel.id,
        type: rel.type,
        relatedIssue: {
          identifier: relatedIssue?.identifier ?? '',
          title: relatedIssue?.title ?? '',
          status: relatedState?.name ?? '',
        },
      },
    };
  } catch (err: unknown) {
    return { success: false, relation: null, error: (err as Error).message };
  }
}

/** Get relations for an issue. */
export async function getIssueRelations(identifier: string): Promise<LinearIssueRelation[]> {
  const issue = await lookupIssue(identifier);
  const [relationsConn, inverseRelationsConn] = await Promise.all([
    issue.relations(),
    issue.inverseRelations(),
  ]);

  const relations: LinearIssueRelation[] = [];

  for (const r of relationsConn.nodes) {
    const relatedIssue = await r.relatedIssue;
    const relatedState = relatedIssue ? await relatedIssue.state : null;
    relations.push({
      id: r.id,
      type: r.type,
      relatedIssue: {
        identifier: relatedIssue?.identifier ?? '',
        title: relatedIssue?.title ?? '',
        status: relatedState?.name ?? '',
      },
    });
  }

  for (const r of inverseRelationsConn.nodes) {
    const relatedIssue = await r.issue;
    const relatedState = relatedIssue ? await relatedIssue.state : null;
    relations.push({
      id: r.id,
      type: `inverse_${r.type}`,
      relatedIssue: {
        identifier: relatedIssue?.identifier ?? '',
        title: relatedIssue?.title ?? '',
        status: relatedState?.name ?? '',
      },
    });
  }

  return relations;
}

/** Get change history for an issue. */
export async function getIssueHistory(identifier: string, limit: number = 20): Promise<LinearHistoryEntry[]> {
  const issue = await lookupIssue(identifier);
  const historyConn = await issue.history({ first: limit });

  return Promise.all(
    historyConn.nodes.map(async h => {
      const [fromState, toState, actor] = await Promise.all([
        h.fromState,
        h.toState,
        h.actor,
      ]);
      return {
        id: h.id,
        createdAt: h.createdAt?.toISOString() ?? '',
        fromState: fromState?.name ?? null,
        toState: toState?.name ?? null,
        actor: actor?.name ?? null,
        updatedDescription: h.updatedDescription != null ? String(h.updatedDescription) : null,
      };
    }),
  );
}

/** Get all labels in the workspace. */
export async function getLabels(): Promise<LinearLabel[]> {
  const client = getClient();
  const labelsConn = await client.issueLabels();
  return labelsConn.nodes.map(l => ({
    id: l.id,
    name: l.name,
    color: l.color ?? '',
  }));
}

/** Add a label to an issue. */
export async function addIssueLabel(identifier: string, labelId: string): Promise<GenericResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const labelsConn = await issue.labels();
    const currentLabelIds = labelsConn.nodes.map(l => l.id);

    if (currentLabelIds.includes(labelId)) return { success: true }; // already has it

    const payload = await client.updateIssue(issue.id, {
      labelIds: [...currentLabelIds, labelId],
    });
    return { success: payload.success };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

/** Remove a label from an issue. */
export async function removeIssueLabel(identifier: string, labelId: string): Promise<GenericResult> {
  try {
    const client = getClient();
    const issue = await lookupIssue(identifier);
    const labelsConn = await issue.labels();
    const currentLabelIds = labelsConn.nodes.map(l => l.id);
    const newLabelIds = currentLabelIds.filter(id => id !== labelId);

    const payload = await client.updateIssue(issue.id, {
      labelIds: newLabelIds,
    });
    return { success: payload.success };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Formatting (for dashboard & project context)
// ---------------------------------------------------------------------------

export function formatAsMarkdown(data: LinearData): string {
  const lines: string[] = ['# Linear -- Active Issues'];

  if (data.cycle) {
    const end = data.cycle.endsAt
      ? new Date(data.cycle.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    lines.push(`\nCycle: ${data.cycle.name ?? 'Current'}${end ? ` (ends ${end})` : ''}`);
  }

  if (data.team) {
    lines.push(`Team: ${data.team}`);
  }

  lines.push('');

  const inProgress = data.issues.filter(i => i.statusType === 'started');
  const todo = data.issues.filter(i => i.statusType === 'unstarted');

  if (inProgress.length > 0) {
    lines.push('## In Progress');
    for (const issue of inProgress) {
      const assignee = issue.assignee ? ` (${issue.assignee})` : '';
      lines.push(`- **${issue.identifier}** ${issue.title}${assignee}`);
    }
    lines.push('');
  }

  if (todo.length > 0) {
    lines.push('## Todo');
    for (const issue of todo) {
      const assignee = issue.assignee ? ` (${issue.assignee})` : '';
      lines.push(`- **${issue.identifier}** ${issue.title}${assignee}`);
    }
    lines.push('');
  }

  if (data.issues.length === 0) {
    lines.push('No active issues found.');
  }

  return lines.join('\n');
}
