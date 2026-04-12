import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as cp from 'node:child_process';

vi.mock('node:child_process');
const mockExecFileSync = vi.mocked(cp.execFileSync);

// Import after mock setup
import {
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

  it('strips surrounding whitespace from the path', () => {
    mockExecFileSync.mockReturnValue('  /home/user/project  \n' as any);
    expect(getRepoRoot()).toBe('/home/user/project');
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
