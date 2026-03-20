import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, getDefaultConfig } from './config.js';
import { VERSION } from './index.js';

export function createCLI(): Command {
  const program = new Command();
  program.name('swarmcode').description('Team-aware AI coding via git').version(VERSION);

  program.command('init')
    .description('Initialize swarmcode in the current project')
    .option('--name <name>', 'Your display name')
    .option('--ai-tool <tool>', 'AI tool to use', 'claude-code')
    .action((options) => {
      const cwd = process.cwd();
      const configDir = join(cwd, '.swarmcode');
      const peersDir = join(configDir, 'peers');
      if (existsSync(configDir)) {
        console.log('.swarmcode/ already exists.');
        return;
      }
      mkdirSync(peersDir, { recursive: true });
      const config = getDefaultConfig(options.name);
      if (options.aiTool) config.ai_tool = options.aiTool;
      writeFileSync(join(configDir, 'config.yaml'), stringifyYaml({ ...config }), 'utf-8');
      console.log('Initialized swarmcode in .swarmcode/');
      console.log(`\nMake sure .swarmcode/peers/ is committed to git.`);
      console.log(`Add your context file (${config.context_file}) to .gitignore.`);
    });

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
      process.on('SIGINT', async () => { try { await agent.stop(); } catch {} process.exit(0); });
      process.on('SIGTERM', async () => { try { await agent.stop(); } catch {} process.exit(0); });
    });

  program.command('status')
    .description('Show who is working on what')
    .action(async () => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const { ManifestReader } = await import('./manifest/reader.js');
      const reader = new ManifestReader(cwd, config.name);
      const peers = reader.readPeers();
      if (peers.length === 0) {
        console.log('No peers found. Is anyone else running swarmcode?');
        return;
      }
      for (const peer of peers) {
        console.log(`${peer.dev_name} (${peer.status}) — ${peer.work_zone || 'no zone'}`);
        for (const [path] of peer.files) {
          console.log(`  ${path}`);
        }
      }
    });

  return program;
}
