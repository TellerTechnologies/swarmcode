import type { AutoPushResult, AutoPushDisableResult } from '../types.js';
import * as git from '../git.js';
import { autoProgress, autoReview } from '../auto-linear.js';

const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

let intervalId: ReturnType<typeof setInterval> | null = null;
let reviewIntervalId: ReturnType<typeof setInterval> | null = null;
let lastSha: string | null = null;
let pushCount = 0;
let currentInterval = 5;

function tick(): void {
  const branch = git.getCurrentBranch();

  // Skip if detached HEAD or on protected branch
  if (!branch || PROTECTED_BRANCHES.includes(branch)) return;

  const sha = git.getHeadSha();
  if (!sha || sha === lastSha) return;

  const previousSha = lastSha;

  // HEAD moved — push
  const hasUpstream = git.getUpstreamBranch() !== null;
  const result = git.push(branch, !hasUpstream);

  if (result.ok) {
    pushCount++;

    // Auto-progress: post batched commit summaries to Linear
    if (previousSha) {
      autoProgress(previousSha).catch(() => {
        // Best-effort — don't block the push loop
      });
    }
  } else {
    console.error(`[swarmcode auto-push] push failed: ${result.error}`);
  }

  lastSha = sha;
}

/**
 * Separate tick for review detection — runs independently of commit/push
 * activity so that PR creation (which doesn't change HEAD) still triggers
 * the "In Review" transition.
 */
function reviewTick(): void {
  const branch = git.getCurrentBranch();
  if (!branch || PROTECTED_BRANCHES.includes(branch)) return;

  autoReview().catch(() => {
    // Best-effort — don't block the review loop
  });
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

  currentInterval = opts.interval ?? 30;
  lastSha = git.getHeadSha();
  pushCount = 0;

  intervalId = setInterval(tick, currentInterval * 1000);

  // Review polling runs on a longer interval (60s) — cheap check (gh pr view + Linear read)
  // and decoupled from push activity so PR creation triggers "In Review" even without new commits
  if (!reviewIntervalId) {
    reviewIntervalId = setInterval(reviewTick, 60 * 1000);
  }

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
  if (reviewIntervalId !== null) {
    clearInterval(reviewIntervalId);
    reviewIntervalId = null;
  }

  const result: AutoPushDisableResult = { enabled: false, pushes_made: pushCount };

  lastSha = null;
  pushCount = 0;
  currentInterval = 5;

  return result;
}
