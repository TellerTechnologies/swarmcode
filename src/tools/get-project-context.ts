import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import type { ProjectContextResult, ProjectContextFile } from '../types.js';

const MAX_FILE_SIZE = 50 * 1024; // 50KB per file
const MAX_TOTAL_SIZE = 200 * 1024; // 200KB total output

const DOC_DIRS = ['docs', 'plan', 'plans', 'spec', 'specs'];

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target',
  '__pycache__', '.tox', '.venv', 'vendor',
]);

const DOC_EXTENSIONS = new Set(['.md', '.txt']);

// Special root files that are always checked (even if not .md)
const ROOT_SPECIAL_FILES = [
  'README.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'PLAN.md',
  'plan.md',
];

function scanDir(dir: string, baseDir: string): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      results.push(...scanDir(fullPath, baseDir));
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (!DOC_EXTENSIONS.has(ext)) continue;
      if (stat.size > MAX_FILE_SIZE) continue;
      results.push(relative(baseDir, fullPath));
    }
  }

  return results;
}

export function getProjectContext(opts: {
  path?: string;
  query?: string;
}): ProjectContextResult {
  const cwd = process.cwd();
  const files: ProjectContextFile[] = [];
  let totalSize = 0;
  let truncated = false;

  const seenPaths = new Set<string>();

  function addFile(relativePath: string): void {
    if (truncated) return;
    if (seenPaths.has(relativePath)) return;

    const fullPath = join(cwd, relativePath);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      return;
    }

    if (!stat.isFile()) return;
    if (stat.size > MAX_FILE_SIZE) return;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      return;
    }

    // Apply query filter
    if (opts.query) {
      const q = opts.query.toLowerCase();
      if (!relativePath.toLowerCase().includes(q) && !content.toLowerCase().includes(q)) {
        return;
      }
    }

    if (totalSize + content.length > MAX_TOTAL_SIZE) {
      truncated = true;
      return;
    }

    seenPaths.add(relativePath);
    totalSize += content.length;
    files.push({ path: relativePath, content });
  }

  if (opts.path) {
    // Narrow scan to a specific directory
    const dirPath = join(cwd, opts.path);
    if (existsSync(dirPath)) {
      const scanned = scanDir(dirPath, cwd);
      for (const f of scanned) {
        addFile(f);
      }
    }
  } else {
    // 1. Check special root files
    for (const f of ROOT_SPECIAL_FILES) {
      addFile(f);
    }

    // 2. Scan root-level .md files (catch-all)
    try {
      for (const entry of readdirSync(cwd)) {
        if (SKIP_DIRS.has(entry)) continue;
        const fullPath = join(cwd, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile() && extname(entry).toLowerCase() === '.md') {
            addFile(entry);
          }
        } catch {
          continue;
        }
      }
    } catch {
      // cwd not readable — skip
    }

    // 3. Scan doc directories
    for (const dir of DOC_DIRS) {
      const dirPath = join(cwd, dir);
      if (existsSync(dirPath)) {
        const scanned = scanDir(dirPath, cwd);
        for (const f of scanned) {
          addFile(f);
        }
      }
    }
  }

  return {
    files,
    total_files: files.length,
    truncated,
  };
}
