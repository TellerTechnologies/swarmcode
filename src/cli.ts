import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, getDefaultConfig } from './config.js';
import { VERSION } from './index.js';

export function createCLI(): Command {
  const program = new Command();
  program.name('swarmcode').description('P2P mesh agent for team-aware AI coding').version(VERSION);

  // init command - creates .swarmcode/config.yaml with defaults
  program.command('init')
    .description('Initialize swarmcode in the current project')
    .option('--name <name>', 'Your display name')
    .option('--ai-tool <tool>', 'AI tool to use', 'claude-code')
    .action((options) => {
      const cwd = process.cwd();
      const configDir = join(cwd, '.swarmcode');
      if (existsSync(configDir)) { console.log('.swarmcode/ already exists.'); return; }
      mkdirSync(configDir, { recursive: true });
      const config = getDefaultConfig(options.name);
      if (options.aiTool) config.ai_tool = options.aiTool;
      writeFileSync(join(configDir, 'config.yaml'), stringifyYaml({ ...config }), 'utf-8');
      console.log('Initialized swarmcode in .swarmcode/');
    });

  // start command - starts agent (imports agent.ts dynamically)
  program.command('start')
    .description('Start the swarmcode agent')
    .option('--name <name>', 'Override display name')
    .action(async (options) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      if (options.name) config.name = options.name;
      console.log(`Starting swarmcode as "${config.name}"...`);
      const { SwarmAgent } = await import('./agent.js');
      const agent = new SwarmAgent(cwd, config);
      await agent.start();
      // Keep process alive
      process.on('SIGINT', async () => { try { await agent.stop(); } catch {} process.exit(0); });
      process.on('SIGTERM', async () => { try { await agent.stop(); } catch {} process.exit(0); });
    });

  // Stub commands
  program.command('stop').description('Stop the swarmcode agent').action(() => console.log('Stopping...'));
  program.command('status').description('Show mesh status').action(() => console.log('Status...'));
  program.command('log').description('Stream team activity').action(() => console.log('Log...'));
  program.command('zones').description('Show active work zones').action(() => console.log('Zones...'));

  return program;
}
