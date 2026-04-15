import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { VERSION } from './index.js';
import { getTeamActivity } from './tools/get-team-activity.js';
import { extractIssueId, messageHasIssueId, prependIssueId } from './branch-parser.js';

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

### Multi-Agent Coordination

Swarmcode prevents conflicts when multiple agents work concurrently:

- \`pick_issue\` has an optimistic lock — if an issue is already In Progress, it returns an error. Pick a different issue.
- \`check_path\` detects merge conflicts before you edit — if it returns \`conflict_likely\` with \`merge_conflicts\`, choose a different approach or wait.
- Do not work on issues that are already In Progress and assigned to someone else.
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
      const isWindows = process.platform === 'win32';
      const mcpServer = isWindows
        ? { command: 'cmd', args: ['/c', 'npx', 'swarmcode'] }
        : { command: 'npx', args: ['swarmcode'] };

      const MCP_CONFIG: Record<string, { file: string; shape: (existing: Record<string, unknown>) => Record<string, unknown> }> = {
        'claude-code': {
          file: '.mcp.json',
          shape: (existing) => ({
            ...existing,
            mcpServers: {
              ...(existing.mcpServers as Record<string, unknown> || {}),
              swarmcode: mcpServer,
            },
          }),
        },
        'cursor': {
          file: '.cursor/mcp.json',
          shape: (existing) => ({
            ...existing,
            mcpServers: {
              ...(existing.mcpServers as Record<string, unknown> || {}),
              swarmcode: mcpServer,
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

  // ---------------------------------------------------------------------------
  // Git hooks
  // ---------------------------------------------------------------------------

  const HOOKS: Record<string, string> = {
    'prepare-commit-msg': `#!/bin/sh
# Installed by swarmcode — auto-prepends Linear issue ID from branch name
swarmcode prepare-commit "$1" 2>/dev/null || true
`,
    'commit-msg': `#!/bin/sh
# Installed by swarmcode — warns if commit message has no Linear issue ID
swarmcode validate-commit "$1" 2>/dev/null || true
`,
    'post-commit': `#!/bin/sh
# Installed by swarmcode — updates Linear on first commit to a branch
swarmcode post-commit 2>/dev/null || true
`,
    'pre-push': `#!/bin/sh
# Installed by swarmcode — keeps remote branches fresh
git fetch origin 2>/dev/null
`,
  };

  program
    .command('hook')
    .description('Install git hooks for Linear integration and team coordination')
    .action(() => {
      let repoRoot: string;
      try {
        repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
          encoding: 'utf-8',
        }).trim();
      } catch {
        console.log('Not a git repository — cannot install hooks.');
        return;
      }

      const hooksDir = join(repoRoot, '.git', 'hooks');
      if (!existsSync(hooksDir)) {
        mkdirSync(hooksDir, { recursive: true });
      }

      let installed = 0;
      let skipped = 0;

      for (const [hookName, hookContent] of Object.entries(HOOKS)) {
        const hookPath = join(hooksDir, hookName);

        if (existsSync(hookPath)) {
          const existing = readFileSync(hookPath, 'utf-8');
          if (existing.includes('swarmcode')) {
            skipped++;
            continue;
          }
          console.log(`  skip  ${hookName} (existing hook found — remove manually to replace)`);
          skipped++;
          continue;
        }

        writeFileSync(hookPath, hookContent);
        chmodSync(hookPath, 0o755);
        console.log(`  added ${hookName}`);
        installed++;
      }

      if (installed > 0) {
        console.log(`\nInstalled ${installed} hook(s) in ${hooksDir}`);
      }
      if (skipped > 0 && installed === 0) {
        console.log('All swarmcode hooks are already installed.');
      }

      console.log('\nHooks installed:');
      console.log('  prepare-commit-msg  Auto-prepend issue ID from branch name to commits');
      console.log('  commit-msg          Warn if commit message has no issue ID');
      console.log('  post-commit         Move Linear issue to In Progress on first commit');
      console.log('  pre-push            Fetch remote branches before pushing');
    });

  // --- Hook subcommands (called by git hooks, not by users directly) ---

  program
    .command('prepare-commit')
    .description('(hook) Prepend Linear issue ID from branch name to commit message')
    .argument('<msgfile>', 'Path to the commit message file')
    .action((msgfile: string) => {
      try {
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf-8',
        }).trim();

        if (branch === 'HEAD') return; // detached HEAD

        const issueId = extractIssueId(branch);
        if (!issueId) return; // no issue ID in branch name

        const message = readFileSync(msgfile, 'utf-8');

        // Don't touch merge commits, amends, or messages that already have the ID
        if (message.startsWith('Merge ')) return;
        if (messageHasIssueId(message)) return;

        writeFileSync(msgfile, prependIssueId(message, issueId));
      } catch {
        // Fail silently — never block a commit
      }
    });

  program
    .command('validate-commit')
    .description('(hook) Warn if commit message has no Linear issue ID')
    .argument('<msgfile>', 'Path to the commit message file')
    .action((msgfile: string) => {
      try {
        const message = readFileSync(msgfile, 'utf-8');

        // Skip merge commits
        if (message.startsWith('Merge ')) return;

        if (!messageHasIssueId(message)) {
          console.error('[swarmcode] Warning: commit message has no Linear issue ID (e.g. ENG-123)');
          console.error('[swarmcode] Tip: use a branch name like feat/ENG-123-description for automatic prefixing');
        }
      } catch {
        // Fail silently
      }
    });

  program
    .command('post-commit')
    .description('(hook) On first commit to a branch, move the linked Linear issue to In Progress')
    .action(async () => {
      try {
        // Only run if Linear is configured
        const { isConfigured, startIssue } = await import('./linear.js');
        if (!isConfigured()) return;

        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf-8',
        }).trim();

        if (branch === 'HEAD') return;

        const issueId = extractIssueId(branch);
        if (!issueId) return;

        // Check if this is the first commit on this branch (only 1 commit ahead of main)
        let mainBranch = 'main';
        try {
          execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { encoding: 'utf-8' });
        } catch {
          try {
            execFileSync('git', ['rev-parse', '--verify', 'origin/master'], { encoding: 'utf-8' });
            mainBranch = 'master';
          } catch {
            return; // Can't determine main branch
          }
        }

        const countOutput = execFileSync(
          'git',
          ['rev-list', '--count', `origin/${mainBranch}..HEAD`],
          { encoding: 'utf-8' },
        ).trim();

        const commitCount = parseInt(countOutput, 10);
        if (commitCount !== 1) return; // Not the first commit

        // First commit on this branch — start the issue in Linear
        const result = await startIssue(issueId);
        if (result.success) {
          console.error(`[swarmcode] ${issueId} → In Progress (assigned to you)`);
        }
      } catch {
        // Fail silently — never block a commit
      }
    });

  program
    .command('dashboard')
    .description('Launch a live web dashboard showing team activity, conflicts, and branches')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .action(async (options) => {
      const { startDashboard } = await import('./dashboard/server.js');
      startDashboard(parseInt(options.port, 10));
    });

  // ---------------------------------------------------------------------------
  // Test harness
  // ---------------------------------------------------------------------------

  const testCmd = program
    .command('test')
    .description('Multi-agent test harness for coordination testing');

  testCmd
    .command('run')
    .description('Run a test scenario with concurrent agents')
    .requiredOption('--scenario <path>', 'Path to scenario YAML file')
    .option('--agents <count>', 'Override agent count from scenario')
    .action(async (options) => {
      const { runScenario } = await import('./test/orchestrator.js');
      const { resolve } = await import('node:path');
      const scenarioPath = resolve(options.scenario);
      try {
        await runScenario(scenarioPath);
      } catch (e: any) {
        console.error(`Test run failed: ${e.message}`);
        process.exitCode = 1;
      }
    });

  testCmd
    .command('list')
    .description('List available test scenarios')
    .action(async () => {
      const { listScenarios } = await import('./test/orchestrator.js');
      const scenarios = listScenarios();
      if (scenarios.length === 0) {
        console.log('No scenarios found in test/scenarios/');
        return;
      }
      console.log('Available scenarios:\n');
      for (const s of scenarios) {
        console.log(`  ${s.name.padEnd(30)} ${s.agents} agents  ${s.description}`);
      }
    });

  testCmd
    .command('cleanup')
    .description('Remove orphaned worktrees and archive stale test issues')
    .action(async () => {
      const { cleanupOrphans } = await import('./test/orchestrator.js');
      const result = await cleanupOrphans();
      console.log(`Cleaned up: ${result.worktreesRemoved} worktree(s), ${result.issuesArchived} issue(s)`);
    });

  testCmd
    .command('report')
    .description('Reprint a past scorecard')
    .argument('<run-id>', 'Run ID to display')
    .action(async (runId: string) => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { formatScorecard } = await import('./test/scorecard.js');
      try {
        const cardPath = join('test', 'results', runId, 'scorecard.json');
        const card = JSON.parse(readFileSync(cardPath, 'utf-8'));
        console.log(formatScorecard(card));
      } catch {
        console.error(`No scorecard found for run: ${runId}`);
        process.exitCode = 1;
      }
    });

  return program;
}
