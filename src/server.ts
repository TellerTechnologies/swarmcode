import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VERSION } from './index.js';
import { getTeamActivity } from './tools/get-team-activity.js';
import { checkPath } from './tools/check-path.js';
import { searchTeamCode } from './tools/search-team-code.js';
import { checkConflicts } from './tools/check-conflicts.js';
import { getDeveloper } from './tools/get-developer.js';
import { enableAutoPush, disableAutoPush } from './tools/auto-push.js';
import { getProjectContext } from './tools/get-project-context.js';
import { checkAll } from './tools/check-all.js';
import { runSessionLinearChecks, autoProjectHealth } from './auto-linear.js';
import {
  isConfigured as linearConfigured,
  getLinearData,
  searchIssues,
  getIssue,
  getTeams as getLinearTeams,
  getUsers as getLinearUsers,
  getViewer,
  startIssue,
  completeIssue,
  createIssue,
  createSubIssue,
  commentOnIssue,
  getProjects,
  getProjectIssues,
  getProjectUpdates,
  createProjectUpdate,
  updateProject,
  addIssueToProject,
  updateIssue,
  archiveIssue,
  createIssueRelation,
  getIssueRelations,
  getLabels,
  addIssueLabel,
  removeIssueLabel,
} from './linear.js';

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error }, null, 2) }], isError: true as const };
}

async function tryLinear<T>(fn: () => Promise<T>) {
  try {
    return json(await fn());
  } catch (e: any) {
    return err(e.message);
  }
}

export function createServer(): McpServer {
  const hasLinear = linearConfigured();

  const instructions = [
    'You have access to team coordination tools. Use them:',
    '',
    '## Session Start',
    '- Call start_session immediately — it gives you team activity, project context, conflicts, and auto-push in one call',
    hasLinear ? '- Call linear_get_issues to see what work is available and assigned' : '',
    '',
    '## Before Writing Code',
    '- Before creating files in a new directory → call check_path',
    '- Before implementing a function that might exist → call search_code',
    '- Do not rebuild what a teammate has already built — import it',
    '',
    '## Working on a Ticket',
    hasLinear ? '- Call pick_issue to claim a ticket — it assigns to you, moves to In Progress, and returns the branch name to checkout' : '',
    hasLinear ? '- Create your branch using the returned branchName (e.g. feat/eng-123-auth-flow)' : '',
    hasLinear ? '- Git hooks auto-prepend the issue ID to commit messages and update Linear on first commit' : '',
    '',
    '## Committing',
    '- Commit early and often — after each logical unit of work (new function, bug fix, test added)',
    '- Small, frequent commits are pushed automatically and let teammates see your progress in real-time',
    '',
    '## Progress & Completion',
    hasLinear ? '- After meaningful milestones (NOT every commit) → call log_progress to record what was accomplished' : '',
    hasLinear ? '- When work is complete and merged → call complete_issue to mark it Done' : '',
    hasLinear ? '- If you discover a bug or needed task → call create_issue to track it' : '',
    '',
    hasLinear ? '- Do not work on issues that are already In Progress and assigned to someone else' : '',
  ].filter(Boolean).join('\n');

  const server = new McpServer(
    { name: 'swarmcode', version: VERSION },
    { instructions },
  );

  // =========================================================================
  // Session
  // =========================================================================

  server.registerTool(
    'start_session',
    {
      title: 'Start Session',
      description: 'Everything you need at session start in one call: team activity, project context, conflict check, auto-push, and Linear automation (auto-complete merged issues, branch validation, stale detection, project health). Call this first.',
      inputSchema: {
        since: z.string().default('24h').describe('How far back to look for team activity'),
      },
    },
    async ({ since }) => {
      try {
        const data = checkAll({ since });
        enableAutoPush({ interval: 30 });

        const result: Record<string, unknown> = {
          ...data,
          auto_push: 'enabled',
        };

        // Run Linear automations if configured
        if (hasLinear) {
          try {
            const [linearContext, projectActions] = await Promise.all([
              runSessionLinearChecks(),
              autoProjectHealth(),
            ]);

            result.linear = {
              auto_completed: linearContext.auto_completed,
              branch_warnings: linearContext.branch_warnings,
              stale_issues: linearContext.stale_issues,
              project_actions: projectActions,
            };
          } catch {
            // Linear checks are best-effort
            result.linear = { error: 'Linear checks failed — continuing without them' };
          }
        }

        return json(result);
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  // =========================================================================
  // Git Coordination
  // =========================================================================

  server.registerTool(
    'check_path',
    {
      title: 'Check Path',
      description: 'Before creating or modifying files: who owns this area, pending changes, risk assessment.',
      inputSchema: {
        path: z.string().describe('File or directory path (relative to repo root)'),
      },
    },
    ({ path }) => json(checkPath({ path })),
  );

  server.registerTool(
    'search_code',
    {
      title: 'Search Code',
      description: 'Search for existing exports (functions, classes, types) across the codebase and remote branches. Use before implementing something.',
      inputSchema: {
        query: z.string().describe('Function, type, or component name'),
        path: z.string().optional().describe('Narrow to a directory (e.g. "src/auth")'),
      },
    },
    ({ query, path }) => json(searchTeamCode({ query, path })),
  );

  server.registerTool(
    'check_conflicts',
    {
      title: 'Check Conflicts',
      description: 'Detect files modified on multiple branches that may cause merge conflicts.',
      inputSchema: {},
    },
    () => json(checkConflicts()),
  );

  server.registerTool(
    'get_developer',
    {
      title: 'Get Developer',
      description: 'Drill down on one teammate: recent commits, branches, work areas.',
      inputSchema: {
        name: z.string().describe('Developer name (fuzzy matched)'),
      },
    },
    ({ name }) => json(getDeveloper({ name })),
  );

  server.registerTool(
    'get_project_context',
    {
      title: 'Get Project Context',
      description: 'Read planning docs, specs, READMEs, and AI context files.',
      inputSchema: {
        path: z.string().optional().describe('Narrow to a directory'),
        query: z.string().optional().describe('Filter by content match'),
      },
    },
    ({ path, query }) => json(getProjectContext({ path, query })),
  );

  server.registerTool(
    'get_team_activity',
    {
      title: 'Get Team Activity',
      description: 'Overview of who is active, their branches, and work areas. Already included in start_session.',
      inputSchema: {
        since: z.string().default('24h').describe('How far back to look'),
      },
    },
    ({ since }) => json(getTeamActivity({ since })),
  );

  server.registerTool(
    'disable_auto_push',
    {
      title: 'Disable Auto-Push',
      description: 'Stop automatic pushing. Returns how many pushes were made.',
      inputSchema: {},
    },
    () => json(disableAutoPush()),
  );

  // =========================================================================
  // Linear — Issues (only registered if API key is set)
  // =========================================================================

  if (hasLinear) {
    server.registerTool(
      'linear_get_issues',
      {
        title: 'Get Issues',
        description: 'Open issues from Linear (Triage, Backlog, Todo, In Progress). Shows identifier, title, assignee, status, priority, and suggested branch name.',
        inputSchema: {
          teamKey: z.string().optional().describe('Team key to filter by (e.g. "WIN", "TEL"). Omit to use SWARMCODE_LINEAR_TEAM env var, or fetch all teams if unset.'),
        },
      },
      ({ teamKey }) => tryLinear(() => getLinearData(teamKey)),
    );

    server.registerTool(
      'pick_issue',
      {
        title: 'Pick Issue',
        description: 'Claim a Linear issue: assigns to you, moves to In Progress, and returns the branch name to checkout. Use this instead of linear_start_issue.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
        },
      },
      async ({ issue }) => {
        try {
          const result = await startIssue(issue);
          if (!result.success) return err(result.error ?? 'Failed to start issue');

          // Get the full issue to return branchName
          const detail = await getIssue(issue);
          return json({
            ...result,
            branchName: detail.branchName,
            hint: `Run: git checkout -b ${detail.branchName}`,
          });
        } catch (e: any) {
          return err(e.message);
        }
      },
    );

    server.registerTool(
      'complete_issue',
      {
        title: 'Complete Issue',
        description: 'Mark a Linear issue as Done. Call when work is complete, tests pass, and branch is merged.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
        },
      },
      ({ issue }) => tryLinear(() => completeIssue(issue)),
    );

    server.registerTool(
      'log_progress',
      {
        title: 'Log Progress',
        description: 'Add a comment to a Linear issue. Use at meaningful milestones, not every commit. Supports markdown.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
          body: z.string().describe('What was accomplished (markdown)'),
        },
      },
      ({ issue, body }) => tryLinear(() => commentOnIssue(issue, body)),
    );

    server.registerTool(
      'search_issues',
      {
        title: 'Search Issues',
        description: 'Search Linear issues by text. Check if a ticket already exists before creating one.',
        inputSchema: {
          query: z.string().describe('Search text'),
          limit: z.number().optional().describe('Max results (default: 20)'),
        },
      },
      ({ query, limit }) => tryLinear(() => searchIssues(query, limit ?? 20)),
    );

    server.registerTool(
      'get_issue',
      {
        title: 'Get Issue',
        description: 'Full details on a specific issue: description, comments, sub-issues, labels, team.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
        },
      },
      ({ issue }) => tryLinear(() => getIssue(issue)),
    );

    server.registerTool(
      'create_issue',
      {
        title: 'Create Issue',
        description: 'Create a new Linear issue. Use when you discover a bug, needed refactor, or follow-up work.',
        inputSchema: {
          title: z.string().describe('Issue title'),
          teamId: z.string().describe('Team ID (get from get_teams)'),
          description: z.string().optional().describe('Description (markdown)'),
          priority: z.number().optional().describe('0=none, 1=urgent, 2=high, 3=normal, 4=low'),
          assigneeId: z.string().optional().describe('User ID to assign'),
        },
      },
      ({ title, teamId, description, priority, assigneeId }) => {
        const fields: Record<string, unknown> = { title, teamId };
        if (description !== undefined) fields.description = description;
        if (priority !== undefined) fields.priority = priority;
        if (assigneeId !== undefined) fields.assigneeId = assigneeId;
        return tryLinear(() => createIssue(fields as any));
      },
    );

    server.registerTool(
      'create_sub_issue',
      {
        title: 'Create Sub-Issue',
        description: 'Create a child issue under a parent. Inherits the parent team.',
        inputSchema: {
          parent: z.string().describe('Parent issue identifier (e.g. "ENG-123")'),
          title: z.string().describe('Sub-issue title'),
          description: z.string().optional().describe('Description (markdown)'),
          priority: z.number().optional().describe('0=none, 1=urgent, 2=high, 3=normal, 4=low'),
        },
      },
      ({ parent, title, description, priority }) => {
        const fields: Record<string, unknown> = { title };
        if (description !== undefined) fields.description = description;
        if (priority !== undefined) fields.priority = priority;
        return tryLinear(() => createSubIssue(parent, fields as any));
      },
    );

    server.registerTool(
      'update_issue',
      {
        title: 'Update Issue',
        description: 'Update fields on a Linear issue: title, description, priority, assignee.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
          title: z.string().optional().describe('New title'),
          description: z.string().optional().describe('New description'),
          priority: z.number().optional().describe('0=none, 1=urgent, 2=high, 3=normal, 4=low'),
          assigneeId: z.string().optional().describe('User ID'),
        },
      },
      ({ issue, title, description, priority, assigneeId }) => {
        const fields: Record<string, unknown> = {};
        if (title !== undefined) fields.title = title;
        if (description !== undefined) fields.description = description;
        if (priority !== undefined) fields.priority = priority;
        if (assigneeId !== undefined) fields.assigneeId = assigneeId;
        return tryLinear(() => updateIssue(issue, fields));
      },
    );

    server.registerTool(
      'archive_issue',
      {
        title: 'Archive Issue',
        description: 'Archive an issue that is no longer relevant.',
        inputSchema: {
          issue: z.string().describe('Issue identifier'),
        },
      },
      ({ issue }) => tryLinear(() => archiveIssue(issue)),
    );

    server.registerTool(
      'create_issue_relation',
      {
        title: 'Create Issue Relation',
        description: 'Link two issues (blocks, blocked_by, related, duplicate).',
        inputSchema: {
          issue: z.string().describe('Issue identifier'),
          relatedIssue: z.string().describe('Related issue identifier'),
          type: z.string().describe('"blocks", "blocked_by", "related", "duplicate"'),
        },
      },
      ({ issue, relatedIssue, type }) =>
        tryLinear(() => createIssueRelation(issue, relatedIssue, type)),
    );

    server.registerTool(
      'get_issue_relations',
      {
        title: 'Get Issue Relations',
        description: 'See what blocks or is related to an issue.',
        inputSchema: {
          issue: z.string().describe('Issue identifier'),
        },
      },
      ({ issue }) => tryLinear(() => getIssueRelations(issue)),
    );

    // =========================================================================
    // Linear — Projects
    // =========================================================================

    server.registerTool(
      'project_status',
      {
        title: 'Project Status',
        description: 'Get all projects with progress, health, and latest status update. One call for the full project picture.',
        inputSchema: {},
      },
      async () => {
        try {
          const projects = await getProjects();
          const enriched = await Promise.all(
            projects.map(async (p) => {
              try {
                const updates = await getProjectUpdates(p.id, 1);
                return { ...p, latestUpdate: updates[0] ?? null };
              } catch {
                return { ...p, latestUpdate: null };
              }
            }),
          );
          return json(enriched);
        } catch (e: any) {
          return err(e.message);
        }
      },
    );

    server.registerTool(
      'get_project_issues',
      {
        title: 'Get Project Issues',
        description: 'List all issues in a project to see overall progress.',
        inputSchema: {
          projectId: z.string().describe('Project ID (from project_status)'),
        },
      },
      ({ projectId }) => tryLinear(() => getProjectIssues(projectId)),
    );

    server.registerTool(
      'update_project_status',
      {
        title: 'Update Project Status',
        description: 'Post a status update on a project with a health indicator.',
        inputSchema: {
          projectId: z.string().describe('Project ID'),
          body: z.string().describe('Status update (markdown)'),
          health: z.string().optional().describe('"onTrack", "atRisk", or "offTrack" (default: onTrack)'),
        },
      },
      ({ projectId, body, health }) =>
        tryLinear(() => createProjectUpdate(projectId, body, health ?? 'onTrack')),
    );

    server.registerTool(
      'update_project',
      {
        title: 'Update Project',
        description: 'Change a project\'s name, description, state, or target date.',
        inputSchema: {
          projectId: z.string().describe('Project ID'),
          name: z.string().optional().describe('New name'),
          description: z.string().optional().describe('New description'),
          state: z.string().optional().describe('"planned", "started", "paused", "completed", "canceled"'),
          targetDate: z.string().optional().describe('Target date (YYYY-MM-DD)'),
        },
      },
      ({ projectId, name, description, state, targetDate }) => {
        const fields: Record<string, unknown> = {};
        if (name !== undefined) fields.name = name;
        if (description !== undefined) fields.description = description;
        if (state !== undefined) fields.state = state;
        if (targetDate !== undefined) fields.targetDate = targetDate;
        return tryLinear(() => updateProject(projectId, fields as any));
      },
    );

    server.registerTool(
      'add_issue_to_project',
      {
        title: 'Add Issue to Project',
        description: 'Add an existing issue to a project.',
        inputSchema: {
          issue: z.string().describe('Issue identifier'),
          projectId: z.string().describe('Project ID'),
        },
      },
      ({ issue, projectId }) => tryLinear(() => addIssueToProject(issue, projectId)),
    );

    // =========================================================================
    // Linear — Labels
    // =========================================================================

    server.registerTool(
      'get_labels',
      {
        title: 'Get Labels',
        description: 'List all issue labels in the workspace.',
        inputSchema: {},
      },
      () => tryLinear(() => getLabels()),
    );

    server.registerTool(
      'add_label',
      {
        title: 'Add Label',
        description: 'Add a label to an issue.',
        inputSchema: {
          issue: z.string().describe('Issue identifier'),
          labelId: z.string().describe('Label ID (from get_labels)'),
        },
      },
      ({ issue, labelId }) => tryLinear(() => addIssueLabel(issue, labelId)),
    );

    server.registerTool(
      'remove_label',
      {
        title: 'Remove Label',
        description: 'Remove a label from an issue.',
        inputSchema: {
          issue: z.string().describe('Issue identifier'),
          labelId: z.string().describe('Label ID'),
        },
      },
      ({ issue, labelId }) => tryLinear(() => removeIssueLabel(issue, labelId)),
    );

    // =========================================================================
    // Linear — Workspace Reference
    // =========================================================================

    server.registerTool(
      'get_teams',
      {
        title: 'Get Teams',
        description: 'List teams. Needed to resolve team IDs for create_issue.',
        inputSchema: {},
      },
      () => tryLinear(() => getLinearTeams()),
    );

    server.registerTool(
      'get_users',
      {
        title: 'Get Users',
        description: 'List users. Needed to resolve user IDs for assignments.',
        inputSchema: {},
      },
      () => tryLinear(() => getLinearUsers()),
    );

    server.registerTool(
      'get_viewer',
      {
        title: 'Get Current User',
        description: 'Get the authenticated user (you). Your ID, name, and email.',
        inputSchema: {},
      },
      () => tryLinear(() => getViewer()),
    );
  }

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`swarmcode MCP server v${VERSION} running on stdio`);
}
