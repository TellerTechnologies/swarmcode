/**
 * Linear integration. Full issue lifecycle management via the GraphQL API.
 *
 * Env vars:
 *   SWARMCODE_LINEAR_API_KEY  — Linear personal API key (required, skip if unset)
 *   SWARMCODE_LINEAR_TEAM     — Team key to filter by, e.g. "ENG" (optional, fetches all teams if unset)
 */

const LINEAR_API = 'https://api.linear.app/graphql';

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
// GraphQL queries & mutations
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id identifier title url priority branchName description dueDate estimate
  assignee { id name }
  state { name type }
  labels { nodes { name } }
  parent { id }
`;

const ISSUE_DETAIL_FIELDS = `
  id identifier title url priority branchName description dueDate estimate
  createdAt updatedAt
  assignee { id name }
  state { name type }
  labels { nodes { name } }
  parent { id }
  team { id key }
  comments(first: 20) {
    nodes { body createdAt user { name } }
  }
  children {
    nodes { identifier title state { name } assignee { name } }
  }
`;

const ACTIVE_ISSUES_QUERY = `
  query ActiveIssues($teamKey: String, $limit: Int!) {
    issues(
      filter: {
        state: { type: { in: ["started", "unstarted"] } }
        team: { key: { eq: $teamKey } }
      }
      first: $limit
      orderBy: updatedAt
    ) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

const ACTIVE_ISSUES_ALL_TEAMS_QUERY = `
  query ActiveIssues($limit: Int!) {
    issues(
      filter: {
        state: { type: { in: ["started", "unstarted"] } }
      }
      first: $limit
      orderBy: updatedAt
    ) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

const SEARCH_ISSUES_QUERY = `
  query SearchIssues($query: String!, $limit: Int!) {
    issueSearch(query: $query, first: $limit) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query GetIssue($identifier: String!) {
    issueSearch(query: $identifier, first: 1) {
      nodes { ${ISSUE_DETAIL_FIELDS} }
    }
  }
`;

const ISSUE_WITH_TEAM_STATES_QUERY = `
  query IssueLookup($identifier: String!) {
    issueSearch(query: $identifier, first: 1) {
      nodes {
        id identifier title
        state { name type }
        assignee { id name }
        team { id key states { nodes { id name type } } }
      }
    }
  }
`;

const CREATE_ISSUE_MUTATION = `
  mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id identifier title
        state { name }
        assignee { name }
      }
    }
  }
`;

const CREATE_COMMENT_MUTATION = `
  mutation CreateComment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment { id }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer { id name email }
  }
`;

const TEAMS_QUERY = `
  query Teams {
    teams {
      nodes { id name key }
    }
  }
`;

const USERS_QUERY = `
  query Users {
    users {
      nodes { id name email active }
    }
  }
`;

const WORKFLOW_STATES_QUERY = `
  query WorkflowStates($teamId: String!) {
    team(id: $teamId) {
      states {
        nodes { id name type position }
      }
    }
  }
`;

const CYCLES_QUERY = `
  query Cycles($teamId: String!) {
    team(id: $teamId) {
      cycles(first: 5, orderBy: createdAt) {
        nodes {
          id name number startsAt endsAt
          issues { nodes { id } }
          completedScopeHistory
        }
      }
      activeCycle {
        id name number startsAt endsAt
        issues { nodes { id } }
        completedScopeHistory
      }
    }
  }
`;

// --- Projects ---

const PROJECTS_QUERY = `
  query Projects($limit: Int!) {
    projects(first: $limit, orderBy: updatedAt) {
      nodes {
        id name description state url progress targetDate startDate
        lead { name }
        teams { nodes { id } }
      }
    }
  }
`;

const PROJECT_ISSUES_QUERY = `
  query ProjectIssues($projectId: String!, $limit: Int!) {
    project(id: $projectId) {
      issues(first: $limit) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  }
`;

const CREATE_PROJECT_MUTATION = `
  mutation CreateProject($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project { id name state url }
    }
  }
`;

const UPDATE_PROJECT_MUTATION = `
  mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
      success
      project { id name state url }
    }
  }
`;

const ADD_ISSUE_TO_PROJECT_MUTATION = `
  mutation AddIssueToProject($issueId: String!, $projectId: String!) {
    issueUpdate(id: $issueId, input: { projectId: $projectId }) {
      success
    }
  }
`;

// --- Project Updates ---

const PROJECT_UPDATES_QUERY = `
  query ProjectUpdates($projectId: String!, $limit: Int!) {
    project(id: $projectId) {
      projectUpdates(first: $limit) {
        nodes {
          id body health createdAt
          user { name }
        }
      }
    }
  }
`;

const CREATE_PROJECT_UPDATE_MUTATION = `
  mutation CreateProjectUpdate($projectId: String!, $body: String!, $health: ProjectUpdateHealthType!) {
    projectUpdateCreate(input: { projectId: $projectId, body: $body, health: $health }) {
      success
      projectUpdate { id }
    }
  }
`;

// --- Issue extras ---

const ADD_ISSUE_TO_CYCLE_MUTATION = `
  mutation AddIssueToCycle($issueId: String!, $cycleId: String!) {
    issueUpdate(id: $issueId, input: { cycleId: $cycleId }) {
      success
    }
  }
`;

const ARCHIVE_ISSUE_MUTATION = `
  mutation ArchiveIssue($issueId: String!) {
    issueArchive(id: $issueId) {
      success
    }
  }
`;

const CREATE_ISSUE_RELATION_MUTATION = `
  mutation CreateIssueRelation($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
    issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type }) {
      success
      issueRelation { id type relatedIssue { identifier title state { name } } }
    }
  }
`;

const ISSUE_RELATIONS_QUERY = `
  query IssueRelations($identifier: String!) {
    issueSearch(query: $identifier, first: 1) {
      nodes {
        relations {
          nodes {
            id type
            relatedIssue { identifier title state { name } }
          }
        }
        inverseRelations {
          nodes {
            id type
            issue { identifier title state { name } }
          }
        }
      }
    }
  }
`;

const ISSUE_HISTORY_QUERY = `
  query IssueHistory($identifier: String!, $limit: Int!) {
    issueSearch(query: $identifier, first: 1) {
      nodes {
        history(first: $limit) {
          nodes {
            id createdAt
            fromState { name }
            toState { name }
            actor { name }
            updatedDescription
          }
        }
      }
    }
  }
`;

const LABELS_QUERY = `
  query Labels {
    issueLabels {
      nodes { id name color }
    }
  }
`;

const ADD_LABEL_MUTATION = `
  mutation AddLabel($issueId: String!, $labelIds: [String!]!) {
    issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
      success
    }
  }
`;

const ISSUE_LABELS_QUERY = `
  query IssueLabels($identifier: String!) {
    issueSearch(query: $identifier, first: 1) {
      nodes {
        id
        labels { nodes { id name } }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

async function gql(apiKey: string, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`Linear GraphQL error: ${json.errors[0]?.message ?? 'unknown'}`);
  }

  return json.data;
}

function requireApiKey(): string {
  const key = process.env.SWARMCODE_LINEAR_API_KEY;
  if (!key) throw new Error('SWARMCODE_LINEAR_API_KEY is not set');
  return key;
}

function parseIssue(n: any): LinearIssue {
  return {
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    description: n.description ?? null,
    assignee: n.assignee?.name ?? null,
    assigneeId: n.assignee?.id ?? null,
    status: n.state?.name ?? 'Unknown',
    statusType: n.state?.type ?? 'unstarted',
    priority: n.priority ?? 0,
    branchName: n.branchName ?? '',
    url: n.url ?? '',
    labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
    dueDate: n.dueDate ?? null,
    estimate: n.estimate ?? null,
    parentId: n.parent?.id ?? null,
  };
}

function parseIssueDetail(n: any): LinearIssueDetail {
  return {
    ...parseIssue(n),
    teamId: n.team?.id ?? '',
    teamKey: n.team?.key ?? '',
    createdAt: n.createdAt ?? '',
    updatedAt: n.updatedAt ?? '',
    comments: (n.comments?.nodes ?? []).map((c: any) => ({
      author: c.user?.name ?? 'unknown',
      body: c.body ?? '',
      createdAt: c.createdAt ?? '',
    })),
    children: (n.children?.nodes ?? []).map((c: any) => ({
      identifier: c.identifier,
      title: c.title,
      status: c.state?.name ?? 'Unknown',
      assignee: c.assignee?.name ?? null,
    })),
  };
}

async function lookupIssue(apiKey: string, identifier: string): Promise<any> {
  const data = await gql(apiKey, ISSUE_WITH_TEAM_STATES_QUERY, { identifier });
  const node = data.issueSearch?.nodes?.[0];
  if (!node) throw new Error(`Issue "${identifier}" not found in Linear`);
  return node;
}

function findStateId(teamStates: any[], targetType: string): string | null {
  const state = teamStates.find((s: any) => s.type === targetType);
  return state?.id ?? null;
}

function makeWriteResult(gqlResult: any): LinearWriteResult {
  const updated = gqlResult.issueUpdate?.issue ?? gqlResult.issueCreate?.issue;
  return {
    success: gqlResult.issueUpdate?.success ?? gqlResult.issueCreate?.success ?? false,
    issue: updated ? {
      id: updated.id,
      identifier: updated.identifier,
      title: updated.title,
      status: updated.state?.name ?? 'unknown',
      assignee: updated.assignee?.name ?? null,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Public API — Read operations
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!process.env.SWARMCODE_LINEAR_API_KEY;
}

/** Get the authenticated user. */
export async function getViewer(): Promise<LinearUser> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, VIEWER_QUERY);
  return { id: data.viewer.id, name: data.viewer.name, email: data.viewer.email, active: true };
}

/** List teams in the workspace. */
export async function getTeams(): Promise<LinearTeam[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, TEAMS_QUERY);
  return (data.teams?.nodes ?? []).map((t: any) => ({
    id: t.id, name: t.name, key: t.key,
  }));
}

/** List users in the workspace. */
export async function getUsers(): Promise<LinearUser[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, USERS_QUERY);
  return (data.users?.nodes ?? []).map((u: any) => ({
    id: u.id, name: u.name, email: u.email, active: u.active,
  }));
}

/** Get workflow states for a team. */
export async function getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, WORKFLOW_STATES_QUERY, { teamId });
  return (data.team?.states?.nodes ?? []).map((s: any) => ({
    id: s.id, name: s.name, type: s.type, position: s.position,
  })).sort((a: LinearWorkflowState, b: LinearWorkflowState) => a.position - b.position);
}

/** Get cycles for a team (returns active cycle + recent cycles). */
export async function getCycles(teamId: string): Promise<{ active: LinearCycle | null; recent: LinearCycle[] }> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, CYCLES_QUERY, { teamId });

  function parseCycle(c: any): LinearCycle {
    return {
      id: c.id,
      name: c.name ?? null,
      number: c.number ?? 0,
      startsAt: c.startsAt ?? null,
      endsAt: c.endsAt ?? null,
      issueCount: c.issues?.nodes?.length ?? 0,
      completedIssueCount: Array.isArray(c.completedScopeHistory) ? c.completedScopeHistory.length : 0,
    };
  }

  const activeCycle = data.team?.activeCycle ? parseCycle(data.team.activeCycle) : null;
  const recent = (data.team?.cycles?.nodes ?? []).map(parseCycle);

  return { active: activeCycle, recent };
}

/** Fetch active issues (used by dashboard). */
export async function getLinearData(): Promise<LinearData | null> {
  const apiKey = process.env.SWARMCODE_LINEAR_API_KEY;
  if (!apiKey) return null;

  const teamKey = process.env.SWARMCODE_LINEAR_TEAM || null;

  let issuesData: any;
  if (teamKey) {
    issuesData = await gql(apiKey, ACTIVE_ISSUES_QUERY, { teamKey, limit: 50 });
  } else {
    issuesData = await gql(apiKey, ACTIVE_ISSUES_ALL_TEAMS_QUERY, { limit: 50 });
  }

  const issues = (issuesData.issues?.nodes ?? []).map(parseIssue);

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
  const apiKey = requireApiKey();
  const data = await gql(apiKey, SEARCH_ISSUES_QUERY, { query, limit });
  return (data.issueSearch?.nodes ?? []).map(parseIssue);
}

/** Get full details on a specific issue by identifier. */
export async function getIssue(identifier: string): Promise<LinearIssueDetail> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, GET_ISSUE_QUERY, { identifier });
  const node = data.issueSearch?.nodes?.[0];
  if (!node) throw new Error(`Issue "${identifier}" not found`);
  return parseIssueDetail(node);
}

// ---------------------------------------------------------------------------
// Public API — Write operations
// ---------------------------------------------------------------------------

/** Start working on an issue: assign to current user + move to In Progress. */
export async function startIssue(identifier: string): Promise<LinearWriteResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);
    const viewer = await getViewer();

    const states = issue.team?.states?.nodes ?? [];
    const startedStateId = findStateId(states, 'started');

    const input: Record<string, string> = { assigneeId: viewer.id };
    if (startedStateId) input.stateId = startedStateId;

    const result = await gql(apiKey, UPDATE_ISSUE_MUTATION, { id: issue.id, input });
    return makeWriteResult(result);
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
  }
}

/** Mark an issue as complete. */
export async function completeIssue(identifier: string): Promise<LinearWriteResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);
    const states = issue.team?.states?.nodes ?? [];
    const completedStateId = findStateId(states, 'completed');
    if (!completedStateId) {
      return { success: false, issue: null, error: 'No "completed" state found for this team' };
    }

    const result = await gql(apiKey, UPDATE_ISSUE_MUTATION, {
      id: issue.id,
      input: { stateId: completedStateId },
    });
    return makeWriteResult(result);
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
  }
}

/** Move an issue to a status by type. */
export async function updateIssueStatus(identifier: string, statusType: string): Promise<LinearWriteResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);
    const states = issue.team?.states?.nodes ?? [];
    const stateId = findStateId(states, statusType);
    if (!stateId) {
      const available = states.map((s: any) => `${s.name} (${s.type})`).join(', ');
      return { success: false, issue: null, error: `No "${statusType}" state found. Available: ${available}` };
    }

    const result = await gql(apiKey, UPDATE_ISSUE_MUTATION, { id: issue.id, input: { stateId } });
    return makeWriteResult(result);
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
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
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);
    const result = await gql(apiKey, UPDATE_ISSUE_MUTATION, { id: issue.id, input: fields });
    return makeWriteResult(result);
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
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
  const apiKey = requireApiKey();

  try {
    const result = await gql(apiKey, CREATE_ISSUE_MUTATION, { input: fields });
    const created = result.issueCreate?.issue;
    return {
      success: result.issueCreate?.success ?? false,
      issue: created ? {
        id: created.id,
        identifier: created.identifier,
        title: created.title,
        status: created.state?.name ?? 'unknown',
        assignee: created.assignee?.name ?? null,
      } : null,
    };
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
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
  const apiKey = requireApiKey();

  try {
    const parent = await lookupIssue(apiKey, parentIdentifier);
    return createIssue({
      ...fields,
      teamId: parent.team.id,
      parentId: parent.id,
    });
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
  }
}

/** Add a comment to an issue. */
export async function commentOnIssue(identifier: string, body: string): Promise<LinearCommentResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);
    const result = await gql(apiKey, CREATE_COMMENT_MUTATION, { issueId: issue.id, body });
    return {
      success: result.commentCreate?.success ?? false,
      commentId: result.commentCreate?.comment?.id ?? null,
    };
  } catch (err: any) {
    return { success: false, commentId: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Public API — Projects
// ---------------------------------------------------------------------------

/** List projects. */
export async function getProjects(limit: number = 25): Promise<LinearProject[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, PROJECTS_QUERY, { limit });
  return (data.projects?.nodes ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    state: p.state ?? 'planned',
    url: p.url ?? '',
    progress: p.progress ?? 0,
    targetDate: p.targetDate ?? null,
    startDate: p.startDate ?? null,
    lead: p.lead?.name ?? null,
    teamIds: (p.teams?.nodes ?? []).map((t: any) => t.id),
  }));
}

/** Get issues in a project. */
export async function getProjectIssues(projectId: string, limit: number = 50): Promise<LinearIssue[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, PROJECT_ISSUES_QUERY, { projectId, limit });
  return (data.project?.issues?.nodes ?? []).map(parseIssue);
}

/** Create a project. */
export async function createProject(fields: {
  name: string;
  teamIds: string[];
  description?: string;
  state?: string;
  targetDate?: string;
}): Promise<{ success: boolean; project: { id: string; name: string; state: string; url: string } | null; error?: string }> {
  const apiKey = requireApiKey();
  try {
    const result = await gql(apiKey, CREATE_PROJECT_MUTATION, { input: fields });
    const p = result.projectCreate?.project;
    return {
      success: result.projectCreate?.success ?? false,
      project: p ? { id: p.id, name: p.name, state: p.state, url: p.url } : null,
    };
  } catch (err: any) {
    return { success: false, project: null, error: err.message };
  }
}

/** Update a project. */
export async function updateProject(
  projectId: string,
  fields: { name?: string; description?: string; state?: string; targetDate?: string },
): Promise<{ success: boolean; project: { id: string; name: string; state: string; url: string } | null; error?: string }> {
  const apiKey = requireApiKey();
  try {
    const result = await gql(apiKey, UPDATE_PROJECT_MUTATION, { id: projectId, input: fields });
    const p = result.projectUpdate?.project;
    return {
      success: result.projectUpdate?.success ?? false,
      project: p ? { id: p.id, name: p.name, state: p.state, url: p.url } : null,
    };
  } catch (err: any) {
    return { success: false, project: null, error: err.message };
  }
}

/** Add an issue to a project. */
export async function addIssueToProject(identifier: string, projectId: string): Promise<GenericResult> {
  const apiKey = requireApiKey();
  try {
    const issue = await lookupIssue(apiKey, identifier);
    const result = await gql(apiKey, ADD_ISSUE_TO_PROJECT_MUTATION, { issueId: issue.id, projectId });
    return { success: result.issueUpdate?.success ?? false };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Public API — Project Updates
// ---------------------------------------------------------------------------

/** Get project updates (status reports with health). */
export async function getProjectUpdates(projectId: string, limit: number = 10): Promise<LinearProjectUpdate[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, PROJECT_UPDATES_QUERY, { projectId, limit });
  return (data.project?.projectUpdates?.nodes ?? []).map((u: any) => ({
    id: u.id,
    body: u.body ?? '',
    health: u.health ?? 'onTrack',
    createdAt: u.createdAt ?? '',
    user: u.user?.name ?? 'unknown',
  }));
}

/** Create a project update (status report). */
export async function createProjectUpdate(
  projectId: string,
  body: string,
  health: string = 'onTrack',
): Promise<{ success: boolean; updateId: string | null; error?: string }> {
  const apiKey = requireApiKey();
  try {
    const result = await gql(apiKey, CREATE_PROJECT_UPDATE_MUTATION, { projectId, body, health });
    return {
      success: result.projectUpdateCreate?.success ?? false,
      updateId: result.projectUpdateCreate?.projectUpdate?.id ?? null,
    };
  } catch (err: any) {
    return { success: false, updateId: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Public API — Issue extras
// ---------------------------------------------------------------------------

/** Add an issue to a cycle. */
export async function addIssueToCycle(identifier: string, cycleId: string): Promise<GenericResult> {
  const apiKey = requireApiKey();
  try {
    const issue = await lookupIssue(apiKey, identifier);
    const result = await gql(apiKey, ADD_ISSUE_TO_CYCLE_MUTATION, { issueId: issue.id, cycleId });
    return { success: result.issueUpdate?.success ?? false };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Archive an issue. */
export async function archiveIssue(identifier: string): Promise<GenericResult> {
  const apiKey = requireApiKey();
  try {
    const issue = await lookupIssue(apiKey, identifier);
    const result = await gql(apiKey, ARCHIVE_ISSUE_MUTATION, { issueId: issue.id });
    return { success: result.issueArchive?.success ?? false };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Create a relation between two issues. */
export async function createIssueRelation(
  identifier: string,
  relatedIdentifier: string,
  type: string,
): Promise<{ success: boolean; relation: LinearIssueRelation | null; error?: string }> {
  const apiKey = requireApiKey();
  try {
    const issue = await lookupIssue(apiKey, identifier);
    const related = await lookupIssue(apiKey, relatedIdentifier);
    const result = await gql(apiKey, CREATE_ISSUE_RELATION_MUTATION, {
      issueId: issue.id,
      relatedIssueId: related.id,
      type,
    });
    const rel = result.issueRelationCreate?.issueRelation;
    return {
      success: result.issueRelationCreate?.success ?? false,
      relation: rel ? {
        id: rel.id,
        type: rel.type,
        relatedIssue: {
          identifier: rel.relatedIssue?.identifier ?? '',
          title: rel.relatedIssue?.title ?? '',
          status: rel.relatedIssue?.state?.name ?? '',
        },
      } : null,
    };
  } catch (err: any) {
    return { success: false, relation: null, error: err.message };
  }
}

/** Get relations for an issue. */
export async function getIssueRelations(identifier: string): Promise<LinearIssueRelation[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, ISSUE_RELATIONS_QUERY, { identifier });
  const node = data.issueSearch?.nodes?.[0];
  if (!node) return [];

  const relations: LinearIssueRelation[] = [];
  for (const r of (node.relations?.nodes ?? [])) {
    relations.push({
      id: r.id,
      type: r.type,
      relatedIssue: {
        identifier: r.relatedIssue?.identifier ?? '',
        title: r.relatedIssue?.title ?? '',
        status: r.relatedIssue?.state?.name ?? '',
      },
    });
  }
  for (const r of (node.inverseRelations?.nodes ?? [])) {
    relations.push({
      id: r.id,
      type: `inverse_${r.type}`,
      relatedIssue: {
        identifier: r.issue?.identifier ?? '',
        title: r.issue?.title ?? '',
        status: r.issue?.state?.name ?? '',
      },
    });
  }
  return relations;
}

/** Get change history for an issue. */
export async function getIssueHistory(identifier: string, limit: number = 20): Promise<LinearHistoryEntry[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, ISSUE_HISTORY_QUERY, { identifier, limit });
  const node = data.issueSearch?.nodes?.[0];
  if (!node) return [];
  return (node.history?.nodes ?? []).map((h: any) => ({
    id: h.id,
    createdAt: h.createdAt ?? '',
    fromState: h.fromState?.name ?? null,
    toState: h.toState?.name ?? null,
    actor: h.actor?.name ?? null,
    updatedDescription: h.updatedDescription ?? null,
  }));
}

/** Get all labels in the workspace. */
export async function getLabels(): Promise<LinearLabel[]> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, LABELS_QUERY);
  return (data.issueLabels?.nodes ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    color: l.color ?? '',
  }));
}

/** Add a label to an issue. */
export async function addIssueLabel(identifier: string, labelId: string): Promise<GenericResult> {
  const apiKey = requireApiKey();
  try {
    // Get current labels first so we don't overwrite them
    const labelData = await gql(apiKey, ISSUE_LABELS_QUERY, { identifier });
    const node = labelData.issueSearch?.nodes?.[0];
    if (!node) return { success: false, error: `Issue "${identifier}" not found` };

    const currentLabelIds = (node.labels?.nodes ?? []).map((l: any) => l.id);
    if (currentLabelIds.includes(labelId)) return { success: true }; // already has it

    const result = await gql(apiKey, ADD_LABEL_MUTATION, {
      issueId: node.id,
      labelIds: [...currentLabelIds, labelId],
    });
    return { success: result.issueUpdate?.success ?? false };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Remove a label from an issue. */
export async function removeIssueLabel(identifier: string, labelId: string): Promise<GenericResult> {
  const apiKey = requireApiKey();
  try {
    const labelData = await gql(apiKey, ISSUE_LABELS_QUERY, { identifier });
    const node = labelData.issueSearch?.nodes?.[0];
    if (!node) return { success: false, error: `Issue "${identifier}" not found` };

    const currentLabelIds = (node.labels?.nodes ?? []).map((l: any) => l.id);
    const newLabelIds = currentLabelIds.filter((id: string) => id !== labelId);

    const result = await gql(apiKey, ADD_LABEL_MUTATION, {
      issueId: node.id,
      labelIds: newLabelIds,
    });
    return { success: result.issueUpdate?.success ?? false };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Formatting (for dashboard & project context)
// ---------------------------------------------------------------------------

export function formatAsMarkdown(data: LinearData): string {
  const lines: string[] = ['# Linear — Active Issues'];

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
