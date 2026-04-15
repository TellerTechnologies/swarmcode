import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let testDir: string;
let originalCwd: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'swarmcode-init-'));
  originalCwd = process.cwd();
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

function runInit(args: string[] = []): string {
  const binPath = join(originalCwd, 'bin', 'swarmcode.ts');
  const tsxPath = join(originalCwd, 'node_modules', '.bin', 'tsx');
  return execFileSync(tsxPath, [binPath, 'init', ...args], {
    encoding: 'utf-8',
    cwd: testDir,
  });
}

describe('swarmcode init', () => {
  it('creates CLAUDE.md with snippet when file does not exist', () => {
    const output = runInit();

    expect(output).toContain('Added swarmcode team coordination');
    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('## Team Coordination (Swarmcode)');
    expect(content).toContain('enable_auto_push');
    expect(content).toContain('check_path');
    expect(content).toContain('Recommended Project Structure');
    expect(content).toContain('PLAN.md');
    expect(content).toContain('specs/');
    expect(content).toContain('Multi-Agent Coordination');
    expect(content).toContain('optimistic lock');
  });

  it('creates .mcp.json with swarmcode server for claude-code', () => {
    const output = runInit();

    expect(output).toContain('Configured swarmcode MCP server in .mcp.json');
    const mcpConfig = JSON.parse(readFileSync(join(testDir, '.mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.swarmcode).toEqual({
      command: 'npx',
      args: ['swarmcode'],
    });
  });

  it('merges into existing .mcp.json without overwriting other servers', () => {
    writeFileSync(join(testDir, '.mcp.json'), JSON.stringify({
      mcpServers: { other: { command: 'other-server' } },
    }));

    runInit();

    const mcpConfig = JSON.parse(readFileSync(join(testDir, '.mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.other).toEqual({ command: 'other-server' });
    expect(mcpConfig.mcpServers.swarmcode).toEqual({ command: 'npx', args: ['swarmcode'] });
  });

  it('skips .mcp.json when swarmcode server already configured', () => {
    writeFileSync(join(testDir, '.mcp.json'), JSON.stringify({
      mcpServers: { swarmcode: { command: 'npx', args: ['swarmcode'] } },
    }));

    const output = runInit();

    expect(output).toContain('already configured');
  });

  it('appends to existing CLAUDE.md', () => {
    writeFileSync(join(testDir, 'CLAUDE.md'), '# My Project\n\nExisting content.\n');

    const output = runInit();

    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
    expect(content).toContain('## Team Coordination (Swarmcode)');
  });

  it('skips when swarmcode section already exists', () => {
    writeFileSync(join(testDir, 'CLAUDE.md'), '## Team Coordination (Swarmcode)\n\nAlready here.\n');

    const output = runInit();

    expect(output).toContain('already exists');
  });

  it('writes to .cursorrules when --tool cursor', () => {
    const output = runInit(['--tool', 'cursor']);

    expect(existsSync(join(testDir, '.cursorrules'))).toBe(true);
    const content = readFileSync(join(testDir, '.cursorrules'), 'utf-8');
    expect(content).toContain('## Team Coordination (Swarmcode)');
  });

  it('creates .cursor/mcp.json with swarmcode server for cursor', () => {
    const output = runInit(['--tool', 'cursor']);

    expect(output).toContain('Configured swarmcode MCP server in .cursor/mcp.json');
    const mcpConfig = JSON.parse(readFileSync(join(testDir, '.cursor', 'mcp.json'), 'utf-8'));
    expect(mcpConfig.mcpServers.swarmcode).toEqual({
      command: 'npx',
      args: ['swarmcode'],
    });
  });

  it('writes to .github/copilot-instructions.md when --tool copilot', () => {
    const output = runInit(['--tool', 'copilot']);

    expect(existsSync(join(testDir, '.github', 'copilot-instructions.md'))).toBe(true);
    const content = readFileSync(join(testDir, '.github', 'copilot-instructions.md'), 'utf-8');
    expect(content).toContain('## Team Coordination (Swarmcode)');
  });
});
