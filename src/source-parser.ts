/**
 * source-parser.ts – Regex-based export search.
 *
 * Designed for search: given a query string, find exported symbols whose
 * name contains the query (case-insensitive substring match).
 */

export interface ExportSearchResult {
  name: string;
  signature: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a file path's extension to a language key.
 * Returns null for unrecognised extensions.
 */
export function detectLanguage(filePath: string): string | null {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return null;
  const ext = filePath.slice(dotIdx).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    default:
      return null;
  }
}

/**
 * Search for exported symbols whose name matches query (case-insensitive
 * substring match).
 */
export function searchExports(
  code: string,
  language: string,
  query: string,
): ExportSearchResult[] {
  if (!code) return [];

  switch (language) {
    case 'typescript':
    case 'javascript':
      return searchJsTs(code, query);
    case 'python':
      return searchPython(code, query);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Case-insensitive substring check. */
function matchesQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.toLowerCase());
}

/**
 * Trim a raw source line to a clean, readable signature.
 *
 * - Removes trailing `{` and any body that follows.
 * - For functions: keeps up to and including the closing `)`.
 * - For const/let/var/type: keeps up to (but not including) the `=`.
 */
function cleanSignature(raw: string, kind: string, _name: string): string {
  // Remove trailing '{ ...' (body)
  let sig = raw.replace(/\s*\{.*$/, '').trim();

  if (kind === 'function') {
    const parenClose = sig.lastIndexOf(')');
    if (parenClose !== -1) {
      sig = sig.slice(0, parenClose + 1).trim();
    }
  } else if (kind === 'const' || kind === 'let' || kind === 'var' || kind === 'type') {
    const eq = sig.indexOf('=');
    if (eq !== -1) {
      sig = sig.slice(0, eq).trim();
    }
  }

  return sig;
}

/** JS/TS export search – returns results matching query. */
function searchJsTs(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // 1. export default function/class <name>
  const defaultNamedRe =
    /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm;
  for (const m of code.matchAll(defaultNamedRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      const startIdx = m.index ?? 0;
      const lineEnd = code.indexOf('\n', startIdx);
      const rawLine = lineEnd === -1 ? code.slice(startIdx) : code.slice(startIdx, lineEnd);
      const sig = cleanSignature(rawLine, 'function', name);
      results.push({ name, signature: sig || m[0].trim() });
    }
  }

  // 2. export [declare] [async] function|class|interface|type|const|let|var <name>
  const namedRe =
    /^export\s+(?:declare\s+)?(?!default)(?:async\s+)?(function|class|interface|type|const|let|var)\s+(\w+)/gm;
  for (const m of code.matchAll(namedRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      const startIdx = m.index ?? 0;
      const lineEnd = code.indexOf('\n', startIdx);
      const rawLine = lineEnd === -1 ? code.slice(startIdx) : code.slice(startIdx, lineEnd);
      const sig = cleanSignature(rawLine, kind, name);
      results.push({ name, signature: sig || `export ${kind} ${name}` });
    }
  }

  return results;
}

/** Python export search – top-level def/class only, filtered by query. */
function searchPython(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // Only top-level definitions: lines that start with def/class (no indent)
  const defClassRe = /^(def|class)\s+(\w+)([^:\n]*)/gm;
  for (const m of code.matchAll(defClassRe)) {
    const kind = m[1];
    const name = m[2];
    const rest = m[3].trim();
    if (matchesQuery(name, query)) {
      const signature = kind === 'def' ? `def ${name}${rest}` : `class ${name}${rest}`;
      results.push({ name, signature });
    }
  }

  return results;
}
