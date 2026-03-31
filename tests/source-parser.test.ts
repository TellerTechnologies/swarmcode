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
// searchExports – Go
// ---------------------------------------------------------------------------
describe('searchExports – Go', () => {
  const lang = 'go';

  it('finds an exported function', () => {
    const code = `func HandleRequest(w http.ResponseWriter, r *http.Request) {\n}`;
    const results = searchExports(code, lang, 'HandleRequest');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('HandleRequest');
    expect(results[0].signature).toContain('HandleRequest');
  });

  it('finds a type struct', () => {
    const code = `type UserService struct {\n  db *sql.DB\n}`;
    const results = searchExports(code, lang, 'UserService');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('type UserService struct');
  });

  it('finds a type interface', () => {
    const code = `type Repository interface {\n  Find(id string) error\n}`;
    const results = searchExports(code, lang, 'Repository');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('type Repository interface');
  });
});

// ---------------------------------------------------------------------------
// searchExports – Rust
// ---------------------------------------------------------------------------
describe('searchExports – Rust', () => {
  const lang = 'rust';

  it('finds a pub fn', () => {
    const code = `pub fn process_data(input: &str) -> Result<String, Error> {\n}`;
    const results = searchExports(code, lang, 'process_data');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('process_data');
  });

  it('finds a pub async fn', () => {
    const code = `pub async fn fetch_user(id: u64) -> User {\n}`;
    const results = searchExports(code, lang, 'fetch_user');
    expect(results).toHaveLength(1);
  });

  it('finds pub struct', () => {
    const code = `pub struct Config {\n  pub port: u16,\n}`;
    const results = searchExports(code, lang, 'Config');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('pub struct Config');
  });

  it('finds pub enum', () => {
    const code = `pub enum Status {\n  Active,\n  Inactive,\n}`;
    const results = searchExports(code, lang, 'Status');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('pub enum Status');
  });

  it('finds pub trait', () => {
    const code = `pub trait Serializable {\n  fn serialize(&self) -> String;\n}`;
    const results = searchExports(code, lang, 'Serializable');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('pub trait Serializable');
  });

  it('ignores non-pub fn', () => {
    const code = `fn private_helper() -> bool {\n  true\n}`;
    const results = searchExports(code, lang, 'private_helper');
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// searchExports – Ruby
// ---------------------------------------------------------------------------
describe('searchExports – Ruby', () => {
  const lang = 'ruby';

  it('finds a class', () => {
    const code = `class UserController\n  def index\n  end\nend`;
    const results = searchExports(code, lang, 'UserController');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('class UserController');
  });

  it('finds a module', () => {
    const code = `module Authentication\nend`;
    const results = searchExports(code, lang, 'Authentication');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('module Authentication');
  });

  it('finds a top-level def', () => {
    const code = `def calculate_total(items)\n  items.sum\nend`;
    const results = searchExports(code, lang, 'calculate_total');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('def calculate_total(items)');
  });

  it('finds methods with ? and !', () => {
    const code = `def valid?\n  true\nend`;
    const results = searchExports(code, lang, 'valid?');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchExports – PHP
// ---------------------------------------------------------------------------
describe('searchExports – PHP', () => {
  const lang = 'php';

  it('finds a class', () => {
    const code = `class UserRepository {\n  public function find($id) {}\n}`;
    const results = searchExports(code, lang, 'UserRepository');
    expect(results).toHaveLength(1);
  });

  it('finds an interface', () => {
    const code = `interface Cacheable {\n  public function getKey(): string;\n}`;
    const results = searchExports(code, lang, 'Cacheable');
    expect(results).toHaveLength(1);
  });

  it('finds a function', () => {
    const code = `function array_flatten(array $arr): array {\n  return $arr;\n}`;
    const results = searchExports(code, lang, 'array_flatten');
    expect(results).toHaveLength(1);
  });

  it('finds abstract class', () => {
    const code = `abstract class BaseModel {\n}`;
    const results = searchExports(code, lang, 'BaseModel');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchExports – Java
// ---------------------------------------------------------------------------
describe('searchExports – Java', () => {
  const lang = 'java';

  it('finds a public class', () => {
    const code = `public class UserService {\n}`;
    const results = searchExports(code, lang, 'UserService');
    expect(results).toHaveLength(1);
  });

  it('finds an interface', () => {
    const code = `public interface Repository {\n  void save(Object entity);\n}`;
    const results = searchExports(code, lang, 'Repository');
    expect(results).toHaveLength(1);
  });

  it('finds an enum', () => {
    const code = `public enum Status {\n  ACTIVE, INACTIVE\n}`;
    const results = searchExports(code, lang, 'Status');
    expect(results).toHaveLength(1);
  });

  it('finds a public method', () => {
    const code = `public class Foo {\n    public String getUserById(int id) {\n    }\n}`;
    const results = searchExports(code, lang, 'getUserById');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toContain('public');
    expect(results[0].signature).toContain('String');
  });

  it('finds a public static method', () => {
    const code = `public class Foo {\n    public static void main(String[] args) {\n    }\n}`;
    const results = searchExports(code, lang, 'main');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchExports – Kotlin
// ---------------------------------------------------------------------------
describe('searchExports – Kotlin', () => {
  const lang = 'kotlin';

  it('finds a fun', () => {
    const code = `fun processOrder(order: Order): Receipt {\n}`;
    const results = searchExports(code, lang, 'processOrder');
    expect(results).toHaveLength(1);
  });

  it('finds a suspend fun', () => {
    const code = `suspend fun fetchData(url: String): Response {\n}`;
    const results = searchExports(code, lang, 'fetchData');
    expect(results).toHaveLength(1);
  });

  it('finds a data class', () => {
    const code = `data class User(val name: String, val age: Int)`;
    const results = searchExports(code, lang, 'User');
    expect(results).toHaveLength(1);
  });

  it('finds an object', () => {
    const code = `object DatabaseConfig {\n  val url = "localhost"\n}`;
    const results = searchExports(code, lang, 'DatabaseConfig');
    expect(results).toHaveLength(1);
  });

  it('finds an interface', () => {
    const code = `interface Repository {\n  fun findAll(): List<Entity>\n}`;
    const results = searchExports(code, lang, 'Repository');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchExports – C#
// ---------------------------------------------------------------------------
describe('searchExports – C#', () => {
  const lang = 'csharp';

  it('finds a public class', () => {
    const code = `public class OrderService {\n}`;
    const results = searchExports(code, lang, 'OrderService');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('public class OrderService');
  });

  it('finds a public interface', () => {
    const code = `public interface IRepository {\n}`;
    const results = searchExports(code, lang, 'IRepository');
    expect(results).toHaveLength(1);
  });

  it('finds a public static class', () => {
    const code = `public static class StringExtensions {\n}`;
    const results = searchExports(code, lang, 'StringExtensions');
    expect(results).toHaveLength(1);
  });

  it('finds a public method', () => {
    const code = `public class Foo {\n    public async Task<User> GetUserAsync(int id) {\n    }\n}`;
    const results = searchExports(code, lang, 'GetUserAsync');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchExports – Swift
// ---------------------------------------------------------------------------
describe('searchExports – Swift', () => {
  const lang = 'swift';

  it('finds a func', () => {
    const code = `func calculateTotal(items: [Item]) -> Double {\n}`;
    const results = searchExports(code, lang, 'calculateTotal');
    expect(results).toHaveLength(1);
  });

  it('finds a public func', () => {
    const code = `public func configure(app: Application) throws {\n}`;
    const results = searchExports(code, lang, 'configure');
    expect(results).toHaveLength(1);
  });

  it('finds a class', () => {
    const code = `class ViewController: UIViewController {\n}`;
    const results = searchExports(code, lang, 'ViewController');
    expect(results).toHaveLength(1);
  });

  it('finds a struct', () => {
    const code = `struct Config {\n  var port: Int\n}`;
    const results = searchExports(code, lang, 'Config');
    expect(results).toHaveLength(1);
  });

  it('finds a protocol', () => {
    const code = `protocol Drawable {\n  func draw()\n}`;
    const results = searchExports(code, lang, 'Drawable');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// searchExports – C/C++
// ---------------------------------------------------------------------------
describe('searchExports – C/C++', () => {
  const lang = 'cpp';

  it('finds a struct', () => {
    const code = `struct Vector3 {\n  float x, y, z;\n};`;
    const results = searchExports(code, lang, 'Vector3');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('struct Vector3');
  });

  it('finds a class', () => {
    const code = `class Engine {\npublic:\n  void start();\n};`;
    const results = searchExports(code, lang, 'Engine');
    expect(results).toHaveLength(1);
  });

  it('finds a top-level function', () => {
    const code = `int main(int argc, char** argv) {\n  return 0;\n}`;
    const results = searchExports(code, lang, 'main');
    expect(results).toHaveLength(1);
  });

  it('does not match control flow keywords', () => {
    const code = `if (x > 0) {\n  return 1;\n}`;
    const results = searchExports(code, lang, 'if');
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// searchExports – Elixir
// ---------------------------------------------------------------------------
describe('searchExports – Elixir', () => {
  const lang = 'elixir';

  it('finds a defmodule', () => {
    const code = `defmodule MyApp.UserController do\n  def index(conn, _params) do\n  end\nend`;
    const results = searchExports(code, lang, 'UserController');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyApp.UserController');
  });

  it('finds a def inside module', () => {
    const code = `defmodule MyApp do\n  def process(data) do\n    data\n  end\nend`;
    const results = searchExports(code, lang, 'process');
    expect(results).toHaveLength(1);
    expect(results[0].signature).toBe('def process(data)');
  });
});

// ---------------------------------------------------------------------------
// searchExports – Scala
// ---------------------------------------------------------------------------
describe('searchExports – Scala', () => {
  const lang = 'scala';

  it('finds a def', () => {
    const code = `def processItems(items: List[Item]): Result = {\n}`;
    const results = searchExports(code, lang, 'processItems');
    expect(results).toHaveLength(1);
  });

  it('finds a class', () => {
    const code = `class UserRepository(db: Database) {\n}`;
    const results = searchExports(code, lang, 'UserRepository');
    expect(results).toHaveLength(1);
  });

  it('finds a case class', () => {
    const code = `case class User(name: String, age: Int)`;
    const results = searchExports(code, lang, 'User');
    expect(results).toHaveLength(1);
  });

  it('finds an object', () => {
    const code = `object AppConfig {\n  val port = 8080\n}`;
    const results = searchExports(code, lang, 'AppConfig');
    expect(results).toHaveLength(1);
  });

  it('finds a trait', () => {
    const code = `trait Serializable {\n  def serialize(): String\n}`;
    const results = searchExports(code, lang, 'Serializable');
    expect(results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// detectLanguage – new languages
// ---------------------------------------------------------------------------
describe('detectLanguage – new languages', () => {
  it('returns go for .go', () => expect(detectLanguage('main.go')).toBe('go'));
  it('returns rust for .rs', () => expect(detectLanguage('lib.rs')).toBe('rust'));
  it('returns ruby for .rb', () => expect(detectLanguage('app.rb')).toBe('ruby'));
  it('returns php for .php', () => expect(detectLanguage('index.php')).toBe('php'));
  it('returns java for .java', () => expect(detectLanguage('Main.java')).toBe('java'));
  it('returns kotlin for .kt', () => expect(detectLanguage('App.kt')).toBe('kotlin'));
  it('returns kotlin for .kts', () => expect(detectLanguage('build.gradle.kts')).toBe('kotlin'));
  it('returns csharp for .cs', () => expect(detectLanguage('Program.cs')).toBe('csharp'));
  it('returns swift for .swift', () => expect(detectLanguage('App.swift')).toBe('swift'));
  it('returns cpp for .c', () => expect(detectLanguage('main.c')).toBe('cpp'));
  it('returns cpp for .h', () => expect(detectLanguage('header.h')).toBe('cpp'));
  it('returns cpp for .cpp', () => expect(detectLanguage('engine.cpp')).toBe('cpp'));
  it('returns cpp for .hpp', () => expect(detectLanguage('types.hpp')).toBe('cpp'));
  it('returns cpp for .cc', () => expect(detectLanguage('util.cc')).toBe('cpp'));
  it('returns elixir for .ex', () => expect(detectLanguage('router.ex')).toBe('elixir'));
  it('returns elixir for .exs', () => expect(detectLanguage('test.exs')).toBe('elixir'));
  it('returns scala for .scala', () => expect(detectLanguage('App.scala')).toBe('scala'));
  it('returns scala for .sc', () => expect(detectLanguage('script.sc')).toBe('scala'));
});

// ---------------------------------------------------------------------------
// searchExports – unknown language
// ---------------------------------------------------------------------------
describe('searchExports – unknown language', () => {
  it('returns empty array for unknown language', () => {
    const code = `some arbitrary content`;
    const results = searchExports(code, 'haskell', 'foo');
    expect(results).toHaveLength(0);
  });
});
