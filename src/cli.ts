import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { VERSION } from './index.js';
import { getTeamActivity } from './tools/get-team-activity.js';

export function createCLI(): Command {
  const program = new Command();
  program
    .name('swarmcode')
    .description('MCP server that coordinates AI coding assistants using git')
    .version(VERSION);

  // Default action (no subcommand): start MCP server
  program
    .action(async () => {
      const { startServer } = await import('./server.js');
      await startServer();
    });

  program
    .command('status')
    .description('Show recent team activity')
    .option('--since <since>', 'How far back to look', '24h')
    .action((options) => {
      const activity = getTeamActivity({ since: options.since });

      if (activity.length === 0) {
        console.log('No recent team activity found.');
        return;
      }

      for (const member of activity) {
        const ago = Math.round((Date.now() / 1000 - member.last_active) / 60);
        const timeStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
        console.log(`\n${member.name} (last active ${timeStr})`);

        if (member.work_areas.length > 0) {
          console.log(`  Working in: ${member.work_areas.join(', ')}`);
        }
        if (member.active_branches.length > 0) {
          console.log(`  Branches: ${member.active_branches.join(', ')}`);
        }
        for (const commit of member.recent_commits.slice(0, 3)) {
          console.log(`  - ${commit.message}`);
        }
      }
    });

  const SWARMCODE_SNIPPET = `## Team Coordination (Swarmcode)

This project uses swarmcode for AI team coordination.

- At the start of every session, call \`enable_auto_push\` and \`get_team_activity\`
- Before creating or modifying any file, call \`check_path\`
- Before implementing a function/type/component, call \`search_team_code\`
- Never rebuild something a teammate already built — import it
- If check_path returns high risk, stop and ask the developer before proceeding
`;

  const TOOL_FILES: Record<string, string> = {
    'claude-code': 'CLAUDE.md',
    'cursor': '.cursorrules',
    'copilot': '.github/copilot-instructions.md',
  };

  program
    .command('init')
    .description('Add team coordination rules to your AI context file')
    .option('--tool <tool>', 'AI tool (claude-code, cursor, copilot)', 'claude-code')
    .action((options) => {
      const tool = options.tool as string;
      const filePath = TOOL_FILES[tool];

      if (!filePath) {
        console.error(`Unknown tool: ${tool}. Use claude-code, cursor, or copilot.`);
        process.exitCode = 1;
        return;
      }

      // Create parent directory if needed (for copilot's .github/)
      const dir = dirname(filePath);
      if (dir !== '.' && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      if (existsSync(filePath)) {
        const existing = readFileSync(filePath, 'utf-8');
        if (existing.includes('## Team Coordination (Swarmcode)')) {
          console.log(`Swarmcode section already exists in ${filePath}`);
          return;
        }
        writeFileSync(filePath, existing.trimEnd() + '\n\n' + SWARMCODE_SNIPPET);
      } else {
        writeFileSync(filePath, SWARMCODE_SNIPPET);
      }

      console.log(`Added swarmcode team coordination to ${filePath}`);
    });

  return program;
}
