/**
 * FastExtractor – Tier 1 intent extractor using regex patterns.
 *
 * Tree-sitter native modules fail to compile on Node v24, so this
 * implementation uses regex as the documented fallback.  The public
 * API is identical to what a tree-sitter implementation would expose
 * so it can be swapped in later without touching call-sites.
 */

import type { ExportEntry } from '../types.js';

export interface ExtractionResult {
  exports: ExportEntry[];
  imports: string[];
}

export class FastExtractor {
  // ────────────────────────────────────────────────────────
  // Static helpers
  // ────────────────────────────────────────────────────────

  /**
   * Map a file path's extension to a language key.
   * Returns null for unrecognised extensions.
   */
  static detectLanguage(filePath: string): string | null {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
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

  // ────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────

  /** No-op for the regex implementation; kept for API compatibility. */
  async init(): Promise<void> {
    // nothing to initialise
  }

  // ────────────────────────────────────────────────────────
  // Extraction – public surface
  // ────────────────────────────────────────────────────────

  /**
   * Synchronous extraction.  Call `init()` first if you want to be
   * forward-compatible with a future tree-sitter implementation.
   */
  extract(code: string, language: string): ExtractionResult {
    if (!code) return { exports: [], imports: [] };

    switch (language) {
      case 'typescript':
      case 'javascript':
        return this._extractJsTs(code);
      case 'python':
        return this._extractPython(code);
      default:
        return { exports: [], imports: [] };
    }
  }

  /** Async version that auto-initialises (noop here) then delegates. */
  async extractAsync(code: string, language: string): Promise<ExtractionResult> {
    await this.init();
    return this.extract(code, language);
  }

  // ────────────────────────────────────────────────────────
  // TypeScript / JavaScript extraction
  // ────────────────────────────────────────────────────────

  private _extractJsTs(code: string): ExtractionResult {
    const exports: ExportEntry[] = [];
    const imports: string[] = [];

    // ── Exports ──────────────────────────────────────────

    // 1. export default function <name>  /  export default class <name>
    const defaultNamedRe =
      /^export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/gm;
    for (const m of code.matchAll(defaultNamedRe)) {
      exports.push({ name: m[1], signature: m[0].trim() });
    }

    // 2. export default <anonymous class/function/expression>
    //    i.e. "export default" NOT followed by a named function/class
    const defaultAnonRe =
      /^export\s+default\s+(?!(?:async\s+)?(?:function|class)\s+\w)(.+)/gm;
    for (const m of code.matchAll(defaultAnonRe)) {
      exports.push({ name: 'default', signature: `export default ${m[1].trim()}` });
    }

    // 3. export (async) function/class/interface/type/const/let/var <name>
    const namedRe =
      /^export\s+(?:declare\s+)?(?!default)(?:async\s+)?(function|class|interface|type|const|let|var)\s+(\w+)/gm;
    for (const m of code.matchAll(namedRe)) {
      const kind = m[1];
      const name = m[2];
      // Build a one-line signature: grab up to the first '{', '=' or EOL
      const startIdx = (m.index ?? 0);
      const lineEnd = code.indexOf('\n', startIdx);
      const rawLine = lineEnd === -1 ? code.slice(startIdx) : code.slice(startIdx, lineEnd);
      const signature = this._cleanSignature(rawLine, kind, name);
      exports.push({ name, signature });
    }

    // 4. module.exports = ...  (CommonJS)
    const cjsRe = /module\.exports\s*=/g;
    for (const _m of code.matchAll(cjsRe)) {
      exports.push({ name: 'module.exports', signature: 'module.exports' });
    }

    // ── Imports ──────────────────────────────────────────

    // ES module imports: import ... from 'specifier'
    const importRe = /import\s+(?:type\s+)?(?:.+?\s+from\s+)?['"]([^'"]+)['"]/g;
    const seenImports = new Set<string>();
    for (const m of code.matchAll(importRe)) {
      const specifier = m[1];
      if (!seenImports.has(specifier)) {
        seenImports.add(specifier);
        imports.push(specifier);
      }
    }

    return { exports, imports };
  }

  /**
   * Trim a raw source line down to a clean, readable signature.
   * For functions: keep up to and including the closing ')'.
   * For everything else: keep the first line without the body.
   */
  private _cleanSignature(raw: string, kind: string, name: string): string {
    // Remove trailing '{'
    let sig = raw.replace(/\s*\{.*$/, '').trim();

    if (kind === 'function') {
      // Keep up to the closing ')' of the parameter list
      const parenClose = sig.lastIndexOf(')');
      if (parenClose !== -1) {
        sig = sig.slice(0, parenClose + 1).trim();
      }
    } else if (kind === 'const' || kind === 'let' || kind === 'var') {
      // Keep up to the '=' but not the value
      const eq = sig.indexOf('=');
      if (eq !== -1) {
        sig = sig.slice(0, eq).trim();
      }
    } else if (kind === 'type') {
      // Keep up to the '=' for type aliases
      const eq = sig.indexOf('=');
      if (eq !== -1) {
        sig = sig.slice(0, eq).trim();
      }
    }

    return sig || `export ${kind} ${name}`;
  }

  // ────────────────────────────────────────────────────────
  // Python extraction
  // ────────────────────────────────────────────────────────

  private _extractPython(code: string): ExtractionResult {
    const exports: ExportEntry[] = [];
    const imports: string[] = [];
    const seenImports = new Set<string>();

    // Only top-level definitions: lines that start with def/class (no indent)
    const defClassRe = /^(def|class)\s+(\w+)([^:]*)/gm;
    for (const m of code.matchAll(defClassRe)) {
      const kind = m[1];
      const name = m[2];
      const rest = m[3].trim();
      const signature = kind === 'def' ? `def ${name}${rest}` : `class ${name}${rest}`;
      exports.push({ name, signature });
    }

    // import <module>
    const importRe = /^import\s+(\S+)/gm;
    for (const m of code.matchAll(importRe)) {
      // Strip any alias: "import os.path as op" -> "os.path"
      const mod = m[1].replace(/,.*$/, '').trim();
      if (!seenImports.has(mod)) {
        seenImports.add(mod);
        imports.push(mod);
      }
    }

    // from <module> import ...
    const fromRe = /^from\s+(\S+)\s+import/gm;
    for (const m of code.matchAll(fromRe)) {
      const mod = m[1];
      if (!seenImports.has(mod)) {
        seenImports.add(mod);
        imports.push(mod);
      }
    }

    return { exports, imports };
  }
}
