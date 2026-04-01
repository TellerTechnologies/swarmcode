/**
 * Linear integration. Reads and writes issues via the GraphQL API.
 *
 * Env vars:
 *   SWARMCODE_LINEAR_API_KEY  — Linear personal API key (required, skip if unset)
 *   SWARMCODE_LINEAR_TEAM     — Team key to filter by, e.g. "ENG" (optional, fetches all teams if unset)
 */

const LINEAR_API = 'https://api.linear.app/graphql';

export interface LinearIssue {
  id: string;
  identifier: string;       // e.g. "ENG-42"
  title: string;
  assignee: string | null;
  status: string;            // e.g. "In Progress", "Todo"
  statusType: string;        // e.g. "started", "unstarted", "completed", "cancelled"
  priority: number;          // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  branchName: string;        // Linear's suggested branch name
  url: string;
}

export interface LinearCycle {
  name: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface LinearData {
  issues: LinearIssue[];
  cycle: LinearCycle | null;
  team: string | null;
}

const ISSUES_QUERY = `
  query ActiveIssues($teamKey: String, $limit: Int!) {
    issues(
      filter: {
        state: { type: { in: ["started", "unstarted"] } }
        team: { key: { eq: $teamKey } }
      }
      first: $limit
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        priority
        branchName
        assignee { name }
        state { name type }
      }
    }
  }
`;

const ISSUES_QUERY_ALL_TEAMS = `
  query ActiveIssues($limit: Int!) {
    issues(
      filter: {
        state: { type: { in: ["started", "unstarted"] } }
      }
      first: $limit
      orderBy: updatedAt
    ) {
      nodes {
        id
        identifier
        title
        url
        priority
        branchName
        assignee { name }
        state { name type }
      }
    }
  }
`;

const CYCLE_QUERY = `
  query ActiveCycle($teamKey: String!) {
    teams(filter: { key: { eq: $teamKey } }) {
      nodes {
        activeCycle {
          name
          startsAt
          endsAt
        }
      }
    }
  }
`;

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

/**
 * Returns true if a Linear API key is configured.
 */
export function isConfigured(): boolean {
  return !!process.env.SWARMCODE_LINEAR_API_KEY;
}

/**
 * Fetch active issues (and optionally the current cycle) from Linear.
 * Returns null if not configured. Throws on API errors.
 */
export async function getLinearData(): Promise<LinearData | null> {
  const apiKey = process.env.SWARMCODE_LINEAR_API_KEY;
  if (!apiKey) return null;

  const teamKey = process.env.SWARMCODE_LINEAR_TEAM || null;

  // Fetch issues
  let issuesData: any;
  if (teamKey) {
    issuesData = await gql(apiKey, ISSUES_QUERY, { teamKey, limit: 50 });
  } else {
    issuesData = await gql(apiKey, ISSUES_QUERY_ALL_TEAMS, { limit: 50 });
  }

  const issues: LinearIssue[] = (issuesData.issues?.nodes ?? []).map((n: any) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    assignee: n.assignee?.name ?? null,
    status: n.state?.name ?? 'Unknown',
    statusType: n.state?.type ?? 'unstarted',
    priority: n.priority ?? 0,
    branchName: n.branchName ?? '',
    url: n.url ?? '',
  }));

  // Fetch active cycle if team is specified
  let cycle: LinearCycle | null = null;
  if (teamKey) {
    try {
      const cycleData = await gql(apiKey, CYCLE_QUERY, { teamKey });
      const activeCycle = cycleData.teams?.nodes?.[0]?.activeCycle;
      if (activeCycle) {
        cycle = {
          name: activeCycle.name ?? null,
          startsAt: activeCycle.startsAt ?? null,
          endsAt: activeCycle.endsAt ?? null,
        };
      }
    } catch {
      // Cycle fetch is optional — ignore errors
    }
  }

  return { issues, cycle, team: teamKey };
}

/**
 * Format Linear data as markdown for inclusion in project context.
 */
// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export interface LinearWriteResult {
  success: boolean;
  issue: { id: string; identifier: string; title: string; status: string } | null;
  error?: string;
}

export interface LinearCommentResult {
  success: boolean;
  commentId: string | null;
  error?: string;
}

// Look up an issue by identifier (e.g. "ENG-42") — needed to resolve ID for mutations
const ISSUE_LOOKUP_QUERY = `
  query IssueLookup($identifier: String!) {
    issueSearch(query: $identifier, first: 1) {
      nodes {
        id
        identifier
        title
        state { name type }
        assignee { id name }
        team { id states { nodes { id name type } } }
      }
    }
  }
`;

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id
        identifier
        title
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
      comment {
        id
      }
    }
  }
`;

const VIEWER_QUERY = `
  query Viewer {
    viewer {
      id
      name
    }
  }
`;

function requireApiKey(): string {
  const key = process.env.SWARMCODE_LINEAR_API_KEY;
  if (!key) throw new Error('SWARMCODE_LINEAR_API_KEY is not set');
  return key;
}

async function lookupIssue(apiKey: string, identifier: string): Promise<any> {
  const data = await gql(apiKey, ISSUE_LOOKUP_QUERY, { identifier });
  const node = data.issueSearch?.nodes?.[0];
  if (!node) throw new Error(`Issue "${identifier}" not found in Linear`);
  return node;
}

function findStateId(teamStates: any[], targetType: string): string | null {
  const state = teamStates.find((s: any) => s.type === targetType);
  return state?.id ?? null;
}

/**
 * Get the current API user's Linear ID and name.
 */
export async function getViewer(): Promise<{ id: string; name: string }> {
  const apiKey = requireApiKey();
  const data = await gql(apiKey, VIEWER_QUERY);
  return { id: data.viewer.id, name: data.viewer.name };
}

/**
 * Start working on an issue: assign it to the current user and move to "In Progress".
 */
export async function startIssue(identifier: string): Promise<LinearWriteResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);
    const viewer = await getViewer();

    // Find the "started" state for this team
    const states = issue.team?.states?.nodes ?? [];
    const startedStateId = findStateId(states, 'started');

    const input: Record<string, string> = {};
    input.assigneeId = viewer.id;
    if (startedStateId) input.stateId = startedStateId;

    const result = await gql(apiKey, UPDATE_ISSUE_MUTATION, { id: issue.id, input });
    const updated = result.issueUpdate?.issue;

    return {
      success: result.issueUpdate?.success ?? false,
      issue: updated ? {
        id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        status: updated.state?.name ?? 'unknown',
      } : null,
    };
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
  }
}

/**
 * Mark an issue as complete (moves to "Done" status).
 */
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
    const updated = result.issueUpdate?.issue;

    return {
      success: result.issueUpdate?.success ?? false,
      issue: updated ? {
        id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        status: updated.state?.name ?? 'unknown',
      } : null,
    };
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
  }
}

/**
 * Update an issue's status by type ("unstarted", "started", "completed", "cancelled").
 */
export async function updateIssueStatus(
  identifier: string,
  statusType: string,
): Promise<LinearWriteResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);

    const states = issue.team?.states?.nodes ?? [];
    const stateId = findStateId(states, statusType);
    if (!stateId) {
      const available = states.map((s: any) => `${s.name} (${s.type})`).join(', ');
      return { success: false, issue: null, error: `No "${statusType}" state found. Available: ${available}` };
    }

    const result = await gql(apiKey, UPDATE_ISSUE_MUTATION, {
      id: issue.id,
      input: { stateId },
    });
    const updated = result.issueUpdate?.issue;

    return {
      success: result.issueUpdate?.success ?? false,
      issue: updated ? {
        id: updated.id,
        identifier: updated.identifier,
        title: updated.title,
        status: updated.state?.name ?? 'unknown',
      } : null,
    };
  } catch (err: any) {
    return { success: false, issue: null, error: err.message };
  }
}

/**
 * Add a comment to an issue.
 */
export async function commentOnIssue(
  identifier: string,
  body: string,
): Promise<LinearCommentResult> {
  const apiKey = requireApiKey();

  try {
    const issue = await lookupIssue(apiKey, identifier);

    const result = await gql(apiKey, CREATE_COMMENT_MUTATION, {
      issueId: issue.id,
      body,
    });

    return {
      success: result.commentCreate?.success ?? false,
      commentId: result.commentCreate?.comment?.id ?? null,
    };
  } catch (err: any) {
    return { success: false, commentId: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Formatting
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

  // Group by status type: in-progress first, then unstarted
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
