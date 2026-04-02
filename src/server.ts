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
import {
  isConfigured as linearConfigured,
  getLinearData,
  searchIssues,
  getIssue,
  getTeams as getLinearTeams,
  getUsers as getLinearUsers,
  getWorkflowStates,
  getCycles,
  getViewer,
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
} from './linear.js';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'swarmcode', version: VERSION },
    {
      instructions: [
        'You have access to team coordination tools. Use them:',
        '- At the very start of a session → call check_all (combines team activity, project context, and conflict check)',
        '- Before creating files in a new directory → call check_path',
        '- Before implementing a function that might already exist → call search_team_code',
        '- When something conflicts or breaks unexpectedly → call check_conflicts',
        '- At the start of a session → call enable_auto_push so teammates see your work immediately',
        'Do not rebuild what a teammate has already built. Import from their work instead.',
        '',
        'Commit early and often — after each logical unit of work (new function, bug fix, test added, file created).',
        'Small, frequent commits are pushed automatically and let teammates see your progress in real-time.',
        'Waiting until the end to commit one large changeset defeats coordination — teammates cannot see or avoid your work.',
        '',
        'If Linear is configured:',
        '- At the start of a session → call linear_get_issues to see what is assigned and available',
        '- Before starting work → call linear_start_issue to claim the ticket and move it to In Progress',
        '- After meaningful progress → call linear_comment to log what was done',
        '- When the work is complete and merged → call linear_complete_issue to mark it Done',
        '- Do not work on issues that are already In Progress and assigned to someone else',
      ].join('\n'),
    },
  );

  server.registerTool(
    'get_team_activity',
    {
      title: 'Get Team Activity',
      description: 'Overview of recent work across all contributors. Shows who is active, what branches they are on, and what areas they are working in.',
      inputSchema: {
        since: z.string().default('24h').describe('How far back to look (git date format, e.g. "24h", "7d", "2w")'),
      },
    },
    ({ since }) => {
      const result = getTeamActivity({ since });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'check_path',
    {
      title: 'Check Path',
      description: 'Safety check before creating or modifying files. Returns who owns this area, pending changes on other branches, and a risk assessment.',
      inputSchema: {
        path: z.string().describe('File or directory path to check (relative to repo root)'),
      },
    },
    ({ path }) => {
      const result = checkPath({ path });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'search_team_code',
    {
      title: 'Search Team Code',
      description: 'Search for existing exports (functions, classes, types, constants) across the codebase. Use before implementing something that might already exist.',
      inputSchema: {
        query: z.string().describe('Function, type, or component name to search for'),
        path: z.string().optional().describe('Narrow search to a directory (e.g. "src/auth")'),
      },
    },
    ({ query, path }) => {
      const result = searchTeamCode({ query, path });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'check_conflicts',
    {
      title: 'Check Conflicts',
      description: 'Detect potential merge conflicts across active branches. Shows files modified on multiple branches and local changes that overlap.',
      inputSchema: {},
    },
    () => {
      const result = checkConflicts();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'get_developer',
    {
      title: 'Get Developer',
      description: 'Drill-down on one teammate. Shows their recent commits, active branches, and primary work areas.',
      inputSchema: {
        name: z.string().describe('Developer name (fuzzy matched against git authors)'),
      },
    },
    ({ name }) => {
      const result = getDeveloper({ name });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'enable_auto_push',
    {
      title: 'Enable Auto-Push',
      description: 'Start automatically pushing new commits to the remote. Teammates will see your work within seconds of committing. Call this at the start of every session.',
      inputSchema: {
        interval: z.number().optional().describe('Seconds between push checks (default: 30)'),
      },
    },
    ({ interval }) => {
      try {
        const result = enableAutoPush({ interval });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
      }
    },
  );

  server.registerTool(
    'disable_auto_push',
    {
      title: 'Disable Auto-Push',
      description: 'Stop automatic pushing. Returns how many pushes were made during the session.',
      inputSchema: {},
    },
    () => {
      const result = disableAutoPush();
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'get_project_context',
    {
      title: 'Get Project Context',
      description: 'Read planning docs, specs, READMEs, and AI context files (CLAUDE.md, .cursorrules, etc.) to understand the project plan, architecture, and team assignments.',
      inputSchema: {
        path: z.string().optional().describe('Narrow to a specific directory (e.g. "specs/")'),
        query: z.string().optional().describe('Only return files whose path or content matches (case-insensitive)'),
      },
    },
    ({ path, query }) => {
      const result = getProjectContext({ path, query });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'check_all',
    {
      title: 'Check All',
      description: 'Session startup tool. Runs get_team_activity, get_project_context, and check_conflicts in one call. Returns all three results combined so the AI gets full context immediately.',
      inputSchema: {
        since: z.string().default('24h').describe('How far back to look for team activity (git date format, e.g. "24h", "7d", "2w")'),
      },
    },
    ({ since }) => {
      try {
        const result = checkAll({ since });
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Linear tools (only registered if API key is configured)
  // ---------------------------------------------------------------------------

  if (linearConfigured()) {

    // --- Read tools ---

    server.registerTool(
      'linear_get_issues',
      {
        title: 'Linear: Get Active Issues',
        description: 'Fetch active issues from Linear (In Progress + Todo). Shows identifier, title, assignee, status, priority, and branch name. Use at session start to see what work is available.',
        inputSchema: {},
      },
      async () => {
        try {
          const data = await getLinearData();
          return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_search_issues',
      {
        title: 'Linear: Search Issues',
        description: 'Search Linear issues by text query. Finds issues matching title, description, identifier, or comments. Use to check if a ticket already exists before creating one.',
        inputSchema: {
          query: z.string().describe('Search text (e.g. "auth login bug", "ENG-42")'),
          limit: z.number().optional().describe('Max results to return (default: 20)'),
        },
      },
      async ({ query, limit }) => {
        try {
          const results = await searchIssues(query, limit ?? 20);
          return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_issue',
      {
        title: 'Linear: Get Issue Details',
        description: 'Get full details on a specific issue: description, comments, sub-issues, labels, dates, team. Use before starting work to understand requirements.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
        },
      },
      async ({ issue }) => {
        try {
          const result = await getIssue(issue);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_teams',
      {
        title: 'Linear: Get Teams',
        description: 'List all teams in the workspace. Returns team IDs, names, and keys. Use to resolve team IDs when creating issues.',
        inputSchema: {},
      },
      async () => {
        try {
          const teams = await getLinearTeams();
          return { content: [{ type: 'text' as const, text: JSON.stringify(teams, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_users',
      {
        title: 'Linear: Get Users',
        description: 'List all users in the workspace. Returns user IDs, names, and emails. Use to resolve assignee IDs.',
        inputSchema: {},
      },
      async () => {
        try {
          const users = await getLinearUsers();
          return { content: [{ type: 'text' as const, text: JSON.stringify(users, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_workflow_states',
      {
        title: 'Linear: Get Workflow States',
        description: 'Get all workflow states for a team (e.g. Backlog, Todo, In Progress, Done, Cancelled). Use to see available statuses and resolve state IDs.',
        inputSchema: {
          teamId: z.string().describe('Team ID (get from linear_get_teams)'),
        },
      },
      async ({ teamId }) => {
        try {
          const states = await getWorkflowStates(teamId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(states, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_cycles',
      {
        title: 'Linear: Get Cycles',
        description: 'Get the active cycle (sprint) and recent cycles for a team. Shows cycle name, dates, and issue counts.',
        inputSchema: {
          teamId: z.string().describe('Team ID (get from linear_get_teams)'),
        },
      },
      async ({ teamId }) => {
        try {
          const cycles = await getCycles(teamId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(cycles, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_viewer',
      {
        title: 'Linear: Get Current User',
        description: 'Get the authenticated user (you). Returns your user ID, name, and email.',
        inputSchema: {},
      },
      async () => {
        try {
          const viewer = await getViewer();
          return { content: [{ type: 'text' as const, text: JSON.stringify(viewer, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    // --- Write tools ---

    server.registerTool(
      'linear_start_issue',
      {
        title: 'Linear: Start Issue',
        description: 'Claim a Linear issue and move it to In Progress. Assigns it to you and updates the status. Call this before starting work on a ticket.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
        },
      },
      async ({ issue }) => {
        try {
          const result = await startIssue(issue);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_complete_issue',
      {
        title: 'Linear: Complete Issue',
        description: 'Mark a Linear issue as Done. Call this when the work is complete, tests pass, and the branch is merged.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
        },
      },
      async ({ issue }) => {
        try {
          const result = await completeIssue(issue);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_update_status',
      {
        title: 'Linear: Update Status',
        description: 'Move a Linear issue to a specific status type. Use when the standard start/complete flow does not apply.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          status: z.string().describe('Target status type: "unstarted", "started", "completed", or "cancelled"'),
        },
      },
      async ({ issue, status }) => {
        try {
          const result = await updateIssueStatus(issue, status);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_update_issue',
      {
        title: 'Linear: Update Issue',
        description: 'Update fields on a Linear issue: title, description, priority, assignee, due date, estimate. Use for any modifications beyond status changes.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          title: z.string().optional().describe('New title'),
          description: z.string().optional().describe('New description (markdown)'),
          priority: z.number().optional().describe('Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low'),
          assigneeId: z.string().optional().describe('User ID to assign to (get from linear_get_users)'),
          stateId: z.string().optional().describe('Workflow state ID (get from linear_get_workflow_states)'),
          dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
          estimate: z.number().optional().describe('Estimate points'),
        },
      },
      async ({ issue, title, description, priority, assigneeId, stateId, dueDate, estimate }) => {
        const fields: Record<string, unknown> = {};
        if (title !== undefined) fields.title = title;
        if (description !== undefined) fields.description = description;
        if (priority !== undefined) fields.priority = priority;
        if (assigneeId !== undefined) fields.assigneeId = assigneeId;
        if (stateId !== undefined) fields.stateId = stateId;
        if (dueDate !== undefined) fields.dueDate = dueDate;
        if (estimate !== undefined) fields.estimate = estimate;

        try {
          const result = await updateIssue(issue, fields);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_create_issue',
      {
        title: 'Linear: Create Issue',
        description: 'Create a new Linear issue. Use when you discover a bug, needed refactor, or follow-up work while coding. Requires a team ID (get from linear_get_teams).',
        inputSchema: {
          title: z.string().describe('Issue title'),
          teamId: z.string().describe('Team ID (get from linear_get_teams)'),
          description: z.string().optional().describe('Issue description (markdown)'),
          priority: z.number().optional().describe('Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low'),
          assigneeId: z.string().optional().describe('User ID to assign (get from linear_get_users)'),
          stateId: z.string().optional().describe('Initial state ID (get from linear_get_workflow_states)'),
          dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
          estimate: z.number().optional().describe('Estimate points'),
        },
      },
      async ({ title, teamId, description, priority, assigneeId, stateId, dueDate, estimate }) => {
        const fields: Record<string, unknown> = { title, teamId };
        if (description !== undefined) fields.description = description;
        if (priority !== undefined) fields.priority = priority;
        if (assigneeId !== undefined) fields.assigneeId = assigneeId;
        if (stateId !== undefined) fields.stateId = stateId;
        if (dueDate !== undefined) fields.dueDate = dueDate;
        if (estimate !== undefined) fields.estimate = estimate;

        try {
          const result = await createIssue(fields as any);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_create_sub_issue',
      {
        title: 'Linear: Create Sub-Issue',
        description: 'Create a sub-issue under a parent issue. Use to break a large ticket into smaller pieces. Inherits the parent team automatically.',
        inputSchema: {
          parent: z.string().describe('Parent issue identifier (e.g. "ENG-42")'),
          title: z.string().describe('Sub-issue title'),
          description: z.string().optional().describe('Sub-issue description (markdown)'),
          priority: z.number().optional().describe('Priority: 0=none, 1=urgent, 2=high, 3=normal, 4=low'),
          assigneeId: z.string().optional().describe('User ID to assign (get from linear_get_users)'),
        },
      },
      async ({ parent, title, description, priority, assigneeId }) => {
        const fields: Record<string, unknown> = { title };
        if (description !== undefined) fields.description = description;
        if (priority !== undefined) fields.priority = priority;
        if (assigneeId !== undefined) fields.assigneeId = assigneeId;

        try {
          const result = await createSubIssue(parent, fields as any);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_comment',
      {
        title: 'Linear: Comment',
        description: 'Add a comment to a Linear issue. Use to log progress, note blockers, or summarize what was done. Supports markdown.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          body: z.string().describe('Comment body (markdown supported)'),
        },
      },
      async ({ issue, body }) => {
        try {
          const result = await commentOnIssue(issue, body);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    // --- Project tools ---

    server.registerTool(
      'linear_get_projects',
      {
        title: 'Linear: Get Projects',
        description: 'List projects in the workspace. Shows name, state, progress, lead, and target date. Projects group related issues into a larger initiative.',
        inputSchema: {
          limit: z.number().optional().describe('Max results (default: 25)'),
        },
      },
      async ({ limit }) => {
        try {
          const projects = await getProjects(limit ?? 25);
          return { content: [{ type: 'text' as const, text: JSON.stringify(projects, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_project_issues',
      {
        title: 'Linear: Get Project Issues',
        description: 'Get all issues in a project. Use to see overall progress and what remains.',
        inputSchema: {
          projectId: z.string().describe('Project ID (get from linear_get_projects)'),
          limit: z.number().optional().describe('Max results (default: 50)'),
        },
      },
      async ({ projectId, limit }) => {
        try {
          const issues = await getProjectIssues(projectId, limit ?? 50);
          return { content: [{ type: 'text' as const, text: JSON.stringify(issues, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_create_project',
      {
        title: 'Linear: Create Project',
        description: 'Create a new project to group related issues. Projects have a state (planned, started, paused, completed, canceled) and optional target date.',
        inputSchema: {
          name: z.string().describe('Project name'),
          teamIds: z.array(z.string()).describe('Team IDs to associate (get from linear_get_teams)'),
          description: z.string().optional().describe('Project description'),
          state: z.string().optional().describe('Initial state: "planned", "started", "paused", "completed", "canceled"'),
          targetDate: z.string().optional().describe('Target completion date (YYYY-MM-DD)'),
        },
      },
      async ({ name, teamIds, description, state, targetDate }) => {
        const fields: Record<string, unknown> = { name, teamIds };
        if (description !== undefined) fields.description = description;
        if (state !== undefined) fields.state = state;
        if (targetDate !== undefined) fields.targetDate = targetDate;
        try {
          const result = await createProject(fields as any);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_update_project',
      {
        title: 'Linear: Update Project',
        description: 'Update a project\'s name, description, state, or target date.',
        inputSchema: {
          projectId: z.string().describe('Project ID (get from linear_get_projects)'),
          name: z.string().optional().describe('New name'),
          description: z.string().optional().describe('New description'),
          state: z.string().optional().describe('"planned", "started", "paused", "completed", "canceled"'),
          targetDate: z.string().optional().describe('Target date (YYYY-MM-DD)'),
        },
      },
      async ({ projectId, name, description, state, targetDate }) => {
        const fields: Record<string, unknown> = {};
        if (name !== undefined) fields.name = name;
        if (description !== undefined) fields.description = description;
        if (state !== undefined) fields.state = state;
        if (targetDate !== undefined) fields.targetDate = targetDate;
        try {
          const result = await updateProject(projectId, fields as any);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_add_issue_to_project',
      {
        title: 'Linear: Add Issue to Project',
        description: 'Add an existing issue to a project.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          projectId: z.string().describe('Project ID (get from linear_get_projects)'),
        },
      },
      async ({ issue, projectId }) => {
        try {
          const result = await addIssueToProject(issue, projectId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    // --- Project Updates ---

    server.registerTool(
      'linear_get_project_updates',
      {
        title: 'Linear: Get Project Updates',
        description: 'Get status updates for a project. Shows health (onTrack, atRisk, offTrack), body, author, and date. Use to understand project health before starting work.',
        inputSchema: {
          projectId: z.string().describe('Project ID (get from linear_get_projects)'),
          limit: z.number().optional().describe('Max results (default: 10)'),
        },
      },
      async ({ projectId, limit }) => {
        try {
          const updates = await getProjectUpdates(projectId, limit ?? 10);
          return { content: [{ type: 'text' as const, text: JSON.stringify(updates, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_create_project_update',
      {
        title: 'Linear: Create Project Update',
        description: 'Post a status update on a project with a health indicator. Use after completing significant milestones.',
        inputSchema: {
          projectId: z.string().describe('Project ID (get from linear_get_projects)'),
          body: z.string().describe('Update body (markdown)'),
          health: z.string().optional().describe('"onTrack", "atRisk", or "offTrack" (default: "onTrack")'),
        },
      },
      async ({ projectId, body, health }) => {
        try {
          const result = await createProjectUpdate(projectId, body, health ?? 'onTrack');
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    // --- Issue extras ---

    server.registerTool(
      'linear_add_issue_to_cycle',
      {
        title: 'Linear: Add Issue to Cycle',
        description: 'Add an issue to a sprint cycle.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          cycleId: z.string().describe('Cycle ID (get from linear_get_cycles)'),
        },
      },
      async ({ issue, cycleId }) => {
        try {
          const result = await addIssueToCycle(issue, cycleId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_archive_issue',
      {
        title: 'Linear: Archive Issue',
        description: 'Archive an issue. Use for issues that are no longer relevant.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
        },
      },
      async ({ issue }) => {
        try {
          const result = await archiveIssue(issue);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_create_issue_relation',
      {
        title: 'Linear: Create Issue Relation',
        description: 'Create a relation between two issues (blocks, blocked by, related, duplicate).',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          relatedIssue: z.string().describe('Related issue identifier (e.g. "ENG-43")'),
          type: z.string().describe('Relation type: "blocks", "blocked_by", "related", "duplicate", "duplicate_of"'),
        },
      },
      async ({ issue, relatedIssue, type }) => {
        try {
          const result = await createIssueRelation(issue, relatedIssue, type);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_issue_relations',
      {
        title: 'Linear: Get Issue Relations',
        description: 'Get all relations for an issue (blocks, blocked by, related, duplicates). Use to understand dependencies.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
        },
      },
      async ({ issue }) => {
        try {
          const relations = await getIssueRelations(issue);
          return { content: [{ type: 'text' as const, text: JSON.stringify(relations, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_issue_history',
      {
        title: 'Linear: Get Issue History',
        description: 'Get the change history for an issue — status transitions, who changed what, when.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          limit: z.number().optional().describe('Max entries (default: 20)'),
        },
      },
      async ({ issue, limit }) => {
        try {
          const history = await getIssueHistory(issue, limit ?? 20);
          return { content: [{ type: 'text' as const, text: JSON.stringify(history, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_get_labels',
      {
        title: 'Linear: Get Labels',
        description: 'List all issue labels in the workspace. Returns label IDs, names, and colors.',
        inputSchema: {},
      },
      async () => {
        try {
          const labels = await getLabels();
          return { content: [{ type: 'text' as const, text: JSON.stringify(labels, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_add_issue_label',
      {
        title: 'Linear: Add Label to Issue',
        description: 'Add a label to an issue. Preserves existing labels.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          labelId: z.string().describe('Label ID (get from linear_get_labels)'),
        },
      },
      async ({ issue, labelId }) => {
        try {
          const result = await addIssueLabel(issue, labelId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
    );

    server.registerTool(
      'linear_remove_issue_label',
      {
        title: 'Linear: Remove Label from Issue',
        description: 'Remove a label from an issue.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-42")'),
          labelId: z.string().describe('Label ID (get from linear_get_labels)'),
        },
      },
      async ({ issue, labelId }) => {
        try {
          const result = await removeIssueLabel(issue, labelId);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }, null, 2) }], isError: true };
        }
      },
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
