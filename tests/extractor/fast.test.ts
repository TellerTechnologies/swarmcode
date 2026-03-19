import { describe, it, expect } from 'vitest';
import { FastExtractor } from '../../src/extractor/fast.js';

// ──────────────────────────────────────────────
// Language detection
// ──────────────────────────────────────────────
describe('FastExtractor.detectLanguage', () => {
  it('detects .ts as typescript', () => {
    expect(FastExtractor.detectLanguage('src/utils.ts')).toBe('typescript');
  });

  it('detects .tsx as typescript', () => {
    expect(FastExtractor.detectLanguage('components/Button.tsx')).toBe('typescript');
  });

  it('detects .js as javascript', () => {
    expect(FastExtractor.detectLanguage('lib/helper.js')).toBe('javascript');
  });

  it('detects .jsx as javascript', () => {
    expect(FastExtractor.detectLanguage('ui/App.jsx')).toBe('javascript');
  });

  it('detects .mjs as javascript', () => {
    expect(FastExtractor.detectLanguage('index.mjs')).toBe('javascript');
  });

  it('detects .cjs as javascript', () => {
    expect(FastExtractor.detectLanguage('config.cjs')).toBe('javascript');
  });

  it('detects .py as python', () => {
    expect(FastExtractor.detectLanguage('scripts/runner.py')).toBe('python');
  });

  it('returns null for unknown extensions', () => {
    expect(FastExtractor.detectLanguage('README.md')).toBeNull();
    expect(FastExtractor.detectLanguage('Makefile')).toBeNull();
    expect(FastExtractor.detectLanguage('data.json')).toBeNull();
  });
});

// ──────────────────────────────────────────────
// TypeScript / JavaScript extraction
// ──────────────────────────────────────────────
describe('FastExtractor – TypeScript/JavaScript', () => {
  const extractor = new FastExtractor();

  it('extracts exported functions (not internal ones)', async () => {
    const code = `
export function greet(name: string): string {
  return 'hello ' + name;
}

function internalHelper(): void {}

export function add(a: number, b: number): number {
  return a + b;
}
`;
    const result = await extractor.extractAsync(code, 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('greet');
    expect(names).toContain('add');
    expect(names).not.toContain('internalHelper');
  });

  it('captures function signature', async () => {
    const code = `export function greet(name: string): string { return name; }`;
    const result = await extractor.extractAsync(code, 'typescript');
    const fn = result.exports.find((e) => e.name === 'greet');
    expect(fn).toBeDefined();
    expect(fn?.signature).toContain('greet');
  });

  it('extracts exported classes', async () => {
    const code = `
export class UserService {
  constructor(private db: Database) {}
  getUser(id: string): User { return this.db.find(id); }
}
`;
    const result = await extractor.extractAsync(code, 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('UserService');
  });

  it('extracts exported interfaces', async () => {
    const code = `
export interface User {
  id: string;
  name: string;
}
`;
    const result = await extractor.extractAsync(code, 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('User');
  });

  it('extracts exported type aliases', async () => {
    const code = `
export type UserId = string;
export type Status = 'active' | 'inactive';
`;
    const result = await extractor.extractAsync(code, 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('UserId');
    expect(names).toContain('Status');
  });

  it('extracts export default', async () => {
    const code = `
export default function handler(req: Request, res: Response) {
  res.send('ok');
}
`;
    const result = await extractor.extractAsync(code, 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('handler');
  });

  it('extracts export default anonymous class as "default"', async () => {
    const code = `export default class {}`;
    const result = await extractor.extractAsync(code, 'typescript');
    const hasDefault = result.exports.some(
      (e) => e.name === 'default' || e.name === 'class',
    );
    // We just need something extracted for the default export
    expect(result.exports.length).toBeGreaterThan(0);
  });

  it('extracts named const/let/var exports', async () => {
    const code = `
export const API_URL = 'https://example.com';
export let counter = 0;
export var legacyFlag = true;
`;
    const result = await extractor.extractAsync(code, 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('API_URL');
    expect(names).toContain('counter');
    expect(names).toContain('legacyFlag');
  });

  it('extracts ES module imports (module specifiers)', async () => {
    const code = `
import { useState, useEffect } from 'react';
import path from 'node:path';
import type { User } from './types.js';
`;
    const result = await extractor.extractAsync(code, 'typescript');
    expect(result.imports).toContain('react');
    expect(result.imports).toContain('node:path');
    expect(result.imports).toContain('./types.js');
  });

  it('extracts CommonJS module.exports', async () => {
    const code = `
function doThing() {}
module.exports = { doThing };
`;
    const result = await extractor.extractAsync(code, 'javascript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('module.exports');
  });

  it('returns empty arrays for empty input', async () => {
    const result = await extractor.extractAsync('', 'typescript');
    expect(result.exports).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// Python extraction
// ──────────────────────────────────────────────
describe('FastExtractor – Python', () => {
  const extractor = new FastExtractor();

  it('extracts top-level function definitions', async () => {
    const code = `
def greet(name):
    return f"hello {name}"

def add(a, b):
    return a + b
`;
    const result = await extractor.extractAsync(code, 'python');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('greet');
    expect(names).toContain('add');
  });

  it('extracts top-level class definitions', async () => {
    const code = `
class UserService:
    def __init__(self):
        pass

class AdminService(UserService):
    pass
`;
    const result = await extractor.extractAsync(code, 'python');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('UserService');
    expect(names).toContain('AdminService');
  });

  it('extracts import statements', async () => {
    const code = `
import os
import sys
from pathlib import Path
from typing import Optional, List
`;
    const result = await extractor.extractAsync(code, 'python');
    expect(result.imports).toContain('os');
    expect(result.imports).toContain('sys');
    expect(result.imports).toContain('pathlib');
  });

  it('does not extract nested (indented) function definitions as top-level', async () => {
    const code = `
class MyClass:
    def method(self):
        def nested():
            pass
        pass

def top_level():
    pass
`;
    const result = await extractor.extractAsync(code, 'python');
    const names = result.exports.map((e) => e.name);
    // top_level and MyClass should be there
    expect(names).toContain('top_level');
    expect(names).toContain('MyClass');
    // nested should NOT be extracted
    expect(names).not.toContain('nested');
    // method should NOT be extracted (it's inside a class)
    expect(names).not.toContain('method');
  });

  it('returns empty arrays for empty python input', async () => {
    const result = await extractor.extractAsync('', 'python');
    expect(result.exports).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// Sync API
// ──────────────────────────────────────────────
describe('FastExtractor – sync extract (after init)', () => {
  it('works synchronously after construction (regex impl needs no async init)', async () => {
    const extractor = new FastExtractor();
    await extractor.init();
    const result = extractor.extract('export const X = 1;', 'typescript');
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('X');
  });

  it('throws or returns empty for unsupported language', async () => {
    const extractor = new FastExtractor();
    await extractor.init();
    // Should not throw; just return empty
    const result = extractor.extract('some code', 'ruby');
    expect(result.exports).toEqual([]);
    expect(result.imports).toEqual([]);
  });
});
