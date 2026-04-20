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
  getIssue,
  startIssue,
  completeIssue,
  commentOnIssue,
  updateIssue,
  createIssueRelation,
  getIssueRelations,
  checkIssueItem,
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
    hasLinear ? '- For the list of available work, use the Linear MCP (list_issues). Swarmcode only exposes the composite workflows that wrap it.' : '',
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
    '## Progress & Checkbox Tracking',
    hasLinear ? '- After meaningful milestones (NOT every commit) → call log_progress to record what was accomplished' : '',
    hasLinear ? '- When logging progress, ALWAYS include checkItems to check off completed subtasks in the issue description (e.g. checkItems: ["Add billing page", "Create backend"])' : '',
    hasLinear ? '- After completing a subtask listed in the issue description, call check_item to mark it done — do not wait until the end' : '',
    hasLinear ? '- Read the issue description at the start of work to know what checkboxes exist — track them as you go' : '',
    '',
    '## Completion',
    hasLinear ? '- When work is complete and merged → call complete_issue to mark it Done (this also checks off any remaining checkboxes)' : '',
    hasLinear ? '- For generic Linear CRUD not listed here (creating new issues, updating fields, listing projects/labels/teams/users, etc.) → use the official Linear MCP (save_issue, list_issues, list_projects, list_issue_labels, list_teams, list_users, etc.)' : '',
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

        let autoPushStatus: string;
        try {
          enableAutoPush({ interval: 30 });
          autoPushStatus = 'enabled';
        } catch (e: any) {
          // Auto-push fails on protected branches — that's expected at session start.
          // The agent can call enable_auto_push after checking out a feature branch.
          autoPushStatus = `deferred (${e.message})`;
        }

        const result: Record<string, unknown> = {
          ...data,
          auto_push: autoPushStatus,
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
    'enable_auto_push',
    {
      title: 'Enable Auto-Push',
      description: 'Start automatic pushing on the current branch. Call this after checking out a feature branch if start_session deferred auto-push (e.g. because you were on main).',
      inputSchema: {
        interval: z.number().optional().describe('Push check interval in seconds (default: 30)'),
      },
    },
    ({ interval }) => {
      try {
        return json(enableAutoPush({ interval: interval ?? 30 }));
      } catch (e: any) {
        return err(e.message);
      }
    },
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
        description: 'Mark a Linear issue as Done and check off all remaining checkboxes in the description. Call when work is complete, tests pass, and branch is merged.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
        },
      },
      async ({ issue }) => {
        try {
          // Check off all remaining checkboxes before completing
          const detail = await getIssue(issue);
          const description = detail.description ?? '';
          if (description.includes('- [ ]')) {
            const checked = description.replace(/- \[ \]/g, '- [x]');
            await updateIssue(issue, { description: checked });
          }
          const result = await completeIssue(issue);
          return json(result);
        } catch (e: any) {
          return err(e.message);
        }
      },
    );

    server.registerTool(
      'log_progress',
      {
        title: 'Log Progress',
        description: 'Add a comment to a Linear issue and optionally check off completed items in the description. Use at meaningful milestones, not every commit. Supports markdown.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
          body: z.string().describe('What was accomplished (markdown)'),
          checkItems: z.array(z.string()).optional().describe('Substrings matching checkbox items in the issue description to mark as done'),
        },
      },
      async ({ issue, body, checkItems }) => {
        try {
          const commentResult = await commentOnIssue(issue, body);
          const checked: string[] = [];
          if (checkItems && checkItems.length > 0) {
            for (const item of checkItems) {
              const result = await checkIssueItem(issue, item);
              if (result.success && result.checked) {
                checked.push(result.checked);
              }
            }
          }
          return json({ ...commentResult, checkedItems: checked });
        } catch (e: any) {
          return err(e.message);
        }
      },
    );

    server.registerTool(
      'check_item',
      {
        title: 'Check Item',
        description: 'Check off a checkbox item in an issue description. Matches by substring. Returns which item was checked and how many remain.',
        inputSchema: {
          issue: z.string().describe('Issue identifier (e.g. "ENG-123")'),
          item: z.string().describe('Text to match against unchecked items (substring, case-insensitive)'),
        },
      },
      ({ issue, item }) => tryLinear(() => checkIssueItem(issue, item)),
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
  }

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`swarmcode MCP server v${VERSION} running on stdio`);
}
