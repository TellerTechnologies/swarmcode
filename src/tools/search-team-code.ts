import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExportMatch } from '../types.js';
import * as git from '../git.js';
import { searchExports, detectLanguage } from '../source-parser.js';

export function searchTeamCode(params: { query: string; path?: string }): ExportMatch[] {
  git.ensureFresh();

  // 1. Get repo root — return empty array if null
  const repoRoot = git.getRepoRoot();
  if (!repoRoot) return [];

  // 2. Get current branch
  const currentBranch = git.getCurrentBranch();

  // 3. Get recently active files from log (all branches, last 7 days)
  const commits = git.getLog({ all: true, since: '7d' });
  const uniqueFiles = new Set<string>();
  for (const commit of commits) {
    for (const file of commit.files) {
      // If path filter is set, only include files starting with that path
      if (params.path !== undefined) {
        if (file === params.path || file.startsWith(params.path + '/')) {
          uniqueFiles.add(file);
        }
      } else {
        uniqueFiles.add(file);
      }
    }
  }

  // 4. Build a map of files changed on remote branches (other than current branch)
  const branchFileMap = new Map<string, Set<string>>();
  for (const branch of git.getActiveRemoteBranches()) {
    // Skip the current branch
    if (currentBranch && branch.endsWith(`/${currentBranch}`)) {
      continue;
    }
    const changedFiles = git.getFilesChangedOnBranch(currentBranch ?? 'HEAD', branch);
    branchFileMap.set(branch, new Set(changedFiles));
  }

  // 5. For each unique file, search for exports matching the query (local files)
  const results: ExportMatch[] = [];
  // Track file+name combos found locally for deduplication against branch results
  const localKeys = new Set<string>();

  for (const file of uniqueFiles) {
    // Detect language — skip if not recognised
    const language = detectLanguage(file);
    if (!language) continue;

    // Read file contents — skip on error
    let code: string;
    try {
      code = readFileSync(join(repoRoot, file), 'utf-8');
    } catch {
      continue;
    }

    // Search for matching exports
    const matches = searchExports(code, language, params.query);
    if (matches.length === 0) continue;

    // Get last modifier
    const lastModifier = git.getLastModifier(file);
    const last_modified_by = lastModifier?.author ?? '';
    const last_modified_at = lastModifier?.timestamp ?? 0;

    // Determine in_flux: file is on any remote branch
    const in_flux = [...branchFileMap.values()].some((fileSet) => fileSet.has(file));

    // Create an ExportMatch for each matching export
    for (const match of matches) {
      localKeys.add(`${file}:${match.name}`);
      results.push({
        file,
        name: match.name,
        signature: match.signature,
        last_modified_by,
        last_modified_at,
        in_flux,
      });
    }
  }

  // 6. Search files on remote branches that aren't available locally
  for (const [branch, changedFiles] of branchFileMap) {
    for (const file of changedFiles) {
      // Apply path filter
      if (params.path !== undefined) {
        if (file !== params.path && !file.startsWith(params.path + '/')) {
          continue;
        }
      }

      // Detect language — skip if not recognised
      const language = detectLanguage(file);
      if (!language) continue;

      // Read file contents from the remote branch
      const code = git.getFileFromBranch(branch, file);
      if (!code) continue;

      // Search for matching exports
      const matches = searchExports(code, language, params.query);
      if (matches.length === 0) continue;

      for (const match of matches) {
        // Deduplicate: skip if we already found this file+name locally
        const key = `${file}:${match.name}`;
        if (localKeys.has(key)) continue;

        // Mark as found so subsequent branches don't duplicate
        localKeys.add(key);

        results.push({
          file,
          name: match.name,
          signature: match.signature,
          last_modified_by: '',
          last_modified_at: 0,
          in_flux: true,
          branch,
        });
      }
    }
  }

  return results;
}
