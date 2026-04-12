import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as cp from 'node:child_process';

vi.mock('node:child_process');
const mockExecFileSync = vi.mocked(cp.execFileSync);

// Import after mock setup
import {
  ensureFresh,
  getRepoRoot,
  getCurrentUser,
  getCurrentBranch,
  getLog,
  getActiveRemoteBranches,
  getMergeBase,
  getFilesChangedOnBranch,
  getLocallyModifiedFiles,
  getBranchAuthor,
  getAllAuthors,
  getLastModifier,
  getStatusForPath,
} from '../src/git.js';
import * as git from '../src/git.js';

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// ensureFresh
// ---------------------------------------------------------------------------
describe('ensureFresh', () => {
  // Each test uses a unique, widely-spaced timestamp (in ms) to avoid
  // interference from the module-level `lastFetchTimestamp` that persists
  // across tests.  Date.now() returns milliseconds; ensureFresh divides by
  // 1000 to get seconds internally.

  it('runs git fetch --all --prune when data is stale', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(100_000_000_000);
    mockExecFileSync.mockReturnValue('' as any);

    expect(ensureFresh()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['fetch', '--all', '--prune'],
      expect.objectContaining({ timeout: 15_000 }),
    );
    spy.mockRestore();
  });

  it('skips fetch when called again within the default staleness window', () => {
    // First call sets lastFetchTimestamp = 200_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(200_000_000_000);
    mockExecFileSync.mockReturnValue('' as any);
    ensureFresh();

    // Second call 10s later — within the 30s default window
    mockExecFileSync.mockClear();
    spy.mockReturnValue(200_000_010_000);

    expect(ensureFresh()).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('fetches again after the staleness window expires', () => {
    // First call sets lastFetchTimestamp = 300_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(300_000_000_000);
    mockExecFileSync.mockReturnValue('' as any);
    ensureFresh();

    // Second call 31s later — past the 30s default window
    mockExecFileSync.mockClear();
    spy.mockReturnValue(300_000_031_000);
    mockExecFileSync.mockReturnValue('' as any);

    expect(ensureFresh()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['fetch', '--all', '--prune'],
      expect.objectContaining({ timeout: 15_000 }),
    );
    spy.mockRestore();
  });

  it('returns false when git fetch fails (e.g. no network)', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(400_000_000_000);
    mockExecFileSync.mockImplementation(() => {
      throw new Error('network error');
    });

    expect(ensureFresh()).toBe(false);
    spy.mockRestore();
  });

  it('does not update timestamp on failure so the next call retries', () => {
    // Successful fetch sets lastFetchTimestamp = 500_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(500_000_000_000);
    mockExecFileSync.mockReturnValue('' as any);
    ensureFresh();

    // 31s later: fetch fails — timestamp should NOT update
    spy.mockReturnValue(500_000_031_000);
    mockExecFileSync.mockImplementation(() => {
      throw new Error('network error');
    });
    ensureFresh();

    // 1s after failure: still stale relative to last *success* (32s > 30s)
    mockExecFileSync.mockClear();
    mockExecFileSync.mockReturnValue('' as any);
    spy.mockReturnValue(500_000_032_000);

    expect(ensureFresh()).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('respects a custom staleness threshold', () => {
    // Successful fetch with 5s threshold sets lastFetchTimestamp = 600_000_000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(600_000_000_000);
    mockExecFileSync.mockReturnValue('' as any);
    ensureFresh(5);

    // 3s later — within the 5s custom window
    mockExecFileSync.mockClear();
    spy.mockReturnValue(600_000_003_000);
    expect(ensureFresh(5)).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();

    // 6s after original fetch — past the 5s custom window
    spy.mockReturnValue(600_000_006_000);
    mockExecFileSync.mockReturnValue('' as any);
    expect(ensureFresh(5)).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getRepoRoot
// ---------------------------------------------------------------------------
describe('getRepoRoot', () => {
  it('returns trimmed repo root path', () => {
    mockExecFileSync.mockReturnValue('/home/user/project\n' as any);
    expect(getRepoRoot()).toBe('/home/user/project');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--show-toplevel'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null on error (not a git repo)', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(getRepoRoot()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCurrentUser
// ---------------------------------------------------------------------------
describe('getCurrentUser', () => {
  it('returns trimmed user name', () => {
    mockExecFileSync.mockReturnValue('Jane Doe\n' as any);
    expect(getCurrentUser()).toBe('Jane Doe');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['config', 'user.name'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('no config');
    });
    expect(getCurrentUser()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCurrentBranch
// ---------------------------------------------------------------------------
describe('getCurrentBranch', () => {
  it('returns branch name', () => {
    mockExecFileSync.mockReturnValue('main\n' as any);
    expect(getCurrentBranch()).toBe('main');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null when output is HEAD (detached)', () => {
    mockExecFileSync.mockReturnValue('HEAD\n' as any);
    expect(getCurrentBranch()).toBeNull();
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('error');
    });
    expect(getCurrentBranch()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLog
// ---------------------------------------------------------------------------
describe('getLog', () => {
  // Must match the COMMIT_SEP constant in git.ts
  const SEP = '---SWARMCODE_COMMIT---';
  const commit1Header = 'abc123|Alice|alice@example.com|1700000000|Fix bug';
  const commit2Header = 'def456|Bob|bob@example.com|1700001000|Add feature';

  it('parses multi-commit log with files', () => {
    // Simulate the sentinel-delimited format that git.ts now produces:
    // each commit begins with SEP+header, followed by blank line + files
    const output = [
      SEP + commit1Header,
      '',
      'src/foo.ts',
      'src/bar.ts',
      SEP + commit2Header,
      '',
      'lib/baz.ts',
      '',
    ].join('\n');
    mockExecFileSync.mockReturnValue(output as any);

    const result = getLog({});
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      hash: 'abc123',
      author: 'Alice',
      email: 'alice@example.com',
      timestamp: 1700000000,
      message: 'Fix bug',
      files: ['src/foo.ts', 'src/bar.ts'],
    });
    expect(result[1]).toEqual({
      hash: 'def456',
      author: 'Bob',
      email: 'bob@example.com',
      timestamp: 1700001000,
      message: 'Add feature',
      files: ['lib/baz.ts'],
    });
  });

  it('returns empty array for empty output', () => {
    mockExecFileSync.mockReturnValue('' as any);
    expect(getLog({})).toEqual([]);
  });

  it('passes --all flag when opts.all is true', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLog({ all: true });
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--all');
  });

  it('passes --since flag', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLog({ since: '1 week ago' });
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--since=1 week ago');
  });

  it('passes --author flag', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLog({ author: 'Alice' });
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--author=Alice');
  });

  it('passes -- path when opts.path is set', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLog({ path: 'src/foo.ts' });
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--');
    expect(args).toContain('src/foo.ts');
  });

  it('does not pass --all when opts.all is false', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLog({ all: false });
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).not.toContain('--all');
  });

  it('handles commit with no files', () => {
    const output = [SEP + commit1Header, ''].join('\n');
    mockExecFileSync.mockReturnValue(output as any);
    const result = getLog({});
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getActiveRemoteBranches
// ---------------------------------------------------------------------------
describe('getActiveRemoteBranches', () => {
  it('parses and returns trimmed branch names', () => {
    const output = '  origin/main\n  origin/feature-x\n  origin/HEAD -> origin/main\n';
    mockExecFileSync.mockReturnValue(output as any);
    const result = getActiveRemoteBranches();
    expect(result).toEqual(['origin/main', 'origin/feature-x']);
    expect(result).not.toContain(expect.stringContaining('->'));
  });

  it('returns empty array on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('error');
    });
    expect(getActiveRemoteBranches()).toEqual([]);
  });

  it('filters out HEAD pointer lines', () => {
    const output = '  origin/HEAD -> origin/main\n  origin/main\n';
    mockExecFileSync.mockReturnValue(output as any);
    const result = getActiveRemoteBranches();
    expect(result).toEqual(['origin/main']);
    expect(result).not.toContain(expect.stringContaining('HEAD'));
  });
});

// ---------------------------------------------------------------------------
// getMergeBase
// ---------------------------------------------------------------------------
describe('getMergeBase', () => {
  it('returns commit hash', () => {
    mockExecFileSync.mockReturnValue('deadbeef1234\n' as any);
    expect(getMergeBase('main', 'feature')).toBe('deadbeef1234');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['merge-base', 'main', 'feature'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('no merge base');
    });
    expect(getMergeBase('main', 'feature')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFilesChangedOnBranch
// ---------------------------------------------------------------------------
describe('getFilesChangedOnBranch', () => {
  it('calls merge-base then diff, returns file list', () => {
    mockExecFileSync
      .mockReturnValueOnce('basecommit\n' as any) // merge-base
      .mockReturnValueOnce('src/a.ts\nsrc/b.ts\n' as any); // diff

    const result = getFilesChangedOnBranch('feature', 'origin/main');
    expect(result).toEqual(['src/a.ts', 'src/b.ts']);

    // First call: merge-base
    expect(mockExecFileSync.mock.calls[0][1]).toContain('merge-base');
    // Second call: diff with base..remoteBranch
    const diffArgs = mockExecFileSync.mock.calls[1][1] as string[];
    expect(diffArgs).toContain('--name-only');
    expect(diffArgs.some((a) => a.includes('basecommit'))).toBe(true);
  });

  it('returns empty array when merge-base fails', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('no merge base');
    });
    expect(getFilesChangedOnBranch('feature', 'origin/main')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLocallyModifiedFiles
// ---------------------------------------------------------------------------
describe('getLocallyModifiedFiles', () => {
  it('parses porcelain output and returns file paths', () => {
    const output = ' M src/foo.ts\nA  src/new.ts\n?? src/untracked.ts\n';
    mockExecFileSync.mockReturnValue(output as any);
    const result = getLocallyModifiedFiles();
    expect(result).toEqual(['src/foo.ts', 'src/new.ts', 'src/untracked.ts']);
  });

  it('returns empty array for clean working tree', () => {
    mockExecFileSync.mockReturnValue('' as any);
    expect(getLocallyModifiedFiles()).toEqual([]);
  });

  it('passes path argument when provided', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLocallyModifiedFiles('src/');
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).toContain('--');
    expect(args).toContain('src/');
  });

  it('does not include -- path when no path provided', () => {
    mockExecFileSync.mockReturnValue('' as any);
    getLocallyModifiedFiles();
    const args = mockExecFileSync.mock.calls[0][1] as string[];
    expect(args).not.toContain('--');
  });
});

// ---------------------------------------------------------------------------
// getBranchAuthor
// ---------------------------------------------------------------------------
describe('getBranchAuthor', () => {
  it('returns author name for branch', () => {
    mockExecFileSync.mockReturnValue('Alice\n' as any);
    expect(getBranchAuthor('feature-x')).toBe('Alice');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '-1', '--format=%an', 'feature-x'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('unknown branch');
    });
    expect(getBranchAuthor('nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAllAuthors
// ---------------------------------------------------------------------------
describe('getAllAuthors', () => {
  it('returns deduplicated array of author names', () => {
    const output = 'Alice\nBob\nAlice\nCharlie\nBob\n';
    mockExecFileSync.mockReturnValue(output as any);
    const result = getAllAuthors();
    expect(result).toHaveLength(3);
    expect(result).toContain('Alice');
    expect(result).toContain('Bob');
    expect(result).toContain('Charlie');
  });

  it('filters out empty lines', () => {
    mockExecFileSync.mockReturnValue('\nAlice\n\nBob\n' as any);
    const result = getAllAuthors();
    expect(result).toHaveLength(2);
  });

  it('returns empty array on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('error');
    });
    expect(getAllAuthors()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLastModifier
// ---------------------------------------------------------------------------
describe('getLastModifier', () => {
  it('returns author and timestamp for a file', () => {
    mockExecFileSync.mockReturnValue('Alice|1700000000\n' as any);
    const result = getLastModifier('src/foo.ts');
    expect(result).toEqual({ author: 'Alice', timestamp: 1700000000 });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '-1', '--format=%an|%at', '--', 'src/foo.ts'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('error');
    });
    expect(getLastModifier('src/foo.ts')).toBeNull();
  });

  it('returns null when output is empty', () => {
    mockExecFileSync.mockReturnValue('' as any);
    expect(getLastModifier('src/foo.ts')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getStatusForPath
// ---------------------------------------------------------------------------
describe('getStatusForPath', () => {
  it('returns file paths for given path', () => {
    const output = ' M src/foo.ts\nA  src/bar.ts\n';
    mockExecFileSync.mockReturnValue(output as any);
    const result = getStatusForPath('src/');
    expect(result).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain', '--', 'src/'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('returns empty array for no changes', () => {
    mockExecFileSync.mockReturnValue('' as any);
    expect(getStatusForPath('src/')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getMainBranch
// ---------------------------------------------------------------------------
describe('getMainBranch', () => {
  it('returns origin/main when remote has origin/main', () => {
    mockExecFileSync.mockReturnValue('  origin/main\n  origin/develop\n' as any);
    expect(git.getMainBranch()).toBe('origin/main');
  });

  it('returns origin/master when remote has origin/master but not origin/main', () => {
    mockExecFileSync.mockReturnValueOnce('  origin/master\n  origin/develop\n' as any);
    expect(git.getMainBranch()).toBe('origin/master');
  });

  it('falls back to local main when no remote branches match', () => {
    mockExecFileSync
      .mockReturnValueOnce('  origin/develop\n' as any)  // git branch -r (no main/master)
      .mockReturnValueOnce('* main\n  feature-x\n' as any);  // git branch (local)
    expect(git.getMainBranch()).toBe('main');
  });

  it('falls back to local master when no remote or local main', () => {
    mockExecFileSync
      .mockReturnValueOnce('  origin/develop\n' as any)  // git branch -r
      .mockReturnValueOnce('* master\n  feature-x\n' as any);  // git branch
    expect(git.getMainBranch()).toBe('master');
  });

  it('returns HEAD when no main or master branch exists', () => {
    mockExecFileSync
      .mockReturnValueOnce('  origin/develop\n' as any)  // git branch -r
      .mockReturnValueOnce('* feature-x\n  develop\n' as any);  // git branch
    expect(git.getMainBranch()).toBe('HEAD');
  });

  it('returns HEAD when all git commands fail', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not a repo'); });
    expect(git.getMainBranch()).toBe('HEAD');
  });
});

describe('getHeadSha', () => {
  it('returns the current HEAD sha', () => {
    mockExecFileSync.mockReturnValue('abc123def456\n');
    const result = git.getHeadSha();
    expect(result).toBe('abc123def456');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['rev-parse', 'HEAD'], expect.any(Object),
    );
  });

  it('returns null on error', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('not a repo'); });
    expect(git.getHeadSha()).toBeNull();
  });
});

describe('hasRemote', () => {
  it('returns true when origin exists', () => {
    mockExecFileSync.mockReturnValue('origin\n');
    expect(git.hasRemote('origin')).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['remote'], expect.any(Object),
    );
  });

  it('returns false when origin does not exist', () => {
    mockExecFileSync.mockReturnValue('upstream\n');
    expect(git.hasRemote('origin')).toBe(false);
  });

  it('returns false on error', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('fail'); });
    expect(git.hasRemote('origin')).toBe(false);
  });
});

describe('getUpstreamBranch', () => {
  it('returns upstream branch when set', () => {
    mockExecFileSync.mockReturnValue('origin/feat/auth\n');
    expect(git.getUpstreamBranch()).toBe('origin/feat/auth');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], expect.any(Object),
    );
  });

  it('returns null when no upstream', () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('no upstream'); });
    expect(git.getUpstreamBranch()).toBeNull();
  });
});

describe('push', () => {
  it('pushes with -u when setUpstream is true', () => {
    mockExecFileSync.mockReturnValue('');
    const result = git.push('feat/auth', true);
    expect(result.ok).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['push', '-u', 'origin', 'feat/auth'], expect.any(Object),
    );
  });

  it('pushes without -u when setUpstream is false', () => {
    mockExecFileSync.mockReturnValue('');
    const result = git.push('feat/auth', false);
    expect(result.ok).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['push', 'origin', 'feat/auth'], expect.any(Object),
    );
  });

  it('returns error message on failure', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('rejected') as any;
      err.stderr = 'Updates were rejected because the remote contains work';
      throw err;
    });
    const result = git.push('feat/auth', false);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('rejected');
  });
});
