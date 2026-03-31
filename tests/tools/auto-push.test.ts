import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/git.js');

import * as git from '../../src/git.js';
import { enableAutoPush, disableAutoPush } from '../../src/tools/auto-push.js';

const mockGit = vi.mocked(git);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  // Ensure clean state — disable if previously enabled
  disableAutoPush();
});

afterEach(() => {
  disableAutoPush();
  vi.useRealTimers();
});

describe('enableAutoPush', () => {
  it('returns enabled state with branch and interval', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    const result = enableAutoPush({});

    expect(result).toEqual({
      enabled: true,
      branch: 'feat/auth',
      interval: 30,
      protected_branches: ['main', 'master', 'develop'],
    });
  });

  it('accepts custom interval', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    const result = enableAutoPush({ interval: 10 });

    expect(result.interval).toBe(10);
  });

  it('returns already_enabled when called twice', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({});
    const result = enableAutoPush({});

    expect(result.already_enabled).toBe(true);
  });

  it('throws when no origin remote', () => {
    mockGit.hasRemote.mockReturnValue(false);

    expect(() => enableAutoPush({})).toThrow('No origin remote found');
  });

  it('throws when on protected branch', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('main');

    expect(() => enableAutoPush({})).toThrow('Cannot enable auto-push on protected branch');
  });

  it('throws when on master', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('master');

    expect(() => enableAutoPush({})).toThrow('Cannot enable auto-push on protected branch');
  });

  it('throws when in detached HEAD', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue(null);

    expect(() => enableAutoPush({})).toThrow('Cannot enable auto-push in detached HEAD');
  });

  it('pushes when HEAD changes on interval tick', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue('origin/feat/auth');
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // HEAD changes
    mockGit.getHeadSha.mockReturnValue('def456');
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).toHaveBeenCalledWith('feat/auth', false);
  });

  it('uses -u flag when no upstream exists', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/new');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue(null);
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // HEAD changes
    mockGit.getHeadSha.mockReturnValue('def456');
    mockGit.getCurrentBranch.mockReturnValue('feat/new');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).toHaveBeenCalledWith('feat/new', true);
  });

  it('does not push when HEAD has not changed', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({ interval: 5 });

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('skips push when branch switches to protected branch', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({ interval: 5 });

    // Branch switches to main, HEAD changes
    mockGit.getCurrentBranch.mockReturnValue('main');
    mockGit.getHeadSha.mockReturnValue('def456');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).not.toHaveBeenCalled();
  });

  it('adapts when branch switches to another feature branch', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue('origin/feat/other');
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // Switch to different feature branch, HEAD changes
    mockGit.getCurrentBranch.mockReturnValue('feat/other');
    mockGit.getHeadSha.mockReturnValue('def456');

    vi.advanceTimersByTime(5000);

    expect(mockGit.push).toHaveBeenCalledWith('feat/other', false);
  });
});

describe('disableAutoPush', () => {
  it('returns pushes_made count', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');
    mockGit.getUpstreamBranch.mockReturnValue('origin/feat/auth');
    mockGit.push.mockReturnValue({ ok: true });

    enableAutoPush({ interval: 5 });

    // Trigger 2 pushes
    mockGit.getHeadSha.mockReturnValue('sha1');
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    vi.advanceTimersByTime(5000);

    mockGit.getHeadSha.mockReturnValue('sha2');
    vi.advanceTimersByTime(5000);

    const result = disableAutoPush();

    expect(result).toEqual({ enabled: false, pushes_made: 2 });
  });

  it('returns zero pushes when nothing was pushed', () => {
    const result = disableAutoPush();

    expect(result).toEqual({ enabled: false, pushes_made: 0 });
  });

  it('stops the interval', () => {
    mockGit.hasRemote.mockReturnValue(true);
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');
    mockGit.getHeadSha.mockReturnValue('abc123');

    enableAutoPush({ interval: 5 });
    disableAutoPush();

    // HEAD changes after disable
    mockGit.getHeadSha.mockReturnValue('def456');
    mockGit.getCurrentBranch.mockReturnValue('feat/auth');

    vi.advanceTimersByTime(10000);

    expect(mockGit.push).not.toHaveBeenCalled();
  });
});
