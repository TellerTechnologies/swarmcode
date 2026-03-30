import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/git.js');

import * as git from '../../src/git.js';
import { checkPath } from '../../src/tools/check-path.js';

const mockGit = vi.mocked(git);

beforeEach(() => {
  vi.resetAllMocks();
  mockGit.getCurrentBranch.mockReturnValue('main');
  mockGit.getActiveRemoteBranches.mockReturnValue([]);
  mockGit.getStatusForPath.mockReturnValue([]);
});

describe('checkPath', () => {
  it('returns safe when no recent authors and no pending changes', () => {
    mockGit.getLog.mockReturnValue([]);

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.recent_authors).toEqual([]);
    expect(result.primary_owner).toBeNull();
    expect(result.pending_changes).toEqual([]);
    expect(result.locally_modified).toBe(false);
    expect(result.risk).toBe('safe');
    expect(typeof result.risk_reason).toBe('string');
  });

  it('identifies primary owner from recent commits (Alice with 2 commits > Bob with 1)', () => {
    mockGit.getLog.mockReturnValue([
      {
        hash: 'a1',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 2000,
        message: 'feat: update foo',
        files: ['src/foo.ts'],
      },
      {
        hash: 'a2',
        author: 'Bob',
        email: 'bob@example.com',
        timestamp: 1500,
        message: 'fix: fix foo',
        files: ['src/foo.ts'],
      },
      {
        hash: 'a3',
        author: 'Alice',
        email: 'alice@example.com',
        timestamp: 1000,
        message: 'chore: refactor foo',
        files: ['src/foo.ts'],
      },
    ]);

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.primary_owner).toBe('Alice');
    expect(result.recent_authors).toHaveLength(2);
    // Alice should be first (2 commits)
    expect(result.recent_authors[0].name).toBe('Alice');
    expect(result.recent_authors[0].commit_count).toBe(2);
    expect(result.recent_authors[1].name).toBe('Bob');
    expect(result.recent_authors[1].commit_count).toBe(1);
    // last_commit should be the most recent for each author
    expect(result.recent_authors[0].last_commit).toBe(2000);
    expect(result.recent_authors[1].last_commit).toBe(1500);
  });

  it('returns caution when one branch has changes to this path', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/foo-update']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts', 'src/bar.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Charlie');

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.pending_changes).toHaveLength(1);
    expect(result.pending_changes[0].branch).toBe('origin/feature/foo-update');
    expect(result.pending_changes[0].author).toBe('Charlie');
    expect(result.risk).toBe('caution');
  });

  it('returns conflict_likely when multiple branches modify the path', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue([
      'origin/feature/branch-a',
      'origin/feature/branch-b',
    ]);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts']);
    mockGit.getBranchAuthor.mockImplementation((branch) => {
      if (branch === 'origin/feature/branch-a') return 'Alice';
      if (branch === 'origin/feature/branch-b') return 'Bob';
      return null;
    });

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.pending_changes).toHaveLength(2);
    expect(result.risk).toBe('conflict_likely');
  });

  it('detects locally modified files', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getStatusForPath.mockReturnValue(['src/foo.ts']);

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.locally_modified).toBe(true);
  });

  it('skips current branch in remote branch check (origin/main skipped when on main)', () => {
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue([
      'origin/main',
      'origin/feature/other',
    ]);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    const result = checkPath({ path: 'src/foo.ts' });

    // origin/main should be skipped, only origin/feature/other checked
    expect(result.pending_changes).toHaveLength(1);
    expect(result.pending_changes[0].branch).toBe('origin/feature/other');
    // getFilesChangedOnBranch should not be called with origin/main
    expect(mockGit.getFilesChangedOnBranch).not.toHaveBeenCalledWith(
      expect.anything(),
      'origin/main',
    );
  });

  it('matches path as directory prefix (files inside directory)', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/dir-change']);
    mockGit.getFilesChangedOnBranch.mockReturnValue([
      'src/components/Button.ts',
      'src/components/Input.ts',
      'src/utils/helper.ts',
    ]);
    mockGit.getBranchAuthor.mockReturnValue('Dave');

    const result = checkPath({ path: 'src/components' });

    expect(result.pending_changes).toHaveLength(1);
    expect(result.pending_changes[0].branch).toBe('origin/feature/dir-change');
    expect(result.pending_changes[0].files).toContain('src/components/Button.ts');
    expect(result.pending_changes[0].files).toContain('src/components/Input.ts');
    expect(result.pending_changes[0].files).not.toContain('src/utils/helper.ts');
  });

  it('does not include pending change when branch has no matching files', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/unrelated']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/bar.ts', 'src/baz.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Eve');

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.pending_changes).toHaveLength(0);
    expect(result.risk).toBe('safe');
  });

  it('uses getBranchAuthor return value (null) gracefully', () => {
    mockGit.getLog.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/anon']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts']);
    mockGit.getBranchAuthor.mockReturnValue(null);

    const result = checkPath({ path: 'src/foo.ts' });

    expect(result.pending_changes).toHaveLength(1);
    expect(result.pending_changes[0].author).toBe('unknown');
  });
});
