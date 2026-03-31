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

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`swarmcode MCP server v${VERSION} running on stdio`);
}
