import type { AuthorActivity } from '../types.js';
import * as git from '../git.js';

/**
 * Counts directory occurrences (everything before the last '/') across all
 * provided file paths and returns the top 5 by frequency. Files without a
 * directory separator are skipped.
 */
function inferWorkAreas(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const lastSlash = file.lastIndexOf('/');
    if (lastSlash === -1) continue;
    const dir = file.slice(0, lastSlash);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir]) => dir);
}

export function getTeamActivity(params: { since: string }): AuthorActivity[] {
  const currentUser = git.getCurrentUser();
  const commits = git.getLog({ all: true, since: params.since });
  const activeBranches = git.getActiveRemoteBranches();

  // Group commits by author, excluding current user
  const byAuthor = new Map<string, typeof commits>();
  for (const commit of commits) {
    if (commit.author === currentUser) continue;
    const existing = byAuthor.get(commit.author);
    if (existing) {
      existing.push(commit);
    } else {
      byAuthor.set(commit.author, [commit]);
    }
  }

  const results: AuthorActivity[] = [];

  for (const [author, authorCommits] of byAuthor) {
    // Collect active branches for this author
    const authorBranches = activeBranches.filter(
      (branch) => git.getBranchAuthor(branch) === author,
    );

    // Collect all files across commits
    const allFiles: string[] = [];
    for (const commit of authorCommits) {
      allFiles.push(...commit.files);
    }

    // Infer work areas from files
    const workAreas = inferWorkAreas(allFiles);

    // Collect unique recent files (up to 20)
    const seen = new Set<string>();
    const recentFiles: string[] = [];
    for (const file of allFiles) {
      if (seen.has(file)) continue;
      seen.add(file);
      recentFiles.push(file);
      if (recentFiles.length >= 20) break;
    }

    // last_active = max timestamp
    const lastActive = Math.max(...authorCommits.map((c) => c.timestamp));

    // recent_commits: up to 5, with message and timestamp
    const recentCommits = authorCommits.slice(0, 5).map((c) => ({
      message: c.message,
      timestamp: c.timestamp,
    }));

    results.push({
      name: author,
      active_branches: authorBranches,
      work_areas: workAreas,
      recent_files: recentFiles,
      last_active: lastActive,
      recent_commits: recentCommits,
    });
  }

  // Sort by last_active descending
  results.sort((a, b) => b.last_active - a.last_active);

  return results;
}
