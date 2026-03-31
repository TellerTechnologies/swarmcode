import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/git.js');

import * as git from '../../src/git.js';
import { getTeamActivity } from '../../src/tools/get-team-activity.js';

const mockGetCurrentUser = vi.mocked(git.getCurrentUser);
const mockGetLog = vi.mocked(git.getLog);
const mockGetActiveRemoteBranches = vi.mocked(git.getActiveRemoteBranches);
const mockGetBranchAuthor = vi.mocked(git.getBranchAuthor);

beforeEach(() => {
  vi.resetAllMocks();
  mockGetCurrentUser.mockReturnValue('Jared');
  mockGetLog.mockReturnValue([]);
  mockGetActiveRemoteBranches.mockReturnValue([]);
  mockGetBranchAuthor.mockReturnValue(null);
});

describe('getTeamActivity', () => {
  it('returns empty array when no commits exist', () => {
    mockGetLog.mockReturnValue([]);
    const result = getTeamActivity({ since: '7 days ago' });
    expect(result).toEqual([]);
  });

  it('groups commits by author and excludes current user', () => {
    mockGetCurrentUser.mockReturnValue('Jared');
    mockGetLog.mockReturnValue([
      {
        hash: 'abc1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'fix: bug',
        files: ['src/auth/login.ts'],
      },
      {
        hash: 'abc2',
        author: 'Jared',
        email: 'jared@example.com',
        timestamp: 2000,
        message: 'feat: new feature',
        files: ['src/app.ts'],
      },
      {
        hash: 'abc3',
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 3000,
        message: 'chore: cleanup',
        files: ['src/utils/helper.ts'],
      },
    ]);

    const result = getTeamActivity({ since: '7 days ago' });

    const names = result.map((a) => a.name);
    expect(names).not.toContain('Jared');
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  it('infers work areas from file paths (top directory before last slash)', () => {
    mockGetLog.mockReturnValue([
      {
        hash: 'a1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'feat: auth',
        files: [
          'src/auth/login.ts',
          'src/auth/logout.ts',
          'src/auth/session.ts',
          'src/utils/format.ts',
          'src/auth/token.ts',
        ],
      },
    ]);

    const result = getTeamActivity({ since: '7 days ago' });

    expect(result).toHaveLength(1);
    const alice = result[0];
    // src/auth has 4 occurrences, src/utils has 1
    expect(alice.work_areas[0]).toBe('src/auth');
    expect(alice.work_areas).toContain('src/utils');
  });

  it('returns top 5 work areas at most', () => {
    const files: string[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        files.push(`area${i}/file${j}.ts`);
      }
    }
    mockGetLog.mockReturnValue([
      {
        hash: 'b1',
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 2000,
        message: 'work',
        files,
      },
    ]);

    const result = getTeamActivity({ since: '7 days ago' });
    expect(result[0].work_areas.length).toBeLessThanOrEqual(5);
  });

  it('collects active branches per author via getBranchAuthor', () => {
    mockGetLog.mockReturnValue([
      {
        hash: 'c1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'feat',
        files: ['src/foo.ts'],
      },
    ]);
    mockGetActiveRemoteBranches.mockReturnValue([
      'origin/feature/alice-login',
      'origin/feature/alice-signup',
      'origin/feature/bob-fix',
    ]);
    mockGetBranchAuthor.mockImplementation((branch) => {
      if (branch.includes('alice')) return 'Alice';
      if (branch.includes('bob')) return 'Bob';
      return null;
    });

    const result = getTeamActivity({ since: '7 days ago' });

    const alice = result.find((a) => a.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice!.active_branches).toContain('origin/feature/alice-login');
    expect(alice!.active_branches).toContain('origin/feature/alice-signup');
    expect(alice!.active_branches).not.toContain('origin/feature/bob-fix');
  });

  it('collects unique recent_files up to 20', () => {
    const files: string[] = [];
    for (let i = 0; i < 25; i++) {
      files.push(`src/file${i}.ts`);
    }
    mockGetLog.mockReturnValue([
      {
        hash: 'd1',
        author: 'Carol',
        email: 'carol@example.com',
        timestamp: 5000,
        message: 'big commit',
        files,
      },
    ]);

    const result = getTeamActivity({ since: '7 days ago' });

    expect(result[0].recent_files.length).toBeLessThanOrEqual(20);
    // All entries should be unique
    const unique = new Set(result[0].recent_files);
    expect(unique.size).toBe(result[0].recent_files.length);
  });

  it('captures last_active as maximum timestamp across commits', () => {
    mockGetLog.mockReturnValue([
      {
        hash: 'e1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'first',
        files: ['src/a.ts'],
      },
      {
        hash: 'e2',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 9999,
        message: 'latest',
        files: ['src/b.ts'],
      },
      {
        hash: 'e3',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 5000,
        message: 'middle',
        files: ['src/c.ts'],
      },
    ]);

    const result = getTeamActivity({ since: '7 days ago' });
    expect(result[0].last_active).toBe(9999);
  });

  it('includes up to 5 recent_commits per author', () => {
    const commits = Array.from({ length: 8 }, (_, i) => ({
      hash: `f${i}`,
      author: 'Dave',
      email: 'dave@example.com',
      timestamp: i * 100,
      message: `commit ${i}`,
      files: ['src/x.ts'],
    }));
    mockGetLog.mockReturnValue(commits);

    const result = getTeamActivity({ since: '7 days ago' });
    expect(result[0].recent_commits.length).toBeLessThanOrEqual(5);
    // Each entry has message and timestamp
    for (const c of result[0].recent_commits) {
      expect(c).toHaveProperty('message');
      expect(c).toHaveProperty('timestamp');
    }
  });

  it('sorts authors by last_active descending', () => {
    mockGetLog.mockReturnValue([
      {
        hash: 'g1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'old',
        files: ['src/a.ts'],
      },
      {
        hash: 'g2',
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 5000,
        message: 'newer',
        files: ['src/b.ts'],
      },
      {
        hash: 'g3',
        author: 'Carol',
        email: 'carol@example.com',
        timestamp: 3000,
        message: 'middle',
        files: ['src/c.ts'],
      },
    ]);

    const result = getTeamActivity({ since: '7 days ago' });
    expect(result[0].name).toBe('Bob');
    expect(result[1].name).toBe('Carol');
    expect(result[2].name).toBe('Alice');
  });

  it('handles file paths without a slash (top-level files)', () => {
    mockGetLog.mockReturnValue([
      {
        hash: 'h1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'root file',
        files: ['README.md', 'package.json'],
      },
    ]);

    // Should not throw; top-level files have no directory
    const result = getTeamActivity({ since: '7 days ago' });
    expect(result).toHaveLength(1);
  });

  it('passes since param to getLog with all:true', () => {
    getTeamActivity({ since: '14 days ago' });
    expect(mockGetLog).toHaveBeenCalledWith({ all: true, since: '14 days ago' });
  });
});
