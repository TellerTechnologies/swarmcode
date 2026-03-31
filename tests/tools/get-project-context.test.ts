import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let testDir: string;
let originalCwd: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'swarmcode-context-'));
  originalCwd = process.cwd();
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
});

// Helper to create files in the test directory
function createFile(relativePath: string, content: string): void {
  const fullPath = join(testDir, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

// Dynamic import to pick up cwd at call time
async function getModule() {
  // Clear module cache to pick up new cwd
  const mod = await import('../../src/tools/get-project-context.js');
  return mod;
}

describe('getProjectContext', () => {
  it('returns README.md from root', async () => {
    createFile('README.md', '# My Project');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('README.md');
    expect(result.files[0].content).toBe('# My Project');
    expect(result.truncated).toBe(false);
  });

  it('returns CLAUDE.md from root', async () => {
    createFile('CLAUDE.md', '# Instructions');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'CLAUDE.md')).toBe(true);
  });

  it('returns .cursorrules from root', async () => {
    createFile('.cursorrules', 'rules here');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === '.cursorrules')).toBe(true);
  });

  it('returns AGENTS.md from root', async () => {
    createFile('AGENTS.md', '# Agents config');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'AGENTS.md')).toBe(true);
  });

  it('scans docs/ directory', async () => {
    createFile('docs/architecture.md', '# Architecture');
    createFile('docs/design.md', '# Design');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'docs/architecture.md')).toBe(true);
    expect(result.files.some(f => f.path === 'docs/design.md')).toBe(true);
  });

  it('scans specs/ directory', async () => {
    createFile('specs/auth-design.md', '# Auth');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'specs/auth-design.md')).toBe(true);
  });

  it('scans plan/ directory', async () => {
    createFile('plan/sprint-1.md', '# Sprint 1');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'plan/sprint-1.md')).toBe(true);
  });

  it('scans plans/ directory', async () => {
    createFile('plans/roadmap.md', '# Roadmap');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'plans/roadmap.md')).toBe(true);
  });

  it('scans spec/ directory', async () => {
    createFile('spec/api.md', '# API Spec');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'spec/api.md')).toBe(true);
  });

  it('includes .txt files', async () => {
    createFile('docs/notes.txt', 'some notes');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'docs/notes.txt')).toBe(true);
  });

  it('excludes non-md/txt files in doc directories', async () => {
    createFile('docs/script.js', 'console.log("hi")');
    createFile('docs/readme.md', '# Readme');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'docs/script.js')).toBe(false);
    expect(result.files.some(f => f.path === 'docs/readme.md')).toBe(true);
  });

  it('skips files over 50KB', async () => {
    const bigContent = 'x'.repeat(51 * 1024);
    createFile('docs/huge.md', bigContent);
    createFile('docs/small.md', '# Small');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'docs/huge.md')).toBe(false);
    expect(result.files.some(f => f.path === 'docs/small.md')).toBe(true);
  });

  it('filters by path when provided', async () => {
    createFile('docs/auth.md', '# Auth');
    createFile('specs/api.md', '# API');
    createFile('README.md', '# Project');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({ path: 'specs' });
    expect(result.files.every(f => f.path.startsWith('specs/'))).toBe(true);
  });

  it('filters by query when provided', async () => {
    createFile('docs/auth.md', '# Authentication System');
    createFile('docs/billing.md', '# Billing System');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({ query: 'authentication' });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('docs/auth.md');
  });

  it('query matches file path too', async () => {
    createFile('docs/auth-design.md', '# Some content');
    createFile('docs/billing.md', '# Billing');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({ query: 'auth' });
    expect(result.files.some(f => f.path === 'docs/auth-design.md')).toBe(true);
  });

  it('returns empty when no docs exist', async () => {
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files).toHaveLength(0);
    expect(result.total_files).toBe(0);
  });

  it('truncates when total content exceeds 200KB', async () => {
    // Create multiple files that together exceed 200KB
    for (let i = 0; i < 10; i++) {
      createFile(`docs/file${i}.md`, 'x'.repeat(25 * 1024)); // 25KB each = 250KB total
    }
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.truncated).toBe(true);
    // Should have fewer than 10 files
    expect(result.total_files).toBeLessThan(10);
  });

  it('scans .github/copilot-instructions.md', async () => {
    createFile('.github/copilot-instructions.md', '# Copilot rules');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === '.github/copilot-instructions.md')).toBe(true);
  });

  it('returns root-level .md files', async () => {
    createFile('CONTRIBUTING.md', '# Contributing');
    createFile('CHANGELOG.md', '# Changelog');
    const { getProjectContext } = await getModule();
    const result = getProjectContext({});
    expect(result.files.some(f => f.path === 'CONTRIBUTING.md')).toBe(true);
    expect(result.files.some(f => f.path === 'CHANGELOG.md')).toBe(true);
  });
});
