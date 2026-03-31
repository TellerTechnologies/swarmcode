import { Command } from 'commander';
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

  return program;
}
