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

/**
 * Union of language keys supported by {@link searchExports} and
 * {@link detectLanguage}.
 *
 * Each key corresponds to a set of regex patterns that extract exported
 * symbols (functions, classes, types, etc.) from source code written in
 * that language.
 */
export type LANGUAGE_PATTERNS =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'go'
  | 'rust'
  | 'ruby'
  | 'php'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'swift'
  | 'cpp'
  | 'elixir'
  | 'scala';

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
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.rb':
      return 'ruby';
    case '.php':
      return 'php';
    case '.java':
      return 'java';
    case '.kt':
    case '.kts':
      return 'kotlin';
    case '.cs':
      return 'csharp';
    case '.swift':
      return 'swift';
    case '.c':
    case '.h':
    case '.cpp':
    case '.hpp':
    case '.cc':
    case '.cxx':
      return 'cpp';
    case '.ex':
    case '.exs':
      return 'elixir';
    case '.scala':
    case '.sc':
      return 'scala';
    default:
      return null;
  }
}

/**
 * Search source code for exported symbols whose name matches a query.
 *
 * Performs a case-insensitive substring match against exported symbol names
 * for the given language. Each supported language has its own set of regex
 * patterns that extract functions, classes, types, and other top-level
 * declarations.
 *
 * @param code - The raw source code to search through.
 * @param language - A {@link LANGUAGE_PATTERNS} key identifying the source language.
 * @param query - The substring to match against symbol names (case-insensitive).
 * @returns An array of {@link ExportSearchResult} objects for every exported
 *          symbol whose name contains `query`.
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
    case 'go':
      return searchGo(code, query);
    case 'rust':
      return searchRust(code, query);
    case 'ruby':
      return searchRuby(code, query);
    case 'php':
      return searchPhp(code, query);
    case 'java':
      return searchJava(code, query);
    case 'kotlin':
      return searchKotlin(code, query);
    case 'csharp':
      return searchCSharp(code, query);
    case 'swift':
      return searchSwift(code, query);
    case 'cpp':
      return searchCpp(code, query);
    case 'elixir':
      return searchElixir(code, query);
    case 'scala':
      return searchScala(code, query);
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

/** Go – exported (capitalized) funcs, types, structs, interfaces. */
function searchGo(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // func Name(params) returnType
  const funcRe = /^func\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(funcRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `func ${name}(${m[2]})` });
    }
  }

  // type Name struct/interface/...
  const typeRe = /^type\s+(\w+)\s+(\w+)/gm;
  for (const m of code.matchAll(typeRe)) {
    const name = m[1];
    const kind = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `type ${name} ${kind}` });
    }
  }

  return results;
}

/** Rust – pub fn, pub struct, pub enum, pub trait. */
function searchRust(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // pub [async] fn name(params)
  const fnRe = /^pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(fnRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `pub fn ${name}(${m[2]})` });
    }
  }

  // pub struct/enum/trait Name
  const typeRe = /^pub\s+(struct|enum|trait)\s+(\w+)/gm;
  for (const m of code.matchAll(typeRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `pub ${kind} ${name}` });
    }
  }

  return results;
}

/** Ruby – top-level def, class, module. */
function searchRuby(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // class/module Name
  const classRe = /^(class|module)\s+(\w+)/gm;
  for (const m of code.matchAll(classRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  // def name (top-level only — no leading whitespace)
  const defRe = /^def\s+(\w+[?!]?)(\([^)]*\))?/gm;
  for (const m of code.matchAll(defRe)) {
    const name = m[1];
    const params = m[2] ?? '';
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `def ${name}${params}` });
    }
  }

  return results;
}

/** PHP – function, class, interface, trait. */
function searchPhp(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // class/interface/trait Name
  const classRe = /^(?:abstract\s+)?(?:final\s+)?(class|interface|trait)\s+(\w+)/gm;
  for (const m of code.matchAll(classRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  // function name(params)
  const funcRe = /^function\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(funcRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `function ${name}(${m[2]})` });
    }
  }

  return results;
}

/** Java – public class/interface/enum, public methods. */
function searchJava(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // public [abstract|final] class/interface/enum Name
  const classRe = /^(?:public\s+)?(?:abstract\s+|final\s+)?(class|interface|enum)\s+(\w+)/gm;
  for (const m of code.matchAll(classRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  // public [static] [abstract] ReturnType methodName(params)
  const methodRe = /^\s+public\s+(?:static\s+)?(?:abstract\s+)?(?:final\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(methodRe)) {
    const returnType = m[1].trim();
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `public ${returnType} ${name}(${m[3]})` });
    }
  }

  return results;
}

/** Kotlin – fun, class, object, interface, data class. */
function searchKotlin(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // fun name(params)
  const funRe = /^(?:\s*)(?:suspend\s+)?fun\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(funRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `fun ${name}(${m[2]})` });
    }
  }

  // [data] class/object/interface Name
  const classRe = /^(?:data\s+|sealed\s+|abstract\s+|open\s+)?(class|object|interface)\s+(\w+)/gm;
  for (const m of code.matchAll(classRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  return results;
}

/** C# – public class/interface/struct/enum, public methods. */
function searchCSharp(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // public [abstract|static|sealed|partial] class/interface/struct/enum Name
  const classRe = /^(?:\s*)public\s+(?:abstract\s+|static\s+|sealed\s+|partial\s+)*(class|interface|struct|enum)\s+(\w+)/gm;
  for (const m of code.matchAll(classRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `public ${kind} ${name}` });
    }
  }

  // public [static] [async] ReturnType MethodName(params)
  const methodRe = /^\s+public\s+(?:static\s+)?(?:async\s+)?(?:virtual\s+)?(?:override\s+)?(\w[\w<>,\s]*?)\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(methodRe)) {
    const returnType = m[1].trim();
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `public ${returnType} ${name}(${m[3]})` });
    }
  }

  return results;
}

/** Swift – func, class, struct, protocol, enum. */
function searchSwift(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // func name(params)
  const funcRe = /^(?:\s*)(?:public\s+|open\s+|internal\s+)?(?:static\s+)?func\s+(\w+)\s*\(([^)]*)\)/gm;
  for (const m of code.matchAll(funcRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `func ${name}(${m[2]})` });
    }
  }

  // class/struct/protocol/enum Name
  const typeRe = /^(?:public\s+|open\s+|internal\s+)?(?:final\s+)?(class|struct|protocol|enum)\s+(\w+)/gm;
  for (const m of code.matchAll(typeRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  return results;
}

/** C/C++ – top-level function definitions, struct, class. */
function searchCpp(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // struct/class Name
  const typeRe = /^(?:typedef\s+)?(struct|class)\s+(\w+)/gm;
  for (const m of code.matchAll(typeRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  // Top-level function: ReturnType name(params) — no leading whitespace
  // Avoid matching control flow (if, for, while, switch, return)
  const funcRe = /^(\w[\w*&\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*\{/gm;
  const keywords = new Set(['if', 'for', 'while', 'switch', 'return', 'else', 'do', 'struct', 'class', 'typedef']);
  for (const m of code.matchAll(funcRe)) {
    const returnType = m[1].trim();
    const name = m[2];
    if (keywords.has(name)) continue;
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${returnType} ${name}(${m[3]})` });
    }
  }

  return results;
}

/** Elixir – def, defmodule. */
function searchElixir(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // defmodule Name
  const moduleRe = /^defmodule\s+([\w.]+)/gm;
  for (const m of code.matchAll(moduleRe)) {
    const name = m[1];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `defmodule ${name}` });
    }
  }

  // def name(params) — top-level (2-space indent = inside module, which is normal)
  const defRe = /^\s+def\s+(\w+[?!]?)(?:\(([^)]*)\))?/gm;
  for (const m of code.matchAll(defRe)) {
    const name = m[1];
    const params = m[2] ?? '';
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `def ${name}(${params})` });
    }
  }

  return results;
}

/** Scala – def, class, object, trait, case class. */
function searchScala(code: string, query: string): ExportSearchResult[] {
  const results: ExportSearchResult[] = [];

  // def name(params)
  const defRe = /^(?:\s*)def\s+(\w+)\s*(?:\(([^)]*)\))?/gm;
  for (const m of code.matchAll(defRe)) {
    const name = m[1];
    const params = m[2] ?? '';
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `def ${name}(${params})` });
    }
  }

  // [case] class/object/trait Name
  const classRe = /^(?:case\s+|sealed\s+|abstract\s+)?(class|object|trait)\s+(\w+)/gm;
  for (const m of code.matchAll(classRe)) {
    const kind = m[1];
    const name = m[2];
    if (matchesQuery(name, query)) {
      results.push({ name, signature: `${kind} ${name}` });
    }
  }

  return results;
}
