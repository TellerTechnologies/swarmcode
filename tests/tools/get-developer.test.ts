import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/git.js');

import * as git from '../../src/git.js';
import { getDeveloper } from '../../src/tools/get-developer.js';

const mockGetAllAuthors = vi.mocked(git.getAllAuthors);
const mockGetLog = vi.mocked(git.getLog);
const mockGetActiveRemoteBranches = vi.mocked(git.getActiveRemoteBranches);
const mockGetBranchAuthor = vi.mocked(git.getBranchAuthor);

beforeEach(() => {
  vi.resetAllMocks();
  mockGetAllAuthors.mockReturnValue([]);
  mockGetLog.mockReturnValue([]);
  mockGetActiveRemoteBranches.mockReturnValue([]);
  mockGetBranchAuthor.mockReturnValue(null);
});

describe('getDeveloper', () => {
  it('returns developer profile with commits and work areas', () => {
    mockGetAllAuthors.mockReturnValue(['Alice Johnson', 'Bob Smith']);
    mockGetLog.mockReturnValue([
      {
        hash: 'abc1',
        author: 'Alice Johnson',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'feat: add login',
        files: ['src/auth/login.ts', 'src/auth/session.ts'],
      },
      {
        hash: 'abc2',
        author: 'Alice Johnson',
        email: 'alice@example.com',
        timestamp: 2000,
        message: 'fix: session bug',
        files: ['src/auth/session.ts', 'src/utils/format.ts'],
      },
    ]);
    mockGetActiveRemoteBranches.mockReturnValue(['origin/feature/alice-login', 'origin/main']);
    mockGetBranchAuthor.mockImplementation((branch) => {
      if (branch === 'origin/feature/alice-login') return 'Alice Johnson';
      return null;
    });

    const result = getDeveloper({ name: 'Alice Johnson' });

    expect(result.name).toBe('Alice Johnson');
    expect(result.recent_commits).toHaveLength(2);
    expect(result.recent_commits[0].hash).toBe('abc1');
    expect(result.recent_commits[0].message).toBe('feat: add login');
    expect(result.recent_commits[0].timestamp).toBe(1000);
    expect(result.recent_commits[0].files).toEqual(['src/auth/login.ts', 'src/auth/session.ts']);
    expect(result.active_branches).toContain('origin/feature/alice-login');
    expect(result.active_branches).not.toContain('origin/main');
    expect(result.work_areas).toContain('src/auth');
    expect(result.work_areas[0]).toBe('src/auth'); // most frequent
  });

  it('fuzzy matches author name with case-insensitive substring', () => {
    mockGetAllAuthors.mockReturnValue(['Alice Johnson', 'Bob Smith']);
    mockGetLog.mockReturnValue([
      {
        hash: 'abc1',
        author: 'Alice Johnson',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'feat: thing',
        files: ['src/foo.ts'],
      },
    ]);

    const result = getDeveloper({ name: 'alice' });

    expect(result.name).toBe('Alice Johnson');
    expect(mockGetLog).toHaveBeenCalledWith({ all: true, since: '7d', author: 'Alice Johnson' });
  });

  it('fuzzy matches with exact case-insensitive match taking priority', () => {
    mockGetAllAuthors.mockReturnValue(['alice', 'alice johnson']);
    mockGetLog.mockReturnValue([]);

    const result = getDeveloper({ name: 'ALICE' });

    // Exact case-insensitive match "alice" should win over substring match "alice johnson"
    expect(result.name).toBe('alice');
  });

  it('returns empty profile when no author matches', () => {
    mockGetAllAuthors.mockReturnValue(['Alice Johnson', 'Bob Smith']);

    const result = getDeveloper({ name: 'Carol' });

    expect(result.name).toBe('Carol');
    expect(result.recent_commits).toEqual([]);
    expect(result.active_branches).toEqual([]);
    expect(result.work_areas).toEqual([]);
    expect(result.files).toEqual([]);
  });

  it('deduplicates files across commits', () => {
    mockGetAllAuthors.mockReturnValue(['Alice Johnson']);
    mockGetLog.mockReturnValue([
      {
        hash: 'abc1',
        author: 'Alice Johnson',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'first commit',
        files: ['src/auth/login.ts', 'src/utils/format.ts'],
      },
      {
        hash: 'abc2',
        author: 'Alice Johnson',
        email: 'alice@example.com',
        timestamp: 2000,
        message: 'second commit',
        files: ['src/auth/login.ts', 'src/auth/session.ts'],
      },
    ]);

    const result = getDeveloper({ name: 'Alice Johnson' });

    // login.ts appears in both commits but should only appear once in files
    const loginCount = result.files.filter((f) => f === 'src/auth/login.ts').length;
    expect(loginCount).toBe(1);
    expect(result.files).toContain('src/utils/format.ts');
    expect(result.files).toContain('src/auth/session.ts');
  });

  it('calls getLog with correct author and since params', () => {
    mockGetAllAuthors.mockReturnValue(['Bob Smith']);

    getDeveloper({ name: 'Bob Smith' });

    expect(mockGetLog).toHaveBeenCalledWith({ all: true, since: '7d', author: 'Bob Smith' });
  });

  it('includes all branches where getBranchAuthor matches resolved name', () => {
    mockGetAllAuthors.mockReturnValue(['Bob Smith']);
    mockGetLog.mockReturnValue([
      {
        hash: 'b1',
        author: 'Bob Smith',
        email: 'bob@example.com',
        timestamp: 1000,
        message: 'work',
        files: ['src/x.ts'],
      },
    ]);
    mockGetActiveRemoteBranches.mockReturnValue([
      'origin/feature/bob-auth',
      'origin/feature/bob-fix',
      'origin/feature/alice-login',
    ]);
    mockGetBranchAuthor.mockImplementation((branch) => {
      if (branch.includes('bob')) return 'Bob Smith';
      if (branch.includes('alice')) return 'Alice Johnson';
      return null;
    });

    const result = getDeveloper({ name: 'Bob Smith' });

    expect(result.active_branches).toContain('origin/feature/bob-auth');
    expect(result.active_branches).toContain('origin/feature/bob-fix');
    expect(result.active_branches).not.toContain('origin/feature/alice-login');
  });

  it('returns top 5 work areas at most', () => {
    mockGetAllAuthors.mockReturnValue(['Alice Johnson']);
    const files: string[] = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        files.push(`area${i}/file${j}.ts`);
      }
    }
    mockGetLog.mockReturnValue([
      {
        hash: 'a1',
        author: 'Alice Johnson',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'big commit',
        files,
      },
    ]);

    const result = getDeveloper({ name: 'Alice Johnson' });

    expect(result.work_areas.length).toBeLessThanOrEqual(5);
  });

  it('returns empty profile with queried name when no authors exist', () => {
    mockGetAllAuthors.mockReturnValue([]);

    const result = getDeveloper({ name: 'Unknown Dev' });

    expect(result.name).toBe('Unknown Dev');
    expect(result.recent_commits).toEqual([]);
    expect(result.files).toEqual([]);
  });
});
