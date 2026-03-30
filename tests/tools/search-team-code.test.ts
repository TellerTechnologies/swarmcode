import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/git.js');
vi.mock('node:fs');

import * as git from '../../src/git.js';
import * as fs from 'node:fs';
import { searchTeamCode } from '../../src/tools/search-team-code.js';

const mockGit = vi.mocked(git);
const mockReadFileSync = vi.mocked(fs.readFileSync);

beforeEach(() => {
  vi.resetAllMocks();
  mockGit.getRepoRoot.mockReturnValue('/repo');
  mockGit.getCurrentBranch.mockReturnValue('main');
  mockGit.getActiveRemoteBranches.mockReturnValue([]);
  mockGit.getLog.mockReturnValue([]);
  mockGit.getLastModifier.mockReturnValue(null);
  mockGit.getFilesChangedOnBranch.mockReturnValue([]);
});

describe('searchTeamCode', () => {
  it('finds matching exports in source files', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'abc1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'feat: add utils',
        files: ['src/utils.ts'],
      },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Alice', timestamp: 1000 });
    mockReadFileSync.mockReturnValue('export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n');

    const result = searchTeamCode({ query: 'format' });

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/utils.ts');
    expect(result[0].name).toBe('formatDate');
    expect(result[0].last_modified_by).toBe('Alice');
    expect(result[0].last_modified_at).toBe(1000);
    expect(result[0].in_flux).toBe(false);
    expect(typeof result[0].signature).toBe('string');
  });

  it('searches all recent files when no path filter', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'a1',
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 2000,
        message: 'chore: add helpers',
        files: ['src/helpers.ts', 'src/auth.ts'],
      },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Bob', timestamp: 2000 });
    mockReadFileSync.mockReturnValue('export function parseToken(token: string): object {\n  return {};\n}\n');

    const result = searchTeamCode({ query: 'parse' });

    // Both files are searched since no path filter
    expect(result.length).toBeGreaterThanOrEqual(2);
    const files = result.map((r) => r.file);
    expect(files).toContain('src/helpers.ts');
    expect(files).toContain('src/auth.ts');
  });

  it('filters by path prefix when path is provided', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'b1',
        author: 'Carol',
        email: 'carol@example.com',
        timestamp: 3000,
        message: 'feat: various',
        files: ['src/api/handler.ts', 'src/utils/formatter.ts', 'tests/api/handler.test.ts'],
      },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Carol', timestamp: 3000 });
    mockReadFileSync.mockReturnValue('export function handleRequest(req: Request): Response {\n  return new Response();\n}\n');

    const result = searchTeamCode({ query: 'handle', path: 'src/api' });

    // Only src/api/handler.ts should be searched (starts with 'src/api')
    expect(result.every((r) => r.file.startsWith('src/api'))).toBe(true);
    const files = result.map((r) => r.file);
    expect(files).not.toContain('src/utils/formatter.ts');
    expect(files).not.toContain('tests/api/handler.test.ts');
  });

  it('marks exports as in_flux when file is on another active branch', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'c1',
        author: 'Dave',
        email: 'dave@example.com',
        timestamp: 4000,
        message: 'feat: add service',
        files: ['src/service.ts'],
      },
    ]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/dave-work']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/service.ts']);
    mockGit.getLastModifier.mockReturnValue({ author: 'Dave', timestamp: 4000 });
    mockReadFileSync.mockReturnValue('export function processData(data: unknown): void {}\n');

    const result = searchTeamCode({ query: 'process' });

    expect(result).toHaveLength(1);
    expect(result[0].in_flux).toBe(true);
  });

  it('returns empty array when no matching exports', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'd1',
        author: 'Eve',
        email: 'eve@example.com',
        timestamp: 5000,
        message: 'feat: add foo',
        files: ['src/foo.ts'],
      },
    ]);
    mockReadFileSync.mockReturnValue('export function doSomething(): void {}\n');

    const result = searchTeamCode({ query: 'zzznomatch' });

    expect(result).toEqual([]);
  });

  it('skips files that cannot be read (readFileSync throws)', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'e1',
        author: 'Frank',
        email: 'frank@example.com',
        timestamp: 6000,
        message: 'feat: add two files',
        files: ['src/readable.ts', 'src/unreadable.ts'],
      },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Frank', timestamp: 6000 });
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      if (typeof filePath === 'string' && filePath.includes('unreadable')) {
        throw new Error('ENOENT: file not found');
      }
      return 'export function fetchData(): Promise<void> {}\n';
    });

    const result = searchTeamCode({ query: 'fetch' });

    // Only the readable file's exports should appear
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('src/readable.ts');
  });

  it('returns empty array when getRepoRoot returns null', () => {
    mockGit.getRepoRoot.mockReturnValue(null);

    const result = searchTeamCode({ query: 'anything' });

    expect(result).toEqual([]);
  });

  it('deduplicates files that appear in multiple commits', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'f1',
        author: 'Grace',
        email: 'grace@example.com',
        timestamp: 1000,
        message: 'first commit',
        files: ['src/shared.ts'],
      },
      {
        hash: 'f2',
        author: 'Grace',
        email: 'grace@example.com',
        timestamp: 2000,
        message: 'second commit',
        files: ['src/shared.ts'],
      },
    ]);
    mockGit.getLastModifier.mockReturnValue({ author: 'Grace', timestamp: 2000 });
    mockReadFileSync.mockReturnValue('export function sharedUtil(): void {}\n');

    const result = searchTeamCode({ query: 'shared' });

    // Should only appear once despite being in two commits
    const files = result.map((r) => r.file);
    const uniqueFiles = new Set(files);
    expect(uniqueFiles.size).toBe(files.length);
    expect(result.filter((r) => r.file === 'src/shared.ts')).toHaveLength(1);
  });

  it('skips non-null remote branches that match current branch', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'g1',
        author: 'Hank',
        email: 'hank@example.com',
        timestamp: 7000,
        message: 'feat: update',
        files: ['src/myfile.ts'],
      },
    ]);
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/main', 'origin/feature/other']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/myfile.ts']);
    mockGit.getLastModifier.mockReturnValue({ author: 'Hank', timestamp: 7000 });
    mockReadFileSync.mockReturnValue('export function myFunc(): void {}\n');

    searchTeamCode({ query: 'myFunc' });

    // Should not call getFilesChangedOnBranch with origin/main (current branch)
    expect(mockGit.getFilesChangedOnBranch).not.toHaveBeenCalledWith(
      expect.anything(),
      'origin/main',
    );
  });

  it('uses empty string for last_modified_by when getLastModifier returns null', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'h1',
        author: 'Ivan',
        email: 'ivan@example.com',
        timestamp: 8000,
        message: 'feat: new',
        files: ['src/newfile.ts'],
      },
    ]);
    mockGit.getLastModifier.mockReturnValue(null);
    mockReadFileSync.mockReturnValue('export function newFunction(): void {}\n');

    const result = searchTeamCode({ query: 'new' });

    expect(result).toHaveLength(1);
    expect(result[0].last_modified_by).toBe('');
    expect(result[0].last_modified_at).toBe(0);
  });
});
