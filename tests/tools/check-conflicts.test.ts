import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/git.js');

import * as git from '../../src/git.js';
import { checkConflicts } from '../../src/tools/check-conflicts.js';

const mockGit = vi.mocked(git);

beforeEach(() => {
  vi.resetAllMocks();
  mockGit.getCurrentBranch.mockReturnValue('main');
  mockGit.getLocallyModifiedFiles.mockReturnValue([]);
});

describe('checkConflicts', () => {
  it('returns no conflicts when no active remote branches', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue([]);

    const result = checkConflicts();

    expect(result.conflicts).toEqual([]);
    expect(result.summary).toBe('No potential conflicts detected across active branches.');
  });

  it('detects file modified on multiple branches (severity high)', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue([
      'origin/feature/branch-a',
      'origin/feature/branch-b',
    ]);
    mockGit.getFilesChangedOnBranch.mockImplementation((_current, branch) => {
      if (branch === 'origin/feature/branch-a') return ['src/foo.ts', 'src/bar.ts'];
      if (branch === 'origin/feature/branch-b') return ['src/foo.ts', 'src/baz.ts'];
      return [];
    });
    mockGit.getBranchAuthor.mockImplementation((branch) => {
      if (branch === 'origin/feature/branch-a') return 'Alice';
      if (branch === 'origin/feature/branch-b') return 'Bob';
      return null;
    });

    const result = checkConflicts();

    const conflictEntry = result.conflicts.find((c) => c.file === 'src/foo.ts');
    expect(conflictEntry).toBeDefined();
    expect(conflictEntry!.severity).toBe('high');
    expect(conflictEntry!.branches).toHaveLength(2);
    expect(conflictEntry!.branches).toContainEqual({ branch: 'origin/feature/branch-a', author: 'Alice' });
    expect(conflictEntry!.branches).toContainEqual({ branch: 'origin/feature/branch-b', author: 'Bob' });
    expect(conflictEntry!.local).toBe(false);
  });

  it('flags local modifications that overlap with remote branches (severity low)', () => {
    mockGit.getLocallyModifiedFiles.mockReturnValue(['src/foo.ts']);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/branch-a']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts', 'src/bar.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Charlie');

    const result = checkConflicts();

    const conflictEntry = result.conflicts.find((c) => c.file === 'src/foo.ts');
    expect(conflictEntry).toBeDefined();
    expect(conflictEntry!.severity).toBe('low');
    expect(conflictEntry!.local).toBe(true);
    expect(conflictEntry!.branches).toHaveLength(1);
    expect(conflictEntry!.branches[0]).toEqual({ branch: 'origin/feature/branch-a', author: 'Charlie' });
  });

  it('skips current branch remote tracking (origin/main skipped when on main)', () => {
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getActiveRemoteBranches.mockReturnValue([
      'origin/main',
      'origin/feature/other',
    ]);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    checkConflicts();

    // origin/main should be skipped — getFilesChangedOnBranch should not be called with it
    expect(mockGit.getFilesChangedOnBranch).not.toHaveBeenCalledWith(
      expect.anything(),
      'origin/main',
    );
    // But it should be called for origin/feature/other
    expect(mockGit.getFilesChangedOnBranch).toHaveBeenCalledWith(
      expect.anything(),
      'origin/feature/other',
    );
  });

  it('generates a human-readable summary with counts', () => {
    mockGit.getActiveRemoteBranches.mockReturnValue([
      'origin/feature/branch-a',
      'origin/feature/branch-b',
    ]);
    // branch-a and branch-b both modify foo.ts (high severity)
    mockGit.getFilesChangedOnBranch.mockImplementation((_current, branch) => {
      if (branch === 'origin/feature/branch-a') return ['src/foo.ts'];
      if (branch === 'origin/feature/branch-b') return ['src/foo.ts'];
      return [];
    });
    mockGit.getBranchAuthor.mockReturnValue('Dev');

    const result = checkConflicts();

    expect(result.conflicts).toHaveLength(1);
    expect(result.summary).toBe('1 file(s) at risk of conflict (1 high severity).');
  });

  it('does not flag files only on one branch with no local changes', () => {
    mockGit.getLocallyModifiedFiles.mockReturnValue([]);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/branch-a']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/only-remote.ts']);
    mockGit.getBranchAuthor.mockReturnValue('Alice');

    const result = checkConflicts();

    expect(result.conflicts).toHaveLength(0);
    expect(result.summary).toBe('No potential conflicts detected across active branches.');
  });

  it('handles getBranchAuthor returning null gracefully', () => {
    mockGit.getLocallyModifiedFiles.mockReturnValue(['src/foo.ts']);
    mockGit.getActiveRemoteBranches.mockReturnValue(['origin/feature/branch-a']);
    mockGit.getFilesChangedOnBranch.mockReturnValue(['src/foo.ts']);
    mockGit.getBranchAuthor.mockReturnValue(null);

    const result = checkConflicts();

    const conflictEntry = result.conflicts.find((c) => c.file === 'src/foo.ts');
    expect(conflictEntry).toBeDefined();
    expect(conflictEntry!.branches[0].author).toBeNull();
  });

  it('summary reflects correct high count with mix of low and high severity', () => {
    mockGit.getLocallyModifiedFiles.mockReturnValue(['src/local-only.ts']);
    mockGit.getActiveRemoteBranches.mockReturnValue([
      'origin/feature/branch-a',
      'origin/feature/branch-b',
    ]);
    mockGit.getFilesChangedOnBranch.mockImplementation((_current, branch) => {
      if (branch === 'origin/feature/branch-a') return ['src/shared.ts', 'src/local-only.ts'];
      if (branch === 'origin/feature/branch-b') return ['src/shared.ts'];
      return [];
    });
    mockGit.getBranchAuthor.mockImplementation((branch) => {
      if (branch === 'origin/feature/branch-a') return 'Alice';
      if (branch === 'origin/feature/branch-b') return 'Bob';
      return null;
    });

    const result = checkConflicts();

    const highEntries = result.conflicts.filter((c) => c.severity === 'high');
    const lowEntries = result.conflicts.filter((c) => c.severity === 'low');
    expect(highEntries).toHaveLength(1); // src/shared.ts
    expect(highEntries[0].file).toBe('src/shared.ts');
    expect(lowEntries).toHaveLength(1);  // src/local-only.ts
    expect(lowEntries[0].file).toBe('src/local-only.ts');
    expect(result.summary).toBe('2 file(s) at risk of conflict (1 high severity).');
  });
});
