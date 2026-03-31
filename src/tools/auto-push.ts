import type { AutoPushResult, AutoPushDisableResult } from '../types.js';
import * as git from '../git.js';

const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastSha: string | null = null;
let pushCount = 0;
let currentInterval = 5;

function tick(): void {
  const branch = git.getCurrentBranch();

  // Skip if detached HEAD or on protected branch
  if (!branch || PROTECTED_BRANCHES.includes(branch)) return;

  const sha = git.getHeadSha();
  if (!sha || sha === lastSha) return;

  // HEAD moved — push
  const hasUpstream = git.getUpstreamBranch() !== null;
  const result = git.push(branch, !hasUpstream);

  if (result.ok) {
    pushCount++;
  } else {
    console.error(`[swarmcode auto-push] push failed: ${result.error}`);
  }

  lastSha = sha;
}

export function enableAutoPush(opts: { interval?: number }): AutoPushResult {
  if (intervalId !== null) {
    const branch = git.getCurrentBranch();
    return {
      enabled: true,
      already_enabled: true,
      branch: branch ?? 'unknown',
      interval: currentInterval,
      protected_branches: PROTECTED_BRANCHES,
    };
  }

  if (!git.hasRemote('origin')) {
    throw new Error('No origin remote found. Auto-push requires a remote named "origin".');
  }

  const branch = git.getCurrentBranch();
  if (!branch) {
    throw new Error('Cannot enable auto-push in detached HEAD state.');
  }

  if (PROTECTED_BRANCHES.includes(branch)) {
    throw new Error(
      `Cannot enable auto-push on protected branch "${branch}". Switch to a feature branch first.`,
    );
  }

  currentInterval = opts.interval ?? 5;
  lastSha = git.getHeadSha();
  pushCount = 0;

  intervalId = setInterval(tick, currentInterval * 1000);

  return {
    enabled: true,
    branch,
    interval: currentInterval,
    protected_branches: PROTECTED_BRANCHES,
  };
}

export function disableAutoPush(): AutoPushDisableResult {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }

  const result: AutoPushDisableResult = { enabled: false, pushes_made: pushCount };

  lastSha = null;
  pushCount = 0;
  currentInterval = 5;

  return result;
}
