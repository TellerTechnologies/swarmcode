import type { PathCheckResult, PathAuthor, PendingChange, RiskLevel } from '../types.js';
import * as git from '../git.js';

export function checkPath(params: { path: string }): PathCheckResult {
  const currentBranch = git.getCurrentBranch();

  // Get recent commits for this path
  const commits = git.getLog({ all: true, since: '7d', path: params.path });

  // Build author map: count occurrences per author and track latest timestamp
  const authorMap = new Map<string, { commit_count: number; last_commit: number }>();
  for (const commit of commits) {
    const existing = authorMap.get(commit.author);
    if (existing) {
      existing.commit_count += 1;
      if (commit.timestamp > existing.last_commit) {
        existing.last_commit = commit.timestamp;
      }
    } else {
      authorMap.set(commit.author, {
        commit_count: 1,
        last_commit: commit.timestamp,
      });
    }
  }

  // Convert to PathAuthor[] sorted by commit_count descending
  const recent_authors: PathAuthor[] = [...authorMap.entries()]
    .map(([name, data]) => ({ name, commit_count: data.commit_count, last_commit: data.last_commit }))
    .sort((a, b) => b.commit_count - a.commit_count);

  // Primary owner = first author (most commits) or null if none
  const primary_owner = recent_authors.length > 0 ? recent_authors[0].name : null;

  // Check remote branches for pending changes
  const pending_changes: PendingChange[] = [];
  const remoteBranches = git.getActiveRemoteBranches();

  for (const branch of remoteBranches) {
    // Skip if this branch ends with /<currentBranch>
    if (currentBranch && branch.endsWith(`/${currentBranch}`)) {
      continue;
    }

    const changedFiles = git.getFilesChangedOnBranch(currentBranch ?? 'HEAD', branch);

    // Filter to files that equal params.path OR start with params.path + '/'
    const matchingFiles = changedFiles.filter(
      (file) => file === params.path || file.startsWith(params.path + '/'),
    );

    if (matchingFiles.length > 0) {
      pending_changes.push({
        branch,
        author: git.getBranchAuthor(branch),
        files: matchingFiles,
      });
    }
  }

  // Check local modifications
  const statusFiles = git.getStatusForPath(params.path);
  const locally_modified = statusFiles.length > 0;

  // Compute risk
  let risk: RiskLevel;
  let risk_reason: string;

  if (pending_changes.length >= 2) {
    risk = 'conflict_likely';
    risk_reason = `${pending_changes.length} remote branches are modifying this path — merge conflicts are likely`;
  } else if (pending_changes.length === 1) {
    risk = 'caution';
    risk_reason = `1 remote branch (${pending_changes[0].branch}) has pending changes to this path`;
  } else {
    risk = 'safe';
    risk_reason = 'No pending changes from other branches detected';
  }

  return {
    recent_authors,
    primary_owner,
    pending_changes,
    locally_modified,
    risk,
    risk_reason,
  };
}
