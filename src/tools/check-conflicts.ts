import type { ConflictReport, ConflictEntry } from '../types.js';
import * as git from '../git.js';

export function checkConflicts(): ConflictReport {
  git.ensureFresh();
  const currentBranch = git.getCurrentBranch();

  // Build set of locally modified files
  const locallyModified = new Set(git.getLocallyModifiedFiles());

  // For each active remote branch (skipping the current branch's remote tracking),
  // collect the files changed on that branch and the branch author.
  const branchData = new Map<string, { files: string[]; author: string | null }>();

  for (const branch of git.getActiveRemoteBranches()) {
    // Skip if this remote branch tracks the current branch (e.g. origin/main when on main)
    if (currentBranch && branch.endsWith(`/${currentBranch}`)) {
      continue;
    }

    const files = git.getFilesChangedOnBranch(currentBranch ?? 'HEAD', branch);
    const author = git.getBranchAuthor(branch);
    branchData.set(branch, { files, author });
  }

  // Build reverse map: file → array of { branch, author } sources
  const fileSourceMap = new Map<string, Array<{ branch: string; author: string | null }>>();

  for (const [branch, { files, author }] of branchData) {
    for (const file of files) {
      const existing = fileSourceMap.get(file);
      if (existing) {
        existing.push({ branch, author });
      } else {
        fileSourceMap.set(file, [{ branch, author }]);
      }
    }
  }

  // Build conflict entries
  const conflicts: ConflictEntry[] = [];

  for (const [file, sources] of fileSourceMap) {
    const isLocal = locallyModified.has(file);
    const branchCount = sources.length;

    if (branchCount >= 2) {
      // File appears on 2+ branches — high severity
      conflicts.push({
        file,
        branches: sources.map(({ branch, author }) => ({ branch, author: author as string })),
        local: isLocal,
        severity: 'high',
      });
    } else if (branchCount === 1 && isLocal) {
      // File is on 1 branch AND locally modified — low severity
      conflicts.push({
        file,
        branches: sources.map(({ branch, author }) => ({ branch, author: author as string })),
        local: true,
        severity: 'low',
      });
    }
  }

  // Generate summary
  let summary: string;
  if (conflicts.length === 0) {
    summary = 'No potential conflicts detected across active branches.';
  } else {
    const highCount = conflicts.filter((c) => c.severity === 'high').length;
    summary = `${conflicts.length} file(s) at risk of conflict (${highCount} high severity).`;
  }

  return { conflicts, summary };
}
