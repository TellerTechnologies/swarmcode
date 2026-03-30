import { describe, it, expect } from 'vitest';
import { detectLanguage, searchExports } from '../src/source-parser.js';

// ---------------------------------------------------------------------------
// detectLanguage
// ---------------------------------------------------------------------------
describe('detectLanguage', () => {
  it('returns typescript for .ts', () => {
    expect(detectLanguage('foo/bar.ts')).toBe('typescript');
  });

  it('returns typescript for .tsx', () => {
    expect(detectLanguage('Component.tsx')).toBe('typescript');
  });

  it('returns javascript for .js', () => {
    expect(detectLanguage('index.js')).toBe('javascript');
  });

  it('returns javascript for .jsx', () => {
    expect(detectLanguage('App.jsx')).toBe('javascript');
  });

  it('returns javascript for .mjs', () => {
    expect(detectLanguage('module.mjs')).toBe('javascript');
  });

  it('returns javascript for .cjs', () => {
    expect(detectLanguage('config.cjs')).toBe('javascript');
  });

  it('returns python for .py', () => {
    expect(detectLanguage('utils.py')).toBe('python');
  });

  it('returns null for unknown extension', () => {
    expect(detectLanguage('README.md')).toBeNull();
  });

  it('returns null for no extension', () => {
    expect(detectLanguage('Makefile')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// searchExports – JS/TS
// ---------------------------------------------------------------------------
describe('searchExports – JS/TS', () => {
  const lang = 'typescript';

  it('finds a named function export', () => {
    const code = `export function myFunction(a: string, b: number): void {\n  // body\n}`;
    const results = searchExports(code, lang, 'myFunction');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('myFunction');
    expect(results[0].signature).toContain('myFunction');
    // Signature should not include the body
    expect(results[0].signature).not.toContain('body');
  });

  it('finds a named const export', () => {
    const code = `export const myConst = 42;`;
    const results = searchExports(code, lang, 'myConst');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('myConst');
    // Signature should not include the value
    expect(results[0].signature).not.toContain('42');
  });

  it('finds a class export', () => {
    const code = `export class MyClass {\n  constructor() {}\n}`;
    const results = searchExports(code, lang, 'MyClass');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyClass');
  });

  it('finds an interface export', () => {
    const code = `export interface MyInterface {\n  id: number;\n}`;
    const results = searchExports(code, lang, 'MyInterface');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyInterface');
  });

  it('finds a type export', () => {
    const code = `export type MyType = string | number;`;
    const results = searchExports(code, lang, 'MyType');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyType');
  });

  it('finds a default named function export', () => {
    const code = `export default function myDefault(x: number) {\n  return x;\n}`;
    const results = searchExports(code, lang, 'myDefault');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('myDefault');
  });

  it('finds an async function export', () => {
    const code = `export async function fetchData(url: string): Promise<Response> {\n  return fetch(url);\n}`;
    const results = searchExports(code, lang, 'fetchData');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('fetchData');
  });

  it('returns empty array when no match', () => {
    const code = `export function alpha() {}\nexport const beta = 1;`;
    const results = searchExports(code, lang, 'gamma');
    expect(results).toHaveLength(0);
  });

  it('matching is case-insensitive', () => {
    const code = `export function CamelCaseFunc() {}`;
    const results = searchExports(code, lang, 'camelcase');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('CamelCaseFunc');
  });

  it('supports partial/substring matching', () => {
    const code = [
      'export function getUserById(id: number) {}',
      'export function getOrderById(id: number) {}',
      'export function createUser() {}',
    ].join('\n');
    const results = searchExports(code, lang, 'getUser');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('getUserById');
  });

  it('matches multiple results for broad query', () => {
    const code = [
      'export function getUser() {}',
      'export function getOrder() {}',
      'export function createOrder() {}',
    ].join('\n');
    const results = searchExports(code, lang, 'get');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.name)).toContain('getUser');
    expect(results.map(r => r.name)).toContain('getOrder');
  });

  it('handles export declare function', () => {
    const code = `export declare function declaredFn(x: string): void;`;
    const results = searchExports(code, lang, 'declaredFn');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('declaredFn');
  });
});

// ---------------------------------------------------------------------------
// searchExports – Python
// ---------------------------------------------------------------------------
describe('searchExports – Python', () => {
  const lang = 'python';

  it('finds a top-level function', () => {
    const code = `def my_func(a, b):\n    return a + b\n`;
    const results = searchExports(code, lang, 'my_func');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('my_func');
    expect(results[0].signature).toContain('my_func');
  });

  it('finds a top-level class', () => {
    const code = `class MyClass:\n    pass\n`;
    const results = searchExports(code, lang, 'MyClass');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyClass');
  });

  it('ignores indented (nested) definitions', () => {
    const code = [
      'class Outer:',
      '    def inner_method(self):',
      '        pass',
    ].join('\n');
    const results = searchExports(code, lang, 'inner_method');
    expect(results).toHaveLength(0);
  });

  it('case-insensitive substring match for python', () => {
    const code = `def ProcessData(items):\n    pass\n`;
    const results = searchExports(code, lang, 'processdata');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('ProcessData');
  });
});

// ---------------------------------------------------------------------------
// searchExports – unknown language
// ---------------------------------------------------------------------------
describe('searchExports – unknown language', () => {
  it('returns empty array for unknown language', () => {
    const code = `some arbitrary content`;
    const results = searchExports(code, 'ruby', 'foo');
    expect(results).toHaveLength(0);
  });
});
