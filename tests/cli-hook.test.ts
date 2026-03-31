import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

let testDir: string;
let originalCwd: string;

function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf-8' }).trim();
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'swarmcode-hook-'));
  originalCwd = process.cwd();

  // Initialize a real git repo so .git/hooks exists
  gitIn(testDir, ['init', '-b', 'main']);
  gitIn(testDir, ['config', 'user.name', 'Test']);
  gitIn(testDir, ['config', 'user.email', 'test@x.com']);

  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

function runHook(args: string[] = []): string {
  const binPath = join(originalCwd, 'bin', 'swarmcode.ts');
  const tsxPath = join(originalCwd, 'node_modules', '.bin', 'tsx');
  return execFileSync(tsxPath, [binPath, 'hook', ...args], {
    encoding: 'utf-8',
    cwd: testDir,
  });
}

describe('swarmcode hook', () => {
  it('creates pre-push hook when none exists', () => {
    const output = runHook();

    expect(output).toContain('Installed');
    const hookPath = join(testDir, '.git', 'hooks', 'pre-push');
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('#!/bin/sh');
    expect(content).toContain('swarmcode');
    expect(content).toContain('git fetch origin');
  });

  it('makes the hook executable', () => {
    runHook();

    const hookPath = join(testDir, '.git', 'hooks', 'pre-push');
    const stat = statSync(hookPath);
    // Check that the owner-execute bit is set
    const ownerExecute = (stat.mode & 0o100) !== 0;
    expect(ownerExecute).toBe(true);
  });

  it('skips when hook already contains swarmcode', () => {
    const hookPath = join(testDir, '.git', 'hooks', 'pre-push');
    mkdirSync(join(testDir, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\n# Installed by swarmcode\ngit fetch origin 2>/dev/null\n');

    const output = runHook();

    expect(output).toContain('already installed');
  });

  it('warns and does not overwrite when hook exists without swarmcode', () => {
    const hookPath = join(testDir, '.git', 'hooks', 'pre-push');
    mkdirSync(join(testDir, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');

    const output = runHook();

    expect(output).toContain('already exists');
    // Should NOT overwrite
    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('custom hook');
    expect(content).not.toContain('swarmcode');
  });

  it('fails gracefully when not in a git repo', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'swarmcode-nongit-'));
    process.chdir(nonGitDir);

    try {
      const binPath = join(originalCwd, 'bin', 'swarmcode.ts');
      const tsxPath = join(originalCwd, 'node_modules', '.bin', 'tsx');
      const output = execFileSync(tsxPath, [binPath, 'hook'], {
        encoding: 'utf-8',
        cwd: nonGitDir,
      });
      expect(output).toContain('Not a git repository');
    } finally {
      process.chdir(testDir);
    }
  });
});
