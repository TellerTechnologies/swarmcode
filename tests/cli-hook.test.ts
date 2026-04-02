import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
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

const ALL_HOOKS = ['prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push'];

describe('swarmcode hook', () => {
  it('creates all 4 hooks when none exist', () => {
    const output = runHook();

    expect(output).toContain('Installed');
    for (const hook of ALL_HOOKS) {
      const hookPath = join(testDir, '.git', 'hooks', hook);
      expect(existsSync(hookPath)).toBe(true);

      const content = readFileSync(hookPath, 'utf-8');
      expect(content).toContain('#!/bin/sh');
      expect(content).toContain('swarmcode');
    }

    // pre-push should still have git fetch
    const prePush = readFileSync(join(testDir, '.git', 'hooks', 'pre-push'), 'utf-8');
    expect(prePush).toContain('git fetch origin');
  });

  it('makes all hooks executable', () => {
    runHook();

    for (const hook of ALL_HOOKS) {
      const hookPath = join(testDir, '.git', 'hooks', hook);
      const stat = statSync(hookPath);
      const ownerExecute = (stat.mode & 0o100) !== 0;
      expect(ownerExecute).toBe(true);
    }
  });

  it('skips hooks that already contain swarmcode', () => {
    // Pre-install all hooks
    runHook();

    // Run again — should say already installed
    const output = runHook();
    expect(output).toContain('already installed');
  });

  it('warns and does not overwrite existing non-swarmcode hooks', () => {
    const hookPath = join(testDir, '.git', 'hooks', 'pre-push');
    mkdirSync(join(testDir, '.git', 'hooks'), { recursive: true });
    writeFileSync(hookPath, '#!/bin/sh\necho "custom hook"\n');

    const output = runHook();

    // Should skip pre-push but install the other 3
    expect(output).toContain('skip  pre-push');
    expect(output).toContain('added prepare-commit-msg');

    // Should NOT overwrite the custom hook
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
