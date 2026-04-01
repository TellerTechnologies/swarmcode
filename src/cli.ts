import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
- At the start of every session, call \`get_project_context\` to understand the project plan
- Before creating or modifying any file, call \`check_path\`
- Before implementing a function/type/component, call \`search_team_code\`
- Never rebuild something a teammate already built — import it
- If check_path returns high risk, stop and ask the developer before proceeding

### Recommended Project Structure

Swarmcode scans these locations for project context:

- \`README.md\` — project overview
- \`PLAN.md\` — project plan and team assignments
- \`docs/\` — architecture, design decisions, guides
- \`specs/\` — design specifications
- \`CLAUDE.md\` / \`.cursorrules\` — AI coordination rules
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
        } else {
          writeFileSync(filePath, existing.trimEnd() + '\n\n' + SWARMCODE_SNIPPET);
          console.log(`Added swarmcode team coordination to ${filePath}`);
        }
      } else {
        writeFileSync(filePath, SWARMCODE_SNIPPET);
        console.log(`Added swarmcode team coordination to ${filePath}`);
      }

      // Set up MCP configuration
      const MCP_CONFIG: Record<string, { file: string; shape: (existing: Record<string, unknown>) => Record<string, unknown> }> = {
        'claude-code': {
          file: '.mcp.json',
          shape: (existing) => ({
            ...existing,
            mcpServers: {
              ...(existing.mcpServers as Record<string, unknown> || {}),
              swarmcode: { command: 'npx', args: ['swarmcode'] },
            },
          }),
        },
        'cursor': {
          file: '.cursor/mcp.json',
          shape: (existing) => ({
            ...existing,
            mcpServers: {
              ...(existing.mcpServers as Record<string, unknown> || {}),
              swarmcode: { command: 'npx', args: ['swarmcode'] },
            },
          }),
        },
      };

      const mcpEntry = MCP_CONFIG[tool];
      if (mcpEntry) {
        const mcpDir = dirname(mcpEntry.file);
        if (mcpDir !== '.' && !existsSync(mcpDir)) {
          mkdirSync(mcpDir, { recursive: true });
        }

        let existing: Record<string, unknown> = {};
        if (existsSync(mcpEntry.file)) {
          try {
            existing = JSON.parse(readFileSync(mcpEntry.file, 'utf-8'));
          } catch {
            // If the file is malformed, start fresh
          }
          const servers = existing.mcpServers as Record<string, unknown> | undefined;
          if (servers && 'swarmcode' in servers) {
            console.log(`Swarmcode MCP server already configured in ${mcpEntry.file}`);
            return;
          }
        }

        writeFileSync(mcpEntry.file, JSON.stringify(mcpEntry.shape(existing), null, 2) + '\n');
        console.log(`Configured swarmcode MCP server in ${mcpEntry.file}`);
      }
    });

  const PRE_PUSH_HOOK = `#!/bin/sh
# Installed by swarmcode — keeps remote branches fresh
git fetch origin 2>/dev/null
`;

  program
    .command('hook')
    .description('Install a git pre-push hook that runs git fetch before each push')
    .action(() => {
      // Find the git repo root
      let repoRoot: string;
      try {
        repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          encoding: 'utf-8',
        }).trim();
      } catch {
        console.log('Not a git repository — cannot install hook.');
        return;
      }

      const hooksDir = join(repoRoot, '.git', 'hooks');
      const hookPath = join(hooksDir, 'pre-push');

      // Check if hook already exists
      if (existsSync(hookPath)) {
        const existing = readFileSync(hookPath, 'utf-8');
        if (existing.includes('swarmcode')) {
          console.log('Swarmcode pre-push hook is already installed.');
          return;
        }
        console.log(
          `A pre-push hook already exists at ${hookPath}. ` +
          'Remove it manually if you want swarmcode to manage it.',
        );
        return;
      }

      // Create hooks directory if needed
      if (!existsSync(hooksDir)) {
        mkdirSync(hooksDir, { recursive: true });
      }

      // Write and make executable
      writeFileSync(hookPath, PRE_PUSH_HOOK);
      chmodSync(hookPath, 0o755);

      console.log(`Installed swarmcode pre-push hook at ${hookPath}`);
    });

  return program;
}
