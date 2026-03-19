import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, getDefaultConfig } from './config.js';
import { VERSION } from './index.js';

function checkMdns(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createSocket('udp4');
    sock.on('error', () => { sock.close(); resolve(false); });
    sock.bind(5353, () => { sock.close(); resolve(true); });
    setTimeout(() => { try { sock.close(); } catch {} resolve(false); }, 1000);
  });
}

export function createCLI(): Command {
  const program = new Command();
  program.name('swarmcode').description('P2P mesh agent for team-aware AI coding').version(VERSION);

  // init command - creates .swarmcode/config.yaml with defaults
  program.command('init')
    .description('Initialize swarmcode in the current project')
    .option('--name <name>', 'Your display name')
    .option('--ai-tool <tool>', 'AI tool to use', 'claude-code')
    .option('--peers <ips>', 'Comma-separated peer IPs (e.g. 192.168.1.15,192.168.1.20)')
    .option('--git-sync', 'Enable automatic git commit/pull/push')
    .action(async (options) => {
      const cwd = process.cwd();
      const configDir = join(cwd, '.swarmcode');
      if (existsSync(configDir)) { console.log('.swarmcode/ already exists.'); return; }
      mkdirSync(configDir, { recursive: true });
      const config = getDefaultConfig(options.name);
      if (options.aiTool) config.ai_tool = options.aiTool;

      // Parse peers
      if (options.peers) {
        config.peers = options.peers.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      if (options.gitSync) {
        config.git_sync = true;
      }

      writeFileSync(join(configDir, 'config.yaml'), stringifyYaml({ ...config }), 'utf-8');
      console.log('Initialized swarmcode in .swarmcode/');

      // mDNS check
      console.log('\nChecking mDNS discovery...');
      const mdnsOk = await checkMdns();
      if (mdnsOk) {
        console.log('  mDNS is available — peers on your network can be found automatically.');
      } else {
        console.log('  mDNS unavailable (port 5353 in use by another process).');
        console.log('  Swarmcode can still connect to peers directly by IP.');
        console.log('  To diagnose: ss -ulnp | grep 5353');
      }

      // Peer summary
      if (config.peers.length > 0) {
        console.log(`\n  Peers: ${config.peers.join(', ')}`);
      } else {
        console.log('\n  No peers configured. You can add them later in .swarmcode/config.yaml');
        console.log('  or use: swarmcode start --peer <ip>');
      }
    });

  // start command - starts agent (imports agent.ts dynamically)
  program.command('start')
    .description('Start the swarmcode agent')
    .option('--name <name>', 'Override display name')
    .option('--peer <ip>', 'Connect to a peer by IP (repeatable)', (val: string, prev: string[]) => prev.concat(val), [] as string[])
    .option('--git-sync', 'Enable automatic git commit/pull/push')
    .action(async (options) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      if (options.name) config.name = options.name;
      if (options.gitSync) config.git_sync = true;
      // Merge config peers with CLI --peer flags, deduplicate
      const cliPeers: string[] = options.peer ?? [];
      const peers = [...new Set([...config.peers, ...cliPeers])];
      console.log(`Starting swarmcode as "${config.name}"...`);
      const { SwarmAgent } = await import('./agent.js');
      const agent = new SwarmAgent(cwd, config);
      await agent.start(peers);
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
