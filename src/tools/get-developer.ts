import type { DeveloperProfile } from '../types.js';
import * as git from '../git.js';

/**
 * Exact case-insensitive match first, then substring match.
 * Returns null if no match.
 */
function fuzzyMatchAuthor(query: string, authors: string[]): string | null {
  const lower = query.toLowerCase();

  // Exact case-insensitive match
  const exact = authors.find((a) => a.toLowerCase() === lower);
  if (exact !== undefined) return exact;

  // Substring match
  const substring = authors.find((a) => a.toLowerCase().includes(lower));
  if (substring !== undefined) return substring;

  return null;
}

/**
 * Count directory occurrences (everything before the last '/') across all
 * provided file paths and return the top 5 by frequency. Files without a
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

export function getDeveloper(params: { name: string }): DeveloperProfile {
  const authors = git.getAllAuthors();
  const resolvedName = fuzzyMatchAuthor(params.name, authors);

  // No match: return empty profile with queried name
  if (resolvedName === null) {
    return {
      name: params.name,
      recent_commits: [],
      active_branches: [],
      work_areas: [],
      files: [],
    };
  }

  const commits = git.getLog({ all: true, since: '7d', author: resolvedName });

  // Collect all files across commits
  const allFiles: string[] = [];
  for (const commit of commits) {
    allFiles.push(...commit.files);
  }

  // Unique files (preserving order of first occurrence)
  const seen = new Set<string>();
  const uniqueFiles: string[] = [];
  for (const file of allFiles) {
    if (!seen.has(file)) {
      seen.add(file);
      uniqueFiles.push(file);
    }
  }

  // Active branches where this developer is the author
  const activeBranches = git
    .getActiveRemoteBranches()
    .filter((branch) => git.getBranchAuthor(branch) === resolvedName);

  const workAreas = inferWorkAreas(allFiles);

  const recentCommits = commits.map((c) => ({
    hash: c.hash,
    message: c.message,
    timestamp: c.timestamp,
    files: c.files,
  }));

  return {
    name: resolvedName,
    recent_commits: recentCommits,
    active_branches: activeBranches,
    work_areas: workAreas,
    files: uniqueFiles,
  };
}
