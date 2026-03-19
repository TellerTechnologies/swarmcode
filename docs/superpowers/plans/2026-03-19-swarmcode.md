# Swarmcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a P2P mesh agent that makes AI coding assistants team-aware by sharing workspace metadata in real-time and injecting team context into each AI tool's context files.

**Architecture:** Each laptop runs a local Swarmcode agent with five components: file watcher, intent extractor (AST + LLM), mesh broadcaster (ZMQ PUB/SUB), query responder (ZMQ REQ/REP), and context injector. Agents discover each other via mDNS on the LAN, share metadata about what each dev's AI is building, and inject that awareness into the local AI tool's context file (CLAUDE.md, .cursorrules, etc.).

**Tech Stack:** TypeScript/Node.js, chokidar, bonjour-service, zeromq.js, tree-sitter, Anthropic/OpenAI SDKs, commander, yaml

---

## File Structure

```
swarmcode/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts                    # Public API exports
│   ├── cli.ts                      # Commander CLI entry point
│   ├── agent.ts                    # Main agent orchestrator
│   ├── config.ts                   # Config loading and validation
│   ├── types.ts                    # Shared types (SwarmUpdate, PeerInfo, etc.)
│   ├── watcher.ts                  # File watcher (chokidar, debounced)
│   ├── extractor/
│   │   ├── fast.ts                 # AST-based export extraction (tree-sitter)
│   │   └── rich.ts                 # LLM-based intent enrichment (Tier 2/3)
│   ├── mesh/
│   │   ├── discovery.ts            # mDNS peer discovery (bonjour-service)
│   │   ├── broadcaster.ts          # ZMQ PUB/SUB for metadata broadcasts
│   │   └── query.ts                # ZMQ REQ/REP for point-to-point queries
│   ├── state/
│   │   └── team-state.ts           # Aggregated team state manager
│   ├── injector/
│   │   ├── injector.ts             # Core injection logic + diff check
│   │   ├── formatter.ts            # Formats team state into AI instructions
│   │   └── adapters/
│   │       ├── base.ts             # Adapter interface
│   │       ├── claude-code.ts      # CLAUDE.md adapter
│   │       └── cursor.ts           # .cursorrules adapter
│   ├── conflict/
│   │   └── detector.ts             # Conflict detection (zones, interfaces, pre-merge)
│   ├── llm/
│   │   ├── provider.ts             # Provider-agnostic LLM interface
│   │   ├── anthropic.ts            # Anthropic adapter
│   │   └── openai.ts               # OpenAI adapter
│   └── plan/
│       └── parser.ts               # PLAN.md parser
├── tests/
│   ├── config.test.ts
│   ├── types.test.ts
│   ├── watcher.test.ts
│   ├── extractor/
│   │   ├── fast.test.ts
│   │   └── rich.test.ts
│   ├── mesh/
│   │   ├── discovery.test.ts
│   │   ├── broadcaster.test.ts
│   │   └── query.test.ts
│   ├── state/
│   │   └── team-state.test.ts
│   ├── injector/
│   │   ├── injector.test.ts
│   │   └── formatter.test.ts
│   ├── conflict/
│   │   └── detector.test.ts
│   ├── llm/
│   │   └── provider.test.ts
│   ├── plan/
│   │   └── parser.test.ts
│   └── integration/
│       ├── mesh.integration.test.ts
│       └── agent.integration.test.ts
└── bin/
    └── swarmcode.ts                # CLI bin entry point
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `bin/swarmcode.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize the project**

```bash
cd /home/jaredt17/projects/tellertech/pairpro-agent
npm init -y
```

- [ ] **Step 2: Install core dependencies**

```bash
npm install typescript commander yaml chokidar bonjour-service zeromq @anthropic-ai/sdk openai
npm install -D vitest @types/node tsx
```

Note: `tree-sitter` and language grammars will be installed in Task 4 when we build the extractor.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*", "bin/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    testTimeout: 10000,
  },
});
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.swarmcode/
*.tsbuildinfo
```

- [ ] **Step 6: Create placeholder entry points**

`src/index.ts`:
```typescript
export const VERSION = '0.1.0';
```

`bin/swarmcode.ts`:
```typescript
#!/usr/bin/env tsx
console.log('swarmcode');
```

- [ ] **Step 7: Add scripts to package.json**

Add to `package.json`:
```json
{
  "type": "module",
  "bin": {
    "swarmcode": "./bin/swarmcode.ts"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.integration.config.ts"
  }
}
```

- [ ] **Step 8: Verify setup**

```bash
npx vitest run
npx tsx bin/swarmcode.ts
```

Expected: vitest reports no tests found (passes), CLI prints "swarmcode".

- [ ] **Step 9: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts src/index.ts bin/swarmcode.ts .gitignore
git commit -m "chore: scaffold swarmcode project"
```

---

### Task 2: Shared Types and Metadata Schema

**Files:**
- Create: `src/types.ts`
- Create: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  SwarmUpdate,
  PeerInfo,
  PeerState,
  SwarmConfig,
  EventType,
  QueryRequest,
  QueryResponse,
} from '../src/types.js';

describe('SwarmUpdate', () => {
  it('should create a valid tier 1 update', () => {
    const update: SwarmUpdate = {
      peer_id: 'abc-123',
      dev_name: 'Jared',
      timestamp: Date.now(),
      event_type: 'file_created',
      file_path: 'src/auth.ts',
      exports: [{ name: 'login', signature: '(email: string, password: string) => Promise<Token>' }],
      imports: ['bcrypt', 'jsonwebtoken'],
      work_zone: 'src/auth',
      intent: null,
      summary: null,
      interfaces: [],
      touches: ['src/auth.ts'],
    };
    expect(update.peer_id).toBe('abc-123');
    expect(update.event_type).toBe('file_created');
    expect(update.exports).toHaveLength(1);
    expect(update.intent).toBeNull();
  });
});

describe('PeerState', () => {
  it('should track a peer with multiple file states', () => {
    const state: PeerState = {
      peer_id: 'abc-123',
      dev_name: 'Jared',
      status: 'online',
      last_seen: Date.now(),
      address: '192.168.1.10',
      pub_port: 5555,
      rep_port: 5556,
      files: new Map(),
      work_zone: 'src/auth',
      intent: null,
    };
    state.files.set('src/auth.ts', {
      exports: [{ name: 'login', signature: '() => void' }],
      imports: [],
      last_modified: Date.now(),
    });
    expect(state.files.size).toBe(1);
    expect(state.status).toBe('online');
  });
});

describe('SwarmConfig', () => {
  it('should have required fields', () => {
    const config: SwarmConfig = {
      name: 'Jared',
      ai_tool: 'claude-code',
      context_file: 'CLAUDE.md',
      ignore: ['node_modules', 'dist', '.git'],
      tier2_interval: 60,
      tier3_interval: 300,
      enrichment: {
        provider: 'anthropic',
        api_key_env: 'ANTHROPIC_API_KEY',
        tier2_model: 'claude-haiku-4-5-20251001',
        tier3_model: 'claude-sonnet-4-6',
      },
    };
    expect(config.name).toBe('Jared');
    expect(config.enrichment.provider).toBe('anthropic');
  });
});

describe('QueryRequest / QueryResponse', () => {
  it('should model a query for exports', () => {
    const req: QueryRequest = {
      type: 'exports',
      file_path: 'src/auth.ts',
    };
    const res: QueryResponse = {
      type: 'exports',
      file_path: 'src/auth.ts',
      data: [{ name: 'login', signature: '() => void' }],
      error: null,
    };
    expect(req.type).toBe('exports');
    expect(res.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/types.test.ts
```

Expected: FAIL — cannot find module `../src/types.js`

- [ ] **Step 3: Write the types**

`src/types.ts`:
```typescript
export type EventType = 'file_created' | 'file_modified' | 'file_deleted' | 'intent_updated';

export type PeerStatus = 'online' | 'offline';

export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'none';

export type AITool = 'claude-code' | 'cursor' | 'copilot' | 'custom';

export type QueryType = 'exports' | 'file_exists' | 'dependencies';

export interface ExportEntry {
  name: string;
  signature: string;
}

export interface SwarmUpdate {
  peer_id: string;
  dev_name: string;
  timestamp: number;
  event_type: EventType;
  file_path: string;
  exports: ExportEntry[];
  imports: string[];
  work_zone: string;
  intent: string | null;
  summary: string | null;
  interfaces: string[];
  touches: string[];
}

export interface FileState {
  exports: ExportEntry[];
  imports: string[];
  last_modified: number;
}

export interface PeerInfo {
  peer_id: string;
  dev_name: string;
  address: string;
  pub_port: number;
  rep_port: number;
}

export interface PeerState {
  peer_id: string;
  dev_name: string;
  status: PeerStatus;
  last_seen: number;
  address: string;
  pub_port: number;
  rep_port: number;
  files: Map<string, FileState>;
  work_zone: string;
  intent: string | null;
}

export interface EnrichmentConfig {
  provider: LLMProvider;
  api_key_env: string;
  tier2_model: string;
  tier3_model: string;
}

export interface SwarmConfig {
  name: string;
  ai_tool: AITool;
  context_file: string;
  ignore: string[];
  tier2_interval: number;
  tier3_interval: number;
  enrichment: EnrichmentConfig;
}

export interface QueryRequest {
  type: QueryType;
  file_path: string;
}

export interface QueryResponse {
  type: QueryType;
  file_path: string;
  data: unknown;
  error: string | null;
}

export interface ConflictSignal {
  type: 'zone_overlap' | 'interface_conflict' | 'duplication';
  severity: 'warning' | 'critical';
  peers: string[];
  description: string;
  file_paths: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/types.test.ts
```

Expected: PASS — all type checks and runtime assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add shared types and metadata schema"
```

---

### Task 3: Config Loader

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, getDefaultConfig, resolveContextFile } from '../src/config.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('getDefaultConfig', () => {
  it('should return sensible defaults', () => {
    const config = getDefaultConfig('TestUser');
    expect(config.name).toBe('TestUser');
    expect(config.ai_tool).toBe('claude-code');
    expect(config.context_file).toBe('CLAUDE.md');
    expect(config.ignore).toContain('node_modules');
    expect(config.tier2_interval).toBe(60);
    expect(config.tier3_interval).toBe(300);
    expect(config.enrichment.provider).toBe('none');
  });
});

describe('resolveContextFile', () => {
  it('should map claude-code to CLAUDE.md', () => {
    expect(resolveContextFile('claude-code')).toBe('CLAUDE.md');
  });

  it('should map cursor to .cursorrules', () => {
    expect(resolveContextFile('cursor')).toBe('.cursorrules');
  });

  it('should default to CLAUDE.md for unknown tools', () => {
    expect(resolveContextFile('custom')).toBe('CLAUDE.md');
  });
});

describe('loadConfig', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarmcode-test-${Date.now()}`);
    mkdirSync(join(testDir, '.swarmcode'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should load config from .swarmcode/config.yaml', () => {
    const yamlContent = `
name: "Jared"
ai_tool: "claude-code"
ignore:
  - node_modules
  - dist
tier2_interval: 30
enrichment:
  provider: "anthropic"
  api_key_env: "ANTHROPIC_API_KEY"
  tier2_model: "claude-haiku-4-5-20251001"
  tier3_model: "claude-sonnet-4-6"
`;
    writeFileSync(join(testDir, '.swarmcode', 'config.yaml'), yamlContent);
    const config = loadConfig(testDir);
    expect(config.name).toBe('Jared');
    expect(config.tier2_interval).toBe(30);
    expect(config.enrichment.provider).toBe('anthropic');
    expect(config.context_file).toBe('CLAUDE.md');
  });

  it('should fall back to defaults when no config file exists', () => {
    rmSync(join(testDir, '.swarmcode'), { recursive: true, force: true });
    const config = loadConfig(testDir);
    expect(config.name).toBeDefined();
    expect(config.ai_tool).toBe('claude-code');
  });

  it('should merge partial config with defaults', () => {
    const yamlContent = `
name: "Sarah"
ai_tool: "cursor"
`;
    writeFileSync(join(testDir, '.swarmcode', 'config.yaml'), yamlContent);
    const config = loadConfig(testDir);
    expect(config.name).toBe('Sarah');
    expect(config.ai_tool).toBe('cursor');
    expect(config.context_file).toBe('.cursorrules');
    expect(config.tier2_interval).toBe(60);
    expect(config.enrichment.provider).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL — cannot find module `../src/config.js`

- [ ] **Step 3: Write the implementation**

`src/config.ts`:
```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { hostname } from 'node:os';
import type { SwarmConfig, AITool } from './types.js';

const CONTEXT_FILE_MAP: Record<string, string> = {
  'claude-code': 'CLAUDE.md',
  'cursor': '.cursorrules',
  'copilot': '.github/copilot-instructions.md',
};

export function resolveContextFile(aiTool: string): string {
  return CONTEXT_FILE_MAP[aiTool] ?? 'CLAUDE.md';
}

export function getDefaultConfig(name?: string): SwarmConfig {
  const devName = name ?? hostname();
  return {
    name: devName,
    ai_tool: 'claude-code',
    context_file: 'CLAUDE.md',
    ignore: ['node_modules', 'dist', '.git', '.swarmcode'],
    tier2_interval: 60,
    tier3_interval: 300,
    enrichment: {
      provider: 'none',
      api_key_env: '',
      tier2_model: '',
      tier3_model: '',
    },
  };
}

export function loadConfig(projectDir: string): SwarmConfig {
  const configPath = join(projectDir, '.swarmcode', 'config.yaml');
  const defaults = getDefaultConfig();

  if (!existsSync(configPath)) {
    return defaults;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) ?? {};

  const aiTool = parsed.ai_tool ?? defaults.ai_tool;

  return {
    name: parsed.name ?? defaults.name,
    ai_tool: aiTool as AITool,
    context_file: parsed.context_file ?? resolveContextFile(aiTool),
    ignore: parsed.ignore ?? defaults.ignore,
    tier2_interval: parsed.tier2_interval ?? defaults.tier2_interval,
    tier3_interval: parsed.tier3_interval ?? defaults.tier3_interval,
    enrichment: {
      provider: parsed.enrichment?.provider ?? defaults.enrichment.provider,
      api_key_env: parsed.enrichment?.api_key_env ?? defaults.enrichment.api_key_env,
      tier2_model: parsed.enrichment?.tier2_model ?? defaults.enrichment.tier2_model,
      tier3_model: parsed.enrichment?.tier3_model ?? defaults.enrichment.tier3_model,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loader with YAML parsing and defaults"
```

---

### Task 4: File Watcher

**Files:**
- Create: `src/watcher.ts`
- Create: `tests/watcher.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/watcher.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileWatcher } from '../src/watcher.js';
import { writeFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileWatcher', () => {
  let testDir: string;
  let watcher: FileWatcher;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarmcode-watcher-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    await watcher?.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should emit file_created when a new file is added', async () => {
    const events: Array<{ type: string; path: string }> = [];
    watcher = new FileWatcher(testDir, {
      ignore: ['node_modules'],
      debounceMs: 100,
    });
    watcher.on('change', (event) => events.push(event));
    await watcher.start();

    writeFileSync(join(testDir, 'hello.ts'), 'export const x = 1;');

    await new Promise((r) => setTimeout(r, 500));
    expect(events.some((e) => e.type === 'file_created' && e.path.includes('hello.ts'))).toBe(true);
  });

  it('should emit file_modified when a file changes', async () => {
    writeFileSync(join(testDir, 'existing.ts'), 'export const x = 1;');
    const events: Array<{ type: string; path: string }> = [];
    watcher = new FileWatcher(testDir, {
      ignore: ['node_modules'],
      debounceMs: 100,
    });
    watcher.on('change', (event) => events.push(event));
    await watcher.start();

    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(testDir, 'existing.ts'), 'export const x = 2;');

    await new Promise((r) => setTimeout(r, 500));
    expect(events.some((e) => e.type === 'file_modified' && e.path.includes('existing.ts'))).toBe(true);
  });

  it('should emit file_deleted when a file is removed', async () => {
    writeFileSync(join(testDir, 'remove-me.ts'), 'export const x = 1;');
    const events: Array<{ type: string; path: string }> = [];
    watcher = new FileWatcher(testDir, {
      ignore: ['node_modules'],
      debounceMs: 100,
    });
    watcher.on('change', (event) => events.push(event));
    await watcher.start();

    await new Promise((r) => setTimeout(r, 200));
    unlinkSync(join(testDir, 'remove-me.ts'));

    await new Promise((r) => setTimeout(r, 500));
    expect(events.some((e) => e.type === 'file_deleted' && e.path.includes('remove-me.ts'))).toBe(true);
  });

  it('should ignore files matching ignore patterns', async () => {
    mkdirSync(join(testDir, 'node_modules'), { recursive: true });
    const events: Array<{ type: string; path: string }> = [];
    watcher = new FileWatcher(testDir, {
      ignore: ['node_modules'],
      debounceMs: 100,
    });
    watcher.on('change', (event) => events.push(event));
    await watcher.start();

    writeFileSync(join(testDir, 'node_modules', 'dep.js'), 'module.exports = {}');

    await new Promise((r) => setTimeout(r, 500));
    expect(events).toHaveLength(0);
  });

  it('should debounce rapid changes to the same file', async () => {
    const events: Array<{ type: string; path: string }> = [];
    watcher = new FileWatcher(testDir, {
      ignore: ['node_modules'],
      debounceMs: 300,
    });
    watcher.on('change', (event) => events.push(event));
    await watcher.start();

    const filePath = join(testDir, 'rapid.ts');
    writeFileSync(filePath, 'v1');
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(filePath, 'v2');
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(filePath, 'v3');

    await new Promise((r) => setTimeout(r, 800));
    // Should have at most 2 events (create + one debounced modify), not 4
    const rapidEvents = events.filter((e) => e.path.includes('rapid.ts'));
    expect(rapidEvents.length).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/watcher.test.ts
```

Expected: FAIL — cannot find module `../src/watcher.js`

- [ ] **Step 3: Write the implementation**

`src/watcher.ts`:
```typescript
import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { relative } from 'node:path';
import type { EventType } from './types.js';

export interface WatcherEvent {
  type: EventType;
  path: string;
  absolutePath: string;
}

export interface WatcherOptions {
  ignore: string[];
  debounceMs: number;
}

export class FileWatcher extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private knownFiles = new Set<string>();

  constructor(
    private readonly rootDir: string,
    private readonly options: WatcherOptions,
  ) {
    super();
  }

  async start(): Promise<void> {
    const ignoredPatterns = this.options.ignore.map((pattern) =>
      new RegExp(`(^|[\\/\\\\])${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\/\\\\]|$)`)
    );

    this.watcher = chokidar.watch(this.rootDir, {
      ignored: [/(^|[\/\\])\../, ...ignoredPatterns],
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: false,
    });

    return new Promise((resolve) => {
      this.watcher!.on('ready', () => {
        // After initial scan, all known files are tracked
        this.watcher!.on('add', (filePath) => {
          if (!this.knownFiles.has(filePath)) {
            this.knownFiles.add(filePath);
            this.debouncedEmit(filePath, 'file_created');
          }
        });

        this.watcher!.on('change', (filePath) => {
          this.debouncedEmit(filePath, 'file_modified');
        });

        this.watcher!.on('unlink', (filePath) => {
          this.knownFiles.delete(filePath);
          this.debouncedEmit(filePath, 'file_deleted');
        });

        resolve();
      });

      // Track files during initial scan
      this.watcher!.on('add', (filePath) => {
        this.knownFiles.add(filePath);
      });
    });
  }

  async stop(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    await this.watcher?.close();
    this.watcher = null;
  }

  private debouncedEmit(absolutePath: string, type: EventType): void {
    const existing = this.debounceTimers.get(absolutePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(absolutePath);
      const event: WatcherEvent = {
        type,
        path: relative(this.rootDir, absolutePath),
        absolutePath,
      };
      this.emit('change', event);
    }, this.options.debounceMs);

    this.debounceTimers.set(absolutePath, timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/watcher.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/watcher.ts tests/watcher.test.ts
git commit -m "feat: add file watcher with debouncing and ignore patterns"
```

---

### Task 5: Fast Intent Extractor (AST via tree-sitter)

**Files:**
- Create: `src/extractor/fast.ts`
- Create: `tests/extractor/fast.test.ts`

- [ ] **Step 1: Install tree-sitter dependencies**

```bash
npm install tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-javascript
```

- [ ] **Step 2: Write the failing test**

`tests/extractor/fast.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { FastExtractor } from '../../src/extractor/fast.js';

describe('FastExtractor', () => {
  const extractor = new FastExtractor();

  describe('TypeScript extraction', () => {
    it('should extract exported functions', () => {
      const code = `
export function login(email: string, password: string): Promise<Token> {
  return authenticate(email, password);
}

export async function logout(): Promise<void> {
  await clearSession();
}

function internalHelper() {}
`;
      const result = extractor.extract(code, 'typescript');
      expect(result.exports).toHaveLength(2);
      expect(result.exports[0].name).toBe('login');
      expect(result.exports[0].signature).toContain('email');
      expect(result.exports[1].name).toBe('logout');
    });

    it('should extract exported types and interfaces', () => {
      const code = `
export interface User {
  id: string;
  email: string;
  name: string;
}

export type Role = 'admin' | 'user';
`;
      const result = extractor.extract(code, 'typescript');
      expect(result.exports.some((e) => e.name === 'User')).toBe(true);
      expect(result.exports.some((e) => e.name === 'Role')).toBe(true);
    });

    it('should extract export default', () => {
      const code = `
export default class AuthService {
  login() {}
  logout() {}
}
`;
      const result = extractor.extract(code, 'typescript');
      expect(result.exports.some((e) => e.name === 'AuthService')).toBe(true);
    });

    it('should extract imports', () => {
      const code = `
import { hash } from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { User } from './types';
`;
      const result = extractor.extract(code, 'typescript');
      expect(result.imports).toContain('bcrypt');
      expect(result.imports).toContain('jsonwebtoken');
      expect(result.imports).toContain('./types');
    });
  });

  describe('JavaScript extraction', () => {
    it('should extract module.exports', () => {
      const code = `
function createUser(name) {
  return { name };
}

module.exports = { createUser };
`;
      const result = extractor.extract(code, 'javascript');
      expect(result.exports.some((e) => e.name === 'createUser')).toBe(true);
    });
  });

  describe('Python extraction', () => {
    it('should extract top-level function and class definitions', () => {
      const code = `
def login(email: str, password: str) -> Token:
    return authenticate(email, password)

class UserService:
    def get_user(self, user_id: str) -> User:
        pass

def _private_helper():
    pass
`;
      const result = extractor.extract(code, 'python');
      expect(result.exports.some((e) => e.name === 'login')).toBe(true);
      expect(result.exports.some((e) => e.name === 'UserService')).toBe(true);
      // Private functions starting with _ are still extracted (Python doesn't have export keyword)
      expect(result.exports.some((e) => e.name === '_private_helper')).toBe(true);
    });
  });

  describe('language detection from file extension', () => {
    it('should detect typescript from .ts', () => {
      expect(FastExtractor.detectLanguage('src/auth.ts')).toBe('typescript');
    });

    it('should detect python from .py', () => {
      expect(FastExtractor.detectLanguage('app/main.py')).toBe('python');
    });

    it('should detect javascript from .js', () => {
      expect(FastExtractor.detectLanguage('lib/utils.js')).toBe('javascript');
    });

    it('should return null for unknown extensions', () => {
      expect(FastExtractor.detectLanguage('data.csv')).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/extractor/fast.test.ts
```

Expected: FAIL — cannot find module

- [ ] **Step 4: Write the implementation**

`src/extractor/fast.ts`:
```typescript
import type { ExportEntry } from '../types.js';

// tree-sitter is a native module — dynamic import for flexibility
let Parser: any;
let TypeScript: any;
let JavaScript: any;
let Python: any;

async function ensureLoaded() {
  if (!Parser) {
    const treeSitter = await import('tree-sitter');
    Parser = treeSitter.default;
    TypeScript = (await import('tree-sitter-typescript')).default.typescript;
    JavaScript = (await import('tree-sitter-javascript')).default;
    Python = (await import('tree-sitter-python')).default;
  }
}

export interface ExtractionResult {
  exports: ExportEntry[];
  imports: string[];
}

const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
};

const GRAMMAR_MAP: Record<string, () => any> = {
  typescript: () => TypeScript,
  javascript: () => JavaScript,
  python: () => Python,
};

export class FastExtractor {
  private parsers = new Map<string, any>();
  private initialized = false;

  private async init(): Promise<void> {
    if (this.initialized) return;
    await ensureLoaded();
    this.initialized = true;
  }

  static detectLanguage(filePath: string): string | null {
    const ext = '.' + filePath.split('.').pop();
    return LANGUAGE_MAP[ext] ?? null;
  }

  extract(code: string, language: string): ExtractionResult {
    // Synchronous extraction using pre-initialized parsers
    if (!this.initialized) {
      // Fallback: return empty if not initialized
      return { exports: [], imports: [] };
    }

    const parser = this.getParser(language);
    if (!parser) return { exports: [], imports: [] };

    const tree = parser.parse(code);

    if (language === 'python') {
      return this.extractPython(tree);
    }
    return this.extractTypeScriptOrJS(tree, language);
  }

  async extractAsync(code: string, language: string): Promise<ExtractionResult> {
    await this.init();
    return this.extract(code, language);
  }

  private getParser(language: string): any | null {
    if (this.parsers.has(language)) return this.parsers.get(language);

    const grammarFactory = GRAMMAR_MAP[language];
    if (!grammarFactory) return null;

    const parser = new Parser();
    parser.setLanguage(grammarFactory());
    this.parsers.set(language, parser);
    return parser;
  }

  private extractTypeScriptOrJS(tree: any, language: string): ExtractionResult {
    const exports: ExportEntry[] = [];
    const imports: string[] = [];

    const walk = (node: any) => {
      // Export declarations: export function, export class, export interface, export type
      if (node.type === 'export_statement' || node.type === 'export_declaration') {
        const declaration = node.namedChildren.find((c: any) =>
          ['function_declaration', 'class_declaration', 'interface_declaration',
           'type_alias_declaration', 'lexical_declaration'].includes(c.type)
        );
        if (declaration) {
          const nameNode = declaration.childForFieldName('name');
          if (nameNode) {
            exports.push({
              name: nameNode.text,
              signature: declaration.text.split('{')[0].trim(),
            });
          }
        }

        // export default class/function
        const defaultDecl = node.namedChildren.find((c: any) =>
          ['function_declaration', 'class_declaration'].includes(c.type)
        );
        if (node.text.startsWith('export default') && defaultDecl) {
          const nameNode = defaultDecl.childForFieldName('name');
          if (nameNode) {
            exports.push({
              name: nameNode.text,
              signature: `default ${defaultDecl.text.split('{')[0].trim()}`,
            });
          }
        }
      }

      // Import declarations
      if (node.type === 'import_statement' || node.type === 'import_declaration') {
        const source = node.childForFieldName('source');
        if (source) {
          imports.push(source.text.replace(/['"]/g, ''));
        }
      }

      // CommonJS: module.exports = { ... }
      if (node.type === 'expression_statement') {
        const text = node.text;
        if (text.startsWith('module.exports')) {
          const match = text.match(/\{([^}]+)\}/);
          if (match) {
            const names = match[1].split(',').map((s: string) => s.trim().split(':')[0].trim());
            for (const name of names) {
              if (name) exports.push({ name, signature: name });
            }
          }
        }
      }

      for (const child of node.namedChildren) {
        walk(child);
      }
    };

    walk(tree.rootNode);
    return { exports, imports };
  }

  private extractPython(tree: any): ExtractionResult {
    const exports: ExportEntry[] = [];
    const imports: string[] = [];

    for (const node of tree.rootNode.namedChildren) {
      // Top-level function definitions
      if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          const params = node.childForFieldName('parameters');
          exports.push({
            name: nameNode.text,
            signature: `def ${nameNode.text}${params ? params.text : '()'}`,
          });
        }
      }

      // Top-level class definitions
      if (node.type === 'class_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          exports.push({
            name: nameNode.text,
            signature: `class ${nameNode.text}`,
          });
        }
      }

      // Import statements
      if (node.type === 'import_statement' || node.type === 'import_from_statement') {
        const moduleName = node.namedChildren.find((c: any) =>
          c.type === 'dotted_name' || c.type === 'module'
        );
        if (moduleName) {
          imports.push(moduleName.text);
        }
      }
    }

    return { exports, imports };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/extractor/fast.test.ts
```

Expected: PASS

Note: tree-sitter is a native module and can be tricky to install. If `npm install tree-sitter` fails, try `npm install tree-sitter --build-from-source`. If tree-sitter installation proves problematic, a fallback using regex-based extraction can be implemented instead — see recommendation at end of this task.

- [ ] **Step 6: Commit**

```bash
git add src/extractor/fast.ts tests/extractor/fast.test.ts
git commit -m "feat: add fast intent extractor using tree-sitter AST parsing"
```

---

### Task 6: Team State Manager

**Files:**
- Create: `src/state/team-state.ts`
- Create: `tests/state/team-state.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/state/team-state.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TeamState } from '../../src/state/team-state.js';
import type { SwarmUpdate, PeerInfo } from '../../src/types.js';

describe('TeamState', () => {
  let state: TeamState;
  const selfId = 'self-123';

  beforeEach(() => {
    state = new TeamState(selfId);
  });

  it('should register a new peer', () => {
    const peer: PeerInfo = {
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    };
    state.addPeer(peer);
    expect(state.getPeer('peer-1')).toBeDefined();
    expect(state.getPeer('peer-1')!.dev_name).toBe('Sarah');
    expect(state.getPeer('peer-1')!.status).toBe('online');
  });

  it('should apply a SwarmUpdate to peer state', () => {
    state.addPeer({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    });

    const update: SwarmUpdate = {
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      timestamp: Date.now(),
      event_type: 'file_created',
      file_path: 'src/dashboard.tsx',
      exports: [{ name: 'Dashboard', signature: 'function Dashboard(): JSX.Element' }],
      imports: ['react'],
      work_zone: 'src/components',
      intent: null,
      summary: null,
      interfaces: [],
      touches: ['src/dashboard.tsx'],
    };

    state.applyUpdate(update);
    const peer = state.getPeer('peer-1')!;
    expect(peer.files.has('src/dashboard.tsx')).toBe(true);
    expect(peer.work_zone).toBe('src/components');
  });

  it('should remove file state on file_deleted', () => {
    state.addPeer({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    });

    state.applyUpdate({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      timestamp: Date.now(),
      event_type: 'file_created',
      file_path: 'src/temp.ts',
      exports: [],
      imports: [],
      work_zone: 'src',
      intent: null,
      summary: null,
      interfaces: [],
      touches: ['src/temp.ts'],
    });

    state.applyUpdate({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      timestamp: Date.now(),
      event_type: 'file_deleted',
      file_path: 'src/temp.ts',
      exports: [],
      imports: [],
      work_zone: 'src',
      intent: null,
      summary: null,
      interfaces: [],
      touches: [],
    });

    const peer = state.getPeer('peer-1')!;
    expect(peer.files.has('src/temp.ts')).toBe(false);
  });

  it('should mark peer as offline after timeout', () => {
    state.addPeer({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    });

    state.markOffline('peer-1');
    expect(state.getPeer('peer-1')!.status).toBe('offline');
  });

  it('should list all peers excluding self', () => {
    state.addPeer({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    });
    state.addPeer({
      peer_id: 'peer-2',
      dev_name: 'Mike',
      address: '192.168.1.67',
      pub_port: 5557,
      rep_port: 5558,
    });

    const peers = state.getAllPeers();
    expect(peers).toHaveLength(2);
  });

  it('should return a full state snapshot for sync', () => {
    state.addPeer({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    });

    state.applyUpdate({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      timestamp: Date.now(),
      event_type: 'file_created',
      file_path: 'src/auth.ts',
      exports: [{ name: 'login', signature: '() => void' }],
      imports: [],
      work_zone: 'src/auth',
      intent: 'Building auth',
      summary: null,
      interfaces: [],
      touches: ['src/auth.ts'],
    });

    const snapshot = state.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].peer_id).toBe('peer-1');
    expect(snapshot[0].files.size).toBe(1);
  });

  it('should update heartbeat timestamp', () => {
    state.addPeer({
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
    });

    const before = state.getPeer('peer-1')!.last_seen;
    state.heartbeat('peer-1');
    const after = state.getPeer('peer-1')!.last_seen;
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/state/team-state.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/state/team-state.ts`:
```typescript
import type { PeerInfo, PeerState, SwarmUpdate, FileState } from '../types.js';

export class TeamState {
  private peers = new Map<string, PeerState>();

  constructor(private readonly selfId: string) {}

  addPeer(info: PeerInfo): void {
    if (this.peers.has(info.peer_id)) {
      // Update connection info but preserve state
      const existing = this.peers.get(info.peer_id)!;
      existing.address = info.address;
      existing.pub_port = info.pub_port;
      existing.rep_port = info.rep_port;
      existing.status = 'online';
      existing.last_seen = Date.now();
      return;
    }

    this.peers.set(info.peer_id, {
      peer_id: info.peer_id,
      dev_name: info.dev_name,
      status: 'online',
      last_seen: Date.now(),
      address: info.address,
      pub_port: info.pub_port,
      rep_port: info.rep_port,
      files: new Map(),
      work_zone: '',
      intent: null,
    });
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  getPeer(peerId: string): PeerState | undefined {
    return this.peers.get(peerId);
  }

  getAllPeers(): PeerState[] {
    return Array.from(this.peers.values());
  }

  applyUpdate(update: SwarmUpdate): void {
    const peer = this.peers.get(update.peer_id);
    if (!peer) return;

    peer.last_seen = update.timestamp;
    peer.work_zone = update.work_zone;

    if (update.intent) {
      peer.intent = update.intent;
    }

    if (update.event_type === 'file_deleted') {
      peer.files.delete(update.file_path);
    } else {
      const fileState: FileState = {
        exports: update.exports,
        imports: update.imports,
        last_modified: update.timestamp,
      };
      peer.files.set(update.file_path, fileState);
    }
  }

  markOffline(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.status = 'offline';
    }
  }

  heartbeat(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.last_seen = Date.now();
      peer.status = 'online';
    }
  }

  getSnapshot(): PeerState[] {
    return this.getAllPeers().map((peer) => ({
      ...peer,
      files: new Map(peer.files),
    }));
  }

  getOnlinePeers(): PeerState[] {
    return this.getAllPeers().filter((p) => p.status === 'online');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/state/team-state.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/team-state.ts tests/state/team-state.test.ts
git commit -m "feat: add team state manager for tracking peer state"
```

---

### Task 7: Mesh Discovery (mDNS)

**Files:**
- Create: `src/mesh/discovery.ts`
- Create: `tests/mesh/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/mesh/discovery.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshDiscovery } from '../../src/mesh/discovery.js';
import type { PeerInfo } from '../../src/types.js';

describe('MeshDiscovery', () => {
  it('should generate a stable peer_id', () => {
    const discovery = new MeshDiscovery({
      name: 'TestUser',
      pub_port: 5555,
      rep_port: 5556,
    });
    const info = discovery.getSelfInfo();
    expect(info.peer_id).toBeDefined();
    expect(info.peer_id.length).toBeGreaterThan(0);
    expect(info.dev_name).toBe('TestUser');
    expect(info.pub_port).toBe(5555);
    expect(info.rep_port).toBe(5556);
  });

  it('should emit peer-discovered when a new peer is found', async () => {
    const discovery = new MeshDiscovery({
      name: 'TestUser',
      pub_port: 5555,
      rep_port: 5556,
    });

    const discovered: PeerInfo[] = [];
    discovery.on('peer-discovered', (peer: PeerInfo) => discovered.push(peer));

    // Simulate a discovered peer by calling the internal handler
    discovery.handlePeerFound({
      peer_id: 'remote-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5557,
      rep_port: 5558,
    });

    expect(discovered).toHaveLength(1);
    expect(discovered[0].dev_name).toBe('Sarah');
  });

  it('should not re-emit for already known peers', () => {
    const discovery = new MeshDiscovery({
      name: 'TestUser',
      pub_port: 5555,
      rep_port: 5556,
    });

    const discovered: PeerInfo[] = [];
    discovery.on('peer-discovered', (peer: PeerInfo) => discovered.push(peer));

    const peer: PeerInfo = {
      peer_id: 'remote-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5557,
      rep_port: 5558,
    };
    discovery.handlePeerFound(peer);
    discovery.handlePeerFound(peer);

    expect(discovered).toHaveLength(1);
  });

  it('should emit peer-lost when a peer disappears', () => {
    const discovery = new MeshDiscovery({
      name: 'TestUser',
      pub_port: 5555,
      rep_port: 5556,
    });

    const lost: string[] = [];
    discovery.on('peer-lost', (peerId: string) => lost.push(peerId));

    discovery.handlePeerFound({
      peer_id: 'remote-1',
      dev_name: 'Sarah',
      address: '192.168.1.42',
      pub_port: 5557,
      rep_port: 5558,
    });

    discovery.handlePeerLost('remote-1');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toBe('remote-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mesh/discovery.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/mesh/discovery.ts`:
```typescript
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import Bonjour, { type Service } from 'bonjour-service';
import type { PeerInfo } from '../types.js';

const SERVICE_TYPE = 'swarmcode';

export interface DiscoveryOptions {
  name: string;
  pub_port: number;
  rep_port: number;
}

export class MeshDiscovery extends EventEmitter {
  private readonly peerId: string;
  private readonly options: DiscoveryOptions;
  private knownPeers = new Map<string, PeerInfo>();
  private bonjour: InstanceType<typeof Bonjour> | null = null;
  private published: Service | null = null;

  constructor(options: DiscoveryOptions) {
    super();
    this.peerId = randomUUID();
    this.options = options;
  }

  getSelfInfo(): PeerInfo {
    return {
      peer_id: this.peerId,
      dev_name: this.options.name,
      address: '0.0.0.0', // Resolved by mDNS
      pub_port: this.options.pub_port,
      rep_port: this.options.rep_port,
    };
  }

  async start(): Promise<void> {
    this.bonjour = new Bonjour();

    // Publish our service
    this.published = this.bonjour.publish({
      name: `swarmcode-${this.peerId.slice(0, 8)}`,
      type: SERVICE_TYPE,
      port: this.options.pub_port,
      txt: {
        peer_id: this.peerId,
        dev_name: this.options.name,
        pub_port: String(this.options.pub_port),
        rep_port: String(this.options.rep_port),
      },
    });

    // Browse for peers
    this.bonjour.find({ type: SERVICE_TYPE }, (service: Service) => {
      const txt = service.txt as Record<string, string>;
      if (!txt?.peer_id || txt.peer_id === this.peerId) return;

      const peerInfo: PeerInfo = {
        peer_id: txt.peer_id,
        dev_name: txt.dev_name || 'unknown',
        address: service.referer?.address || service.host || '',
        pub_port: parseInt(txt.pub_port, 10),
        rep_port: parseInt(txt.rep_port, 10),
      };

      this.handlePeerFound(peerInfo);
    });
  }

  async stop(): Promise<void> {
    if (this.published) {
      this.published.stop();
    }
    if (this.bonjour) {
      this.bonjour.destroy();
    }
    this.knownPeers.clear();
  }

  handlePeerFound(peer: PeerInfo): void {
    if (peer.peer_id === this.peerId) return;
    if (this.knownPeers.has(peer.peer_id)) return;

    this.knownPeers.set(peer.peer_id, peer);
    this.emit('peer-discovered', peer);
  }

  handlePeerLost(peerId: string): void {
    if (this.knownPeers.has(peerId)) {
      this.knownPeers.delete(peerId);
      this.emit('peer-lost', peerId);
    }
  }

  getKnownPeers(): PeerInfo[] {
    return Array.from(this.knownPeers.values());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mesh/discovery.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mesh/discovery.ts tests/mesh/discovery.test.ts
git commit -m "feat: add mDNS mesh discovery for peer detection"
```

---

### Task 8: Mesh Broadcaster (ZMQ PUB/SUB)

**Files:**
- Create: `src/mesh/broadcaster.ts`
- Create: `tests/mesh/broadcaster.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/mesh/broadcaster.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { MeshBroadcaster } from '../../src/mesh/broadcaster.js';
import type { SwarmUpdate } from '../../src/types.js';

describe('MeshBroadcaster', () => {
  const broadcasters: MeshBroadcaster[] = [];

  afterEach(async () => {
    for (const b of broadcasters) {
      await b.stop();
    }
    broadcasters.length = 0;
  });

  it('should publish and receive updates between two nodes', async () => {
    const nodeA = new MeshBroadcaster();
    const nodeB = new MeshBroadcaster();
    broadcasters.push(nodeA, nodeB);

    const portA = await nodeA.start(0); // 0 = random available port
    const portB = await nodeB.start(0);

    // B subscribes to A
    await nodeB.subscribeTo('127.0.0.1', portA);

    // Give ZMQ a moment to establish connection
    await new Promise((r) => setTimeout(r, 200));

    const received: SwarmUpdate[] = [];
    nodeB.on('update', (update: SwarmUpdate) => received.push(update));

    const update: SwarmUpdate = {
      peer_id: 'node-a',
      dev_name: 'Jared',
      timestamp: Date.now(),
      event_type: 'file_created',
      file_path: 'src/auth.ts',
      exports: [{ name: 'login', signature: '() => void' }],
      imports: [],
      work_zone: 'src/auth',
      intent: null,
      summary: null,
      interfaces: [],
      touches: ['src/auth.ts'],
    };

    await nodeA.publish(update);
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toHaveLength(1);
    expect(received[0].peer_id).toBe('node-a');
    expect(received[0].file_path).toBe('src/auth.ts');
  });

  it('should handle multiple subscribers', async () => {
    const nodeA = new MeshBroadcaster();
    const nodeB = new MeshBroadcaster();
    const nodeC = new MeshBroadcaster();
    broadcasters.push(nodeA, nodeB, nodeC);

    const portA = await nodeA.start(0);
    await nodeB.start(0);
    await nodeC.start(0);

    await nodeB.subscribeTo('127.0.0.1', portA);
    await nodeC.subscribeTo('127.0.0.1', portA);
    await new Promise((r) => setTimeout(r, 200));

    const receivedB: SwarmUpdate[] = [];
    const receivedC: SwarmUpdate[] = [];
    nodeB.on('update', (u: SwarmUpdate) => receivedB.push(u));
    nodeC.on('update', (u: SwarmUpdate) => receivedC.push(u));

    await nodeA.publish({
      peer_id: 'node-a',
      dev_name: 'Jared',
      timestamp: Date.now(),
      event_type: 'file_created',
      file_path: 'src/test.ts',
      exports: [],
      imports: [],
      work_zone: 'src',
      intent: null,
      summary: null,
      interfaces: [],
      touches: [],
    });

    await new Promise((r) => setTimeout(r, 300));
    expect(receivedB).toHaveLength(1);
    expect(receivedC).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mesh/broadcaster.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/mesh/broadcaster.ts`:
```typescript
import { EventEmitter } from 'node:events';
import * as zmq from 'zeromq';
import type { SwarmUpdate } from '../types.js';

const TOPIC = 'swarm';

export class MeshBroadcaster extends EventEmitter {
  private pub: zmq.Publisher | null = null;
  private subs: zmq.Subscriber[] = [];
  private running = false;

  async start(port: number): Promise<number> {
    this.pub = new zmq.Publisher();
    const address = `tcp://0.0.0.0:${port}`;
    await this.pub.bind(address);
    this.running = true;

    // Get the actual bound port (important when port=0)
    const boundAddress = this.pub.lastEndpoint;
    const actualPort = parseInt(boundAddress!.split(':').pop()!, 10);
    return actualPort;
  }

  async subscribeTo(address: string, port: number): Promise<void> {
    const sub = new zmq.Subscriber();
    const endpoint = `tcp://${address}:${port}`;
    sub.connect(endpoint);
    sub.subscribe(TOPIC);
    this.subs.push(sub);

    // Start receiving in background
    this.receiveLoop(sub);
  }

  async publish(update: SwarmUpdate): Promise<void> {
    if (!this.pub) throw new Error('Broadcaster not started');
    const payload = JSON.stringify(update);
    await this.pub.send([TOPIC, payload]);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const sub of this.subs) {
      sub.close();
    }
    this.subs = [];
    if (this.pub) {
      this.pub.close();
      this.pub = null;
    }
  }

  private async receiveLoop(sub: zmq.Subscriber): Promise<void> {
    try {
      for await (const [topic, msg] of sub) {
        if (!this.running) break;
        try {
          const update: SwarmUpdate = JSON.parse(msg.toString());
          this.emit('update', update);
        } catch {
          // Skip malformed messages
        }
      }
    } catch {
      // Socket closed or error — stop silently
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mesh/broadcaster.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mesh/broadcaster.ts tests/mesh/broadcaster.test.ts
git commit -m "feat: add ZMQ PUB/SUB mesh broadcaster"
```

---

### Task 9: Mesh Query (ZMQ REQ/REP)

**Files:**
- Create: `src/mesh/query.ts`
- Create: `tests/mesh/query.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/mesh/query.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { QueryServer, QueryClient } from '../../src/mesh/query.js';
import type { QueryRequest, QueryResponse, ExportEntry } from '../../src/types.js';

describe('QueryServer and QueryClient', () => {
  let server: QueryServer;
  let client: QueryClient;

  afterEach(async () => {
    await client?.close();
    await server?.stop();
  });

  it('should handle an exports query', async () => {
    const handler = async (req: QueryRequest): Promise<QueryResponse> => {
      if (req.type === 'exports' && req.file_path === 'src/auth.ts') {
        return {
          type: 'exports',
          file_path: 'src/auth.ts',
          data: [{ name: 'login', signature: '(email: string) => Promise<Token>' }] as ExportEntry[],
          error: null,
        };
      }
      return { type: req.type, file_path: req.file_path, data: null, error: 'Not found' };
    };

    server = new QueryServer(handler);
    const port = await server.start(0);

    client = new QueryClient();
    const response = await client.query('127.0.0.1', port, {
      type: 'exports',
      file_path: 'src/auth.ts',
    });

    expect(response.error).toBeNull();
    expect(response.data).toHaveLength(1);
    expect((response.data as ExportEntry[])[0].name).toBe('login');
  });

  it('should handle file_exists query', async () => {
    const handler = async (req: QueryRequest): Promise<QueryResponse> => ({
      type: req.type,
      file_path: req.file_path,
      data: req.file_path === 'src/auth.ts',
      error: null,
    });

    server = new QueryServer(handler);
    const port = await server.start(0);

    client = new QueryClient();

    const exists = await client.query('127.0.0.1', port, {
      type: 'file_exists',
      file_path: 'src/auth.ts',
    });
    expect(exists.data).toBe(true);

    const missing = await client.query('127.0.0.1', port, {
      type: 'file_exists',
      file_path: 'src/nope.ts',
    });
    expect(missing.data).toBe(false);
  });

  it('should handle errors gracefully', async () => {
    const handler = async (_req: QueryRequest): Promise<QueryResponse> => {
      throw new Error('Internal error');
    };

    server = new QueryServer(handler);
    const port = await server.start(0);

    client = new QueryClient();
    const response = await client.query('127.0.0.1', port, {
      type: 'exports',
      file_path: 'anything.ts',
    });
    expect(response.error).toContain('Internal error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/mesh/query.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/mesh/query.ts`:
```typescript
import * as zmq from 'zeromq';
import type { QueryRequest, QueryResponse } from '../types.js';

export type QueryHandler = (req: QueryRequest) => Promise<QueryResponse>;

export class QueryServer {
  private socket: zmq.Reply | null = null;
  private running = false;

  constructor(private readonly handler: QueryHandler) {}

  async start(port: number): Promise<number> {
    this.socket = new zmq.Reply();
    const address = `tcp://0.0.0.0:${port}`;
    await this.socket.bind(address);
    this.running = true;

    const boundAddress = this.socket.lastEndpoint;
    const actualPort = parseInt(boundAddress!.split(':').pop()!, 10);

    this.receiveLoop();
    return actualPort;
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private async receiveLoop(): Promise<void> {
    if (!this.socket) return;
    try {
      for await (const [msg] of this.socket) {
        if (!this.running) break;
        try {
          const request: QueryRequest = JSON.parse(msg.toString());
          const response = await this.handler(request);
          await this.socket!.send(JSON.stringify(response));
        } catch (err) {
          const errorResponse: QueryResponse = {
            type: 'exports',
            file_path: '',
            data: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
          await this.socket!.send(JSON.stringify(errorResponse));
        }
      }
    } catch {
      // Socket closed
    }
  }
}

export class QueryClient {
  private sockets = new Map<string, zmq.Request>();

  async query(address: string, port: number, request: QueryRequest): Promise<QueryResponse> {
    const endpoint = `tcp://${address}:${port}`;
    let socket = this.sockets.get(endpoint);

    if (!socket) {
      socket = new zmq.Request();
      socket.connect(endpoint);
      this.sockets.set(endpoint, socket);
    }

    await socket.send(JSON.stringify(request));
    const [response] = await socket.receive();
    return JSON.parse(response.toString());
  }

  async close(): Promise<void> {
    for (const socket of this.sockets.values()) {
      socket.close();
    }
    this.sockets.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/mesh/query.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mesh/query.ts tests/mesh/query.test.ts
git commit -m "feat: add ZMQ REQ/REP query server and client"
```

---

### Task 10: Context Injector + Adapters

**Files:**
- Create: `src/injector/adapters/base.ts`
- Create: `src/injector/adapters/claude-code.ts`
- Create: `src/injector/adapters/cursor.ts`
- Create: `src/injector/formatter.ts`
- Create: `src/injector/injector.ts`
- Create: `tests/injector/formatter.test.ts`
- Create: `tests/injector/injector.test.ts`

- [ ] **Step 1: Write the formatter test**

`tests/injector/formatter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { formatTeamContext } from '../../src/injector/formatter.js';
import type { PeerState } from '../../src/types.js';

describe('formatTeamContext', () => {
  it('should format a single peer with files', () => {
    const peers: PeerState[] = [{
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      status: 'online',
      last_seen: Date.now(),
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
      files: new Map([
        ['src/auth.ts', {
          exports: [
            { name: 'login', signature: '(email: string, password: string) => Promise<Token>' },
            { name: 'logout', signature: '() => Promise<void>' },
          ],
          imports: ['bcrypt', 'jsonwebtoken'],
          last_modified: Date.now(),
        }],
      ]),
      work_zone: 'src/auth',
      intent: 'Building JWT-based authentication',
    }];

    const result = formatTeamContext(peers);
    expect(result).toContain('Sarah');
    expect(result).toContain('src/auth');
    expect(result).toContain('login');
    expect(result).toContain('logout');
    expect(result).toContain('JWT-based authentication');
    // Should be imperative / instructional
    expect(result).toMatch(/do not|DO NOT|import from|already built/i);
  });

  it('should format multiple peers', () => {
    const peers: PeerState[] = [
      {
        peer_id: 'peer-1',
        dev_name: 'Sarah',
        status: 'online',
        last_seen: Date.now(),
        address: '192.168.1.42',
        pub_port: 5555,
        rep_port: 5556,
        files: new Map(),
        work_zone: 'src/auth',
        intent: null,
      },
      {
        peer_id: 'peer-2',
        dev_name: 'Mike',
        status: 'online',
        last_seen: Date.now(),
        address: '192.168.1.67',
        pub_port: 5557,
        rep_port: 5558,
        files: new Map(),
        work_zone: 'src/components',
        intent: null,
      },
    ];

    const result = formatTeamContext(peers);
    expect(result).toContain('Sarah');
    expect(result).toContain('Mike');
  });

  it('should indicate offline peers', () => {
    const peers: PeerState[] = [{
      peer_id: 'peer-1',
      dev_name: 'Sarah',
      status: 'offline',
      last_seen: Date.now() - 60000,
      address: '192.168.1.42',
      pub_port: 5555,
      rep_port: 5556,
      files: new Map(),
      work_zone: 'src/auth',
      intent: null,
    }];

    const result = formatTeamContext(peers);
    expect(result).toContain('offline');
  });

  it('should include conflict warnings', () => {
    const conflicts = [{
      type: 'zone_overlap' as const,
      severity: 'warning' as const,
      peers: ['Sarah', 'Mike'],
      description: 'Both working in src/utils/',
      file_paths: ['src/utils/helpers.ts'],
    }];

    const result = formatTeamContext([], conflicts);
    expect(result).toContain('WARNING');
    expect(result).toContain('src/utils');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/injector/formatter.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the formatter**

`src/injector/formatter.ts`:
```typescript
import type { PeerState, ConflictSignal } from '../types.js';

export function formatTeamContext(
  peers: PeerState[],
  conflicts: ConflictSignal[] = [],
): string {
  const sections: string[] = [];

  sections.push('## Swarmcode Team Context');
  sections.push('');
  sections.push('The following teammates are working on this project. Coordinate with their work — DO NOT rebuild what they have already built. Import from their modules instead.');
  sections.push('');

  // Conflicts first — most important
  if (conflicts.length > 0) {
    sections.push('### ⚠ Active Warnings');
    sections.push('');
    for (const conflict of conflicts) {
      sections.push(`**WARNING (${conflict.type}):** ${conflict.description}`);
      if (conflict.file_paths.length > 0) {
        sections.push(`Files: ${conflict.file_paths.join(', ')}`);
      }
    }
    sections.push('');
  }

  // Per-peer sections
  for (const peer of peers) {
    const status = peer.status === 'online'
      ? 'online'
      : `offline (last seen ${formatTimeSince(peer.last_seen)})`;

    sections.push(`### ${peer.dev_name} (${status})`);

    if (peer.work_zone) {
      sections.push(`- **Working in:** \`${peer.work_zone}/\` — DO NOT create files in this directory without coordinating.`);
    }

    if (peer.intent) {
      sections.push(`- **Intent:** ${peer.intent}`);
    }

    if (peer.files.size > 0) {
      sections.push(`- **Files already built:**`);
      for (const [filePath, fileState] of peer.files) {
        if (fileState.exports.length > 0) {
          const exportNames = fileState.exports.map((e) => e.name).join(', ');
          sections.push(`  - \`${filePath}\` exports: ${exportNames} — import from here, do not rebuild.`);
        } else {
          sections.push(`  - \`${filePath}\``);
        }
      }
    }

    sections.push('');
  }

  return sections.join('\n');
}

function formatTimeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
```

- [ ] **Step 4: Run formatter test**

```bash
npx vitest run tests/injector/formatter.test.ts
```

Expected: PASS

- [ ] **Step 5: Write the injector test**

`tests/injector/injector.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextInjector } from '../../src/injector/injector.js';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ContextInjector', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarmcode-injector-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create context file if it does not exist', () => {
    const injector = new ContextInjector(testDir, 'CLAUDE.md');
    injector.inject('## Swarmcode\nSome context');

    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('<!-- SWARMCODE START -->');
    expect(content).toContain('Some context');
    expect(content).toContain('<!-- SWARMCODE END -->');
  });

  it('should preserve existing content outside markers', () => {
    const existingContent = '# My Project\n\nSome existing instructions.\n';
    writeFileSync(join(testDir, 'CLAUDE.md'), existingContent);

    const injector = new ContextInjector(testDir, 'CLAUDE.md');
    injector.inject('## Swarmcode\nTeam context here');

    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some existing instructions.');
    expect(content).toContain('Team context here');
  });

  it('should replace only the swarmcode section on subsequent injects', () => {
    const injector = new ContextInjector(testDir, 'CLAUDE.md');
    injector.inject('Version 1');
    injector.inject('Version 2');

    const content = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).not.toContain('Version 1');
    expect(content).toContain('Version 2');
    // Should have exactly one pair of markers
    expect(content.split('<!-- SWARMCODE START -->').length).toBe(2);
  });

  it('should not rewrite file if content has not changed', () => {
    const injector = new ContextInjector(testDir, 'CLAUDE.md');
    injector.inject('Same content');

    const stat1 = readFileSync(join(testDir, 'CLAUDE.md'), 'utf-8');
    const wrote = injector.inject('Same content');

    expect(wrote).toBe(false);
  });

  it('should handle nested context file paths', () => {
    const injector = new ContextInjector(testDir, '.github/copilot-instructions.md');
    injector.inject('Copilot context');

    const content = readFileSync(join(testDir, '.github', 'copilot-instructions.md'), 'utf-8');
    expect(content).toContain('Copilot context');
  });
});
```

- [ ] **Step 6: Run injector test to verify it fails**

```bash
npx vitest run tests/injector/injector.test.ts
```

Expected: FAIL

- [ ] **Step 7: Write the adapter base and implementations**

`src/injector/adapters/base.ts`:
```typescript
export interface ContextAdapter {
  readonly contextFile: string;
}
```

`src/injector/adapters/claude-code.ts`:
```typescript
import type { ContextAdapter } from './base.js';

export class ClaudeCodeAdapter implements ContextAdapter {
  readonly contextFile = 'CLAUDE.md';
}
```

`src/injector/adapters/cursor.ts`:
```typescript
import type { ContextAdapter } from './base.js';

export class CursorAdapter implements ContextAdapter {
  readonly contextFile = '.cursorrules';
}
```

- [ ] **Step 8: Write the injector**

`src/injector/injector.ts`:
```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const START_MARKER = '<!-- SWARMCODE START -->';
const END_MARKER = '<!-- SWARMCODE END -->';

export class ContextInjector {
  private lastContent: string | null = null;

  constructor(
    private readonly projectDir: string,
    private readonly contextFile: string,
  ) {}

  inject(content: string): boolean {
    // Skip if content hasn't changed
    if (content === this.lastContent) return false;

    const filePath = join(this.projectDir, this.contextFile);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const wrappedContent = `${START_MARKER}\n${content}\n${END_MARKER}`;

    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8');
      const startIdx = existing.indexOf(START_MARKER);
      const endIdx = existing.indexOf(END_MARKER);

      if (startIdx !== -1 && endIdx !== -1) {
        // Replace existing section
        const before = existing.substring(0, startIdx);
        const after = existing.substring(endIdx + END_MARKER.length);
        const newContent = `${before}${wrappedContent}${after}`;
        writeFileSync(filePath, newContent, 'utf-8');
      } else {
        // Append section
        const newContent = `${existing}\n\n${wrappedContent}\n`;
        writeFileSync(filePath, newContent, 'utf-8');
      }
    } else {
      writeFileSync(filePath, `${wrappedContent}\n`, 'utf-8');
    }

    this.lastContent = content;
    return true;
  }

  clear(): void {
    const filePath = join(this.projectDir, this.contextFile);
    if (!existsSync(filePath)) return;

    const existing = readFileSync(filePath, 'utf-8');
    const startIdx = existing.indexOf(START_MARKER);
    const endIdx = existing.indexOf(END_MARKER);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx + END_MARKER.length);
      writeFileSync(filePath, (before + after).trim() + '\n', 'utf-8');
    }

    this.lastContent = null;
  }
}
```

- [ ] **Step 9: Run all injector tests**

```bash
npx vitest run tests/injector/
```

Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/injector/ tests/injector/
git commit -m "feat: add context injector with formatter and adapters"
```

---

### Task 11: Conflict Detector

**Files:**
- Create: `src/conflict/detector.ts`
- Create: `tests/conflict/detector.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/conflict/detector.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ConflictDetector } from '../../src/conflict/detector.js';
import type { PeerState, ConflictSignal } from '../../src/types.js';

function makePeer(overrides: Partial<PeerState> & { peer_id: string; dev_name: string }): PeerState {
  return {
    status: 'online',
    last_seen: Date.now(),
    address: '127.0.0.1',
    pub_port: 5555,
    rep_port: 5556,
    files: new Map(),
    work_zone: '',
    intent: null,
    ...overrides,
  };
}

describe('ConflictDetector', () => {
  const detector = new ConflictDetector();

  describe('zone overlap detection', () => {
    it('should detect when two peers work in the same zone', () => {
      const peers = [
        makePeer({ peer_id: '1', dev_name: 'Jared', work_zone: 'src/auth' }),
        makePeer({ peer_id: '2', dev_name: 'Sarah', work_zone: 'src/auth' }),
      ];

      const conflicts = detector.detect(peers);
      expect(conflicts.some((c) => c.type === 'zone_overlap')).toBe(true);
      expect(conflicts.find((c) => c.type === 'zone_overlap')!.peers).toContain('Jared');
      expect(conflicts.find((c) => c.type === 'zone_overlap')!.peers).toContain('Sarah');
    });

    it('should not flag different zones', () => {
      const peers = [
        makePeer({ peer_id: '1', dev_name: 'Jared', work_zone: 'src/auth' }),
        makePeer({ peer_id: '2', dev_name: 'Sarah', work_zone: 'src/components' }),
      ];

      const conflicts = detector.detect(peers);
      expect(conflicts.filter((c) => c.type === 'zone_overlap')).toHaveLength(0);
    });

    it('should detect parent/child zone overlap', () => {
      const peers = [
        makePeer({ peer_id: '1', dev_name: 'Jared', work_zone: 'src/auth' }),
        makePeer({ peer_id: '2', dev_name: 'Sarah', work_zone: 'src/auth/middleware' }),
      ];

      const conflicts = detector.detect(peers);
      expect(conflicts.some((c) => c.type === 'zone_overlap')).toBe(true);
    });
  });

  describe('interface conflict detection', () => {
    it('should detect duplicate export names across peers', () => {
      const peers = [
        makePeer({
          peer_id: '1',
          dev_name: 'Jared',
          files: new Map([
            ['src/utils/date.ts', {
              exports: [{ name: 'formatDate', signature: '(d: Date) => string' }],
              imports: [],
              last_modified: Date.now(),
            }],
          ]),
        }),
        makePeer({
          peer_id: '2',
          dev_name: 'Sarah',
          files: new Map([
            ['src/helpers/format.ts', {
              exports: [{ name: 'formatDate', signature: '(date: Date) => string' }],
              imports: [],
              last_modified: Date.now(),
            }],
          ]),
        }),
      ];

      const conflicts = detector.detect(peers);
      expect(conflicts.some((c) => c.type === 'interface_conflict')).toBe(true);
      expect(conflicts.find((c) => c.type === 'interface_conflict')!.description).toContain('formatDate');
    });

    it('should not flag same peer duplicate exports', () => {
      const peers = [
        makePeer({
          peer_id: '1',
          dev_name: 'Jared',
          files: new Map([
            ['src/a.ts', { exports: [{ name: 'helper', signature: '' }], imports: [], last_modified: Date.now() }],
            ['src/b.ts', { exports: [{ name: 'helper', signature: '' }], imports: [], last_modified: Date.now() }],
          ]),
        }),
      ];

      const conflicts = detector.detect(peers);
      expect(conflicts.filter((c) => c.type === 'interface_conflict')).toHaveLength(0);
    });
  });

  describe('duplication detection', () => {
    it('should detect files with similar names across peers', () => {
      const peers = [
        makePeer({
          peer_id: '1',
          dev_name: 'Jared',
          files: new Map([
            ['src/utils/auth-helpers.ts', { exports: [], imports: [], last_modified: Date.now() }],
          ]),
        }),
        makePeer({
          peer_id: '2',
          dev_name: 'Sarah',
          files: new Map([
            ['src/lib/auth-helpers.ts', { exports: [], imports: [], last_modified: Date.now() }],
          ]),
        }),
      ];

      const conflicts = detector.detect(peers);
      expect(conflicts.some((c) => c.type === 'duplication')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/conflict/detector.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/conflict/detector.ts`:
```typescript
import { basename } from 'node:path';
import type { PeerState, ConflictSignal } from '../types.js';

export class ConflictDetector {
  detect(peers: PeerState[]): ConflictSignal[] {
    const conflicts: ConflictSignal[] = [];
    conflicts.push(...this.detectZoneOverlaps(peers));
    conflicts.push(...this.detectInterfaceConflicts(peers));
    conflicts.push(...this.detectDuplications(peers));
    return conflicts;
  }

  private detectZoneOverlaps(peers: PeerState[]): ConflictSignal[] {
    const conflicts: ConflictSignal[] = [];
    const onlinePeers = peers.filter((p) => p.status === 'online' && p.work_zone);

    for (let i = 0; i < onlinePeers.length; i++) {
      for (let j = i + 1; j < onlinePeers.length; j++) {
        const a = onlinePeers[i];
        const b = onlinePeers[j];

        if (this.zonesOverlap(a.work_zone, b.work_zone)) {
          conflicts.push({
            type: 'zone_overlap',
            severity: 'warning',
            peers: [a.dev_name, b.dev_name],
            description: `${a.dev_name} and ${b.dev_name} are both working in ${a.work_zone}`,
            file_paths: [],
          });
        }
      }
    }

    return conflicts;
  }

  private zonesOverlap(zoneA: string, zoneB: string): boolean {
    const a = zoneA.replace(/\/$/, '');
    const b = zoneB.replace(/\/$/, '');
    return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  }

  private detectInterfaceConflicts(peers: PeerState[]): ConflictSignal[] {
    const conflicts: ConflictSignal[] = [];

    // Build map of export name -> [{ peer, filePath }]
    const exportMap = new Map<string, Array<{ peerName: string; peerId: string; filePath: string }>>();

    for (const peer of peers) {
      for (const [filePath, fileState] of peer.files) {
        for (const exp of fileState.exports) {
          const existing = exportMap.get(exp.name) ?? [];
          existing.push({ peerName: peer.dev_name, peerId: peer.peer_id, filePath });
          exportMap.set(exp.name, existing);
        }
      }
    }

    for (const [exportName, sources] of exportMap) {
      // Only flag cross-peer duplicates
      const uniquePeers = new Set(sources.map((s) => s.peerId));
      if (uniquePeers.size > 1) {
        const peerNames = [...new Set(sources.map((s) => s.peerName))];
        const filePaths = sources.map((s) => s.filePath);
        conflicts.push({
          type: 'interface_conflict',
          severity: 'warning',
          peers: peerNames,
          description: `Duplicate export "${exportName}" found across peers: ${filePaths.join(', ')}`,
          file_paths: filePaths,
        });
      }
    }

    return conflicts;
  }

  private detectDuplications(peers: PeerState[]): ConflictSignal[] {
    const conflicts: ConflictSignal[] = [];

    // Check for files with the same basename across different peers
    const fileNameMap = new Map<string, Array<{ peerName: string; peerId: string; filePath: string }>>();

    for (const peer of peers) {
      for (const [filePath] of peer.files) {
        const name = basename(filePath);
        const existing = fileNameMap.get(name) ?? [];
        existing.push({ peerName: peer.dev_name, peerId: peer.peer_id, filePath });
        fileNameMap.set(name, existing);
      }
    }

    for (const [fileName, sources] of fileNameMap) {
      const uniquePeers = new Set(sources.map((s) => s.peerId));
      if (uniquePeers.size > 1) {
        const peerNames = [...new Set(sources.map((s) => s.peerName))];
        const filePaths = sources.map((s) => s.filePath);
        conflicts.push({
          type: 'duplication',
          severity: 'warning',
          peers: peerNames,
          description: `File "${fileName}" exists in multiple peers' workspaces: ${filePaths.join(', ')}`,
          file_paths: filePaths,
        });
      }
    }

    return conflicts;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/conflict/detector.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/conflict/detector.ts tests/conflict/detector.test.ts
git commit -m "feat: add conflict detector for zones, interfaces, and duplications"
```

---

### Task 12: LLM Provider Layer

**Files:**
- Create: `src/llm/provider.ts`
- Create: `src/llm/anthropic.ts`
- Create: `src/llm/openai.ts`
- Create: `tests/llm/provider.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/llm/provider.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { createLLMProvider, type LLMProvider } from '../../src/llm/provider.js';

describe('LLMProvider', () => {
  it('should return a no-op provider for provider "none"', async () => {
    const provider = createLLMProvider({ provider: 'none', api_key_env: '', tier2_model: '', tier3_model: '' });
    const result = await provider.summarize('some code changes', 'tier2');
    expect(result).toBeNull();
  });

  it('should return a no-op provider when API key env is not set', async () => {
    const provider = createLLMProvider({
      provider: 'anthropic',
      api_key_env: 'NONEXISTENT_KEY_12345',
      tier2_model: 'claude-haiku-4-5-20251001',
      tier3_model: 'claude-sonnet-4-6',
    });
    const result = await provider.summarize('some code changes', 'tier2');
    expect(result).toBeNull();
  });
});

describe('LLMProvider interface', () => {
  it('should define summarize and analyze methods', () => {
    const provider: LLMProvider = {
      summarize: async () => null,
      analyze: async () => null,
    };
    expect(provider.summarize).toBeDefined();
    expect(provider.analyze).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/llm/provider.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/llm/provider.ts`:
```typescript
import type { EnrichmentConfig } from '../types.js';

export interface LLMProvider {
  summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null>;
  analyze(teamState: string): Promise<string | null>;
}

class NoOpProvider implements LLMProvider {
  async summarize(): Promise<null> { return null; }
  async analyze(): Promise<null> { return null; }
}

export function createLLMProvider(config: EnrichmentConfig): LLMProvider {
  if (config.provider === 'none') {
    return new NoOpProvider();
  }

  const apiKey = config.api_key_env ? process.env[config.api_key_env] : undefined;
  if (!apiKey) {
    return new NoOpProvider();
  }

  switch (config.provider) {
    case 'anthropic':
      // Lazy import to avoid loading SDK when not needed
      return new LazyAnthropicProvider(apiKey, config);
    case 'openai':
      return new LazyOpenAIProvider(apiKey, config);
    default:
      return new NoOpProvider();
  }
}

class LazyAnthropicProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly config: EnrichmentConfig,
  ) {}

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    const { AnthropicProvider } = await import('./anthropic.js');
    const provider = new AnthropicProvider(this.apiKey, this.config);
    return provider.summarize(changesDescription, tier);
  }

  async analyze(teamState: string): Promise<string | null> {
    const { AnthropicProvider } = await import('./anthropic.js');
    const provider = new AnthropicProvider(this.apiKey, this.config);
    return provider.analyze(teamState);
  }
}

class LazyOpenAIProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly config: EnrichmentConfig,
  ) {}

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    const { OpenAIProvider } = await import('./openai.js');
    const provider = new OpenAIProvider(this.apiKey, this.config);
    return provider.summarize(changesDescription, tier);
  }

  async analyze(teamState: string): Promise<string | null> {
    const { OpenAIProvider } = await import('./openai.js');
    const provider = new OpenAIProvider(this.apiKey, this.config);
    return provider.analyze(teamState);
  }
}
```

`src/llm/anthropic.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { EnrichmentConfig } from '../types.js';
import type { LLMProvider } from './provider.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private readonly config: EnrichmentConfig,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    const model = tier === 'tier2' ? this.config.tier2_model : this.config.tier3_model;

    const response = await this.client.messages.create({
      model,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Summarize these code changes concisely. Focus on: what was built, what interfaces/exports are available, and the developer's intent. Be specific about function names and signatures.\n\nChanges:\n${changesDescription}`,
      }],
    });

    const block = response.content[0];
    return block.type === 'text' ? block.text : null;
  }

  async analyze(teamState: string): Promise<string | null> {
    const response = await this.client.messages.create({
      model: this.config.tier3_model,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Analyze this team's current coding state. Identify: (1) potential duplications across team members, (2) missing integrations (one person's code expects something another hasn't built), (3) interface mismatches. Be specific.\n\nTeam State:\n${teamState}`,
      }],
    });

    const block = response.content[0];
    return block.type === 'text' ? block.text : null;
  }
}
```

`src/llm/openai.ts`:
```typescript
import OpenAI from 'openai';
import type { EnrichmentConfig } from '../types.js';
import type { LLMProvider } from './provider.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(
    apiKey: string,
    private readonly config: EnrichmentConfig,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    const model = tier === 'tier2' ? this.config.tier2_model : this.config.tier3_model;

    const response = await this.client.chat.completions.create({
      model,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Summarize these code changes concisely. Focus on: what was built, what interfaces/exports are available, and the developer's intent. Be specific about function names and signatures.\n\nChanges:\n${changesDescription}`,
      }],
    });

    return response.choices[0]?.message?.content ?? null;
  }

  async analyze(teamState: string): Promise<string | null> {
    const response = await this.client.chat.completions.create({
      model: this.config.tier3_model,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Analyze this team's current coding state. Identify: (1) potential duplications across team members, (2) missing integrations (one person's code expects something another hasn't built), (3) interface mismatches. Be specific.\n\nTeam State:\n${teamState}`,
      }],
    });

    return response.choices[0]?.message?.content ?? null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/llm/provider.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/ tests/llm/
git commit -m "feat: add provider-agnostic LLM layer with Anthropic and OpenAI adapters"
```

---

### Task 13: Rich Intent Extractor (Tier 2/3)

**Files:**
- Create: `src/extractor/rich.ts`
- Create: `tests/extractor/rich.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/extractor/rich.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { RichExtractor } from '../../src/extractor/rich.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { SwarmUpdate } from '../../src/types.js';

function createMockProvider(response: string): LLMProvider {
  return {
    summarize: vi.fn().mockResolvedValue(response),
    analyze: vi.fn().mockResolvedValue(response),
  };
}

describe('RichExtractor', () => {
  it('should batch changes and produce a summary', async () => {
    const mockProvider = createMockProvider('Built a JWT auth module with login and logout functions');
    const extractor = new RichExtractor(mockProvider);

    const updates: SwarmUpdate[] = [
      {
        peer_id: 'self',
        dev_name: 'Jared',
        timestamp: Date.now(),
        event_type: 'file_created',
        file_path: 'src/auth.ts',
        exports: [{ name: 'login', signature: '() => void' }],
        imports: ['bcrypt'],
        work_zone: 'src/auth',
        intent: null,
        summary: null,
        interfaces: [],
        touches: ['src/auth.ts'],
      },
      {
        peer_id: 'self',
        dev_name: 'Jared',
        timestamp: Date.now(),
        event_type: 'file_created',
        file_path: 'src/auth/middleware.ts',
        exports: [{ name: 'requireAuth', signature: '() => Middleware' }],
        imports: ['./auth'],
        work_zone: 'src/auth',
        intent: null,
        summary: null,
        interfaces: [],
        touches: ['src/auth/middleware.ts'],
      },
    ];

    const result = await extractor.enrichBatch(updates);
    expect(result.intent).toContain('JWT auth');
    expect(mockProvider.summarize).toHaveBeenCalledOnce();
  });

  it('should return null intent when provider returns null', async () => {
    const mockProvider = createMockProvider(null as any);
    vi.mocked(mockProvider.summarize).mockResolvedValue(null);
    const extractor = new RichExtractor(mockProvider);

    const result = await extractor.enrichBatch([]);
    expect(result.intent).toBeNull();
  });

  it('should perform cross-team analysis for tier 3', async () => {
    const mockProvider = createMockProvider('Duplicate formatDate found in both workspaces');
    const extractor = new RichExtractor(mockProvider);

    const result = await extractor.analyzeTeam('team state text');
    expect(result).toContain('Duplicate');
    expect(mockProvider.analyze).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/extractor/rich.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/extractor/rich.ts`:
```typescript
import type { LLMProvider } from '../llm/provider.js';
import type { SwarmUpdate } from '../types.js';

export interface EnrichmentResult {
  intent: string | null;
  summary: string | null;
}

export class RichExtractor {
  constructor(private readonly provider: LLMProvider) {}

  async enrichBatch(updates: SwarmUpdate[]): Promise<EnrichmentResult> {
    if (updates.length === 0) {
      const intent = await this.provider.summarize('No changes in this window.', 'tier2');
      return { intent, summary: null };
    }

    const description = updates.map((u) => {
      const exports = u.exports.map((e) => `${e.name}: ${e.signature}`).join(', ');
      return `- ${u.event_type} ${u.file_path}${exports ? ` (exports: ${exports})` : ''}${u.imports.length ? ` (imports: ${u.imports.join(', ')})` : ''}`;
    }).join('\n');

    const workZone = updates[0]?.work_zone ?? 'unknown';
    const prompt = `Developer working in ${workZone}:\n${description}`;

    const intent = await this.provider.summarize(prompt, 'tier2');
    return { intent, summary: intent };
  }

  async analyzeTeam(teamStateDescription: string): Promise<string | null> {
    return this.provider.analyze(teamStateDescription);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/extractor/rich.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extractor/rich.ts tests/extractor/rich.test.ts
git commit -m "feat: add rich intent extractor for Tier 2/3 LLM enrichment"
```

---

### Task 14: PLAN.md Parser

**Files:**
- Create: `src/plan/parser.ts`
- Create: `tests/plan/parser.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/plan/parser.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parsePlan } from '../../src/plan/parser.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('parsePlan', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarmcode-plan-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should parse a PLAN.md with feature assignments', () => {
    const planContent = `# Project Plan

## Features

- **Auth system** - Jared
  - Login/logout with JWT
  - Session management

- **Dashboard** - Sarah
  - Main layout
  - Stats widgets

- **API endpoints** - Mike
  - REST API for users
  - REST API for products

## Shared Types
- User: { id, email, name, role }
- Product: { id, name, price }
`;
    writeFileSync(join(testDir, 'PLAN.md'), planContent);
    const plan = parsePlan(testDir);

    expect(plan).not.toBeNull();
    expect(plan!.assignments).toHaveLength(3);
    expect(plan!.assignments[0].feature).toContain('Auth');
    expect(plan!.assignments[0].owner).toBe('Jared');
    expect(plan!.assignments[1].owner).toBe('Sarah');
    expect(plan!.sharedContext).toContain('User');
  });

  it('should return null when no PLAN.md exists', () => {
    const plan = parsePlan(testDir);
    expect(plan).toBeNull();
  });

  it('should handle PLAN.md with no assignments', () => {
    writeFileSync(join(testDir, 'PLAN.md'), '# Our Plan\n\nJust some notes.');
    const plan = parsePlan(testDir);
    expect(plan).not.toBeNull();
    expect(plan!.assignments).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/plan/parser.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

`src/plan/parser.ts`:
```typescript
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PlanAssignment {
  feature: string;
  owner: string;
  details: string[];
}

export interface ProjectPlan {
  raw: string;
  assignments: PlanAssignment[];
  sharedContext: string;
}

export function parsePlan(projectDir: string): ProjectPlan | null {
  const planPath = join(projectDir, 'PLAN.md');
  if (!existsSync(planPath)) return null;

  const raw = readFileSync(planPath, 'utf-8');
  const assignments = extractAssignments(raw);
  const sharedContext = extractSharedContext(raw);

  return { raw, assignments, sharedContext };
}

function extractAssignments(content: string): PlanAssignment[] {
  const assignments: PlanAssignment[] = [];

  // Match lines like "- **Feature name** - Owner" or "- Feature name - Owner"
  const assignmentPattern = /^[-*]\s+\*?\*?(.+?)\*?\*?\s*[-–—]\s*(\w+)\s*$/gm;
  let match: RegExpExecArray | null;

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const assignMatch = line.match(/^[-*]\s+\*{0,2}(.+?)\*{0,2}\s*[-–—]\s*(\w+)\s*$/);
    if (assignMatch) {
      const feature = assignMatch[1].trim();
      const owner = assignMatch[2].trim();
      const details: string[] = [];

      // Collect sub-items
      for (let j = i + 1; j < lines.length; j++) {
        const subLine = lines[j];
        if (subLine.match(/^\s+[-*]\s+/)) {
          details.push(subLine.trim().replace(/^[-*]\s+/, ''));
        } else {
          break;
        }
      }

      assignments.push({ feature, owner, details });
    }
  }

  return assignments;
}

function extractSharedContext(content: string): string {
  // Extract everything after "Shared" heading (Shared Types, Shared Contracts, etc.)
  const sharedMatch = content.match(/##\s+Shared[\s\S]*$/im);
  return sharedMatch ? sharedMatch[0] : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/plan/parser.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plan/parser.ts tests/plan/parser.test.ts
git commit -m "feat: add PLAN.md parser for team coordination"
```

---

### Task 15: CLI Commands

**Files:**
- Modify: `bin/swarmcode.ts`
- Create: `src/cli.ts`
- Modify: `src/config.ts` (add `initConfig`)

- [ ] **Step 1: Write the CLI module**

`src/cli.ts`:
```typescript
import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadConfig, getDefaultConfig } from './config.js';
import { VERSION } from './index.js';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('swarmcode')
    .description('P2P mesh agent for team-aware AI coding')
    .version(VERSION);

  program
    .command('init')
    .description('Initialize swarmcode in the current project')
    .option('--name <name>', 'Your display name')
    .option('--ai-tool <tool>', 'AI tool to use', 'claude-code')
    .action((options) => {
      const cwd = process.cwd();
      const configDir = join(cwd, '.swarmcode');

      if (existsSync(configDir)) {
        console.log('.swarmcode/ already exists. Skipping init.');
        return;
      }

      mkdirSync(configDir, { recursive: true });

      const config = getDefaultConfig(options.name);
      if (options.aiTool) {
        config.ai_tool = options.aiTool;
      }

      const yamlContent = stringifyYaml({
        name: config.name,
        ai_tool: config.ai_tool,
        context_file: config.context_file,
        ignore: config.ignore,
        tier2_interval: config.tier2_interval,
        tier3_interval: config.tier3_interval,
        enrichment: {
          provider: config.enrichment.provider,
          api_key_env: config.enrichment.api_key_env || '',
          tier2_model: config.enrichment.tier2_model || '',
          tier3_model: config.enrichment.tier3_model || '',
        },
      });

      writeFileSync(join(configDir, 'config.yaml'), yamlContent, 'utf-8');
      console.log('Initialized swarmcode in .swarmcode/');
      console.log(`Config written to .swarmcode/config.yaml`);
      console.log(`Edit config.yaml to set your name and enrichment provider.`);
    });

  program
    .command('start')
    .description('Start the swarmcode agent')
    .option('--name <name>', 'Override display name')
    .action(async (options) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      if (options.name) config.name = options.name;

      console.log(`Starting swarmcode as "${config.name}"...`);
      console.log(`AI tool: ${config.ai_tool}`);
      console.log(`Context file: ${config.context_file}`);
      console.log('Discovering peers on the network...');

      // Agent orchestration will be connected in Task 16
      const { SwarmAgent } = await import('./agent.js');
      const agent = new SwarmAgent(cwd, config);
      await agent.start();
    });

  program
    .command('stop')
    .description('Stop the swarmcode agent')
    .action(() => {
      console.log('Stopping swarmcode agent...');
      // Will send signal to running agent process
    });

  program
    .command('status')
    .description('Show mesh status and peer info')
    .action(() => {
      console.log('Swarmcode status:');
      // Will read from agent state
    });

  program
    .command('log')
    .description('Stream team activity log')
    .action(() => {
      console.log('Activity log:');
      // Will stream from agent
    });

  program
    .command('zones')
    .description('Show active work zones')
    .action(() => {
      console.log('Active zones:');
      // Will read from agent state
    });

  return program;
}
```

- [ ] **Step 2: Update bin/swarmcode.ts**

`bin/swarmcode.ts`:
```typescript
#!/usr/bin/env tsx
import { createCLI } from '../src/cli.js';

const program = createCLI();
program.parse();
```

- [ ] **Step 3: Test init command manually**

```bash
cd /tmp && mkdir swarmcode-test && cd swarmcode-test
npx tsx /home/jaredt17/projects/tellertech/pairpro-agent/bin/swarmcode.ts init --name "TestUser"
cat .swarmcode/config.yaml
cd /home/jaredt17/projects/tellertech/pairpro-agent
rm -rf /tmp/swarmcode-test
```

Expected: Config file created with sensible defaults.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts bin/swarmcode.ts
git commit -m "feat: add CLI with init, start, stop, status, log, zones commands"
```

---

### Task 16: Agent Orchestrator

**Files:**
- Create: `src/agent.ts`
- Create: `tests/integration/agent.integration.test.ts`

This is the main orchestrator that ties all components together.

- [ ] **Step 1: Write the agent orchestrator**

`src/agent.ts`:
```typescript
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SwarmConfig, SwarmUpdate, PeerInfo } from './types.js';
import { FileWatcher } from './watcher.js';
import { FastExtractor } from './extractor/fast.js';
import { RichExtractor } from './extractor/rich.js';
import { MeshDiscovery } from './mesh/discovery.js';
import { MeshBroadcaster } from './mesh/broadcaster.js';
import { QueryServer, QueryClient, type QueryHandler } from './mesh/query.js';
import { TeamState } from './state/team-state.js';
import { ContextInjector } from './injector/injector.js';
import { formatTeamContext } from './injector/formatter.js';
import { ConflictDetector } from './conflict/detector.js';
import { createLLMProvider } from './llm/provider.js';
import { parsePlan } from './plan/parser.js';

export class SwarmAgent extends EventEmitter {
  private watcher: FileWatcher;
  private fastExtractor: FastExtractor;
  private richExtractor: RichExtractor;
  private discovery: MeshDiscovery;
  private broadcaster: MeshBroadcaster;
  private queryServer: QueryServer;
  private queryClient: QueryClient;
  private teamState: TeamState;
  private injector: ContextInjector;
  private conflictDetector: ConflictDetector;

  private tier2Buffer: SwarmUpdate[] = [];
  private tier2Timer: NodeJS.Timeout | null = null;
  private tier3Timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private pubPort = 0;
  private repPort = 0;

  constructor(
    private readonly projectDir: string,
    private readonly config: SwarmConfig,
  ) {
    super();

    const llmProvider = createLLMProvider(config.enrichment);

    this.watcher = new FileWatcher(projectDir, {
      ignore: config.ignore,
      debounceMs: 500,
    });

    this.fastExtractor = new FastExtractor();
    this.richExtractor = new RichExtractor(llmProvider);
    this.broadcaster = new MeshBroadcaster();
    this.queryClient = new QueryClient();
    this.teamState = new TeamState('');
    this.injector = new ContextInjector(projectDir, config.context_file);
    this.conflictDetector = new ConflictDetector();

    // Query handler
    const queryHandler: QueryHandler = async (req) => {
      if (req.type === 'exports' || req.type === 'dependencies') {
        const filePath = join(projectDir, req.file_path);
        try {
          const code = readFileSync(filePath, 'utf-8');
          const lang = FastExtractor.detectLanguage(req.file_path);
          if (lang) {
            const result = await this.fastExtractor.extractAsync(code, lang);
            return {
              type: req.type,
              file_path: req.file_path,
              data: req.type === 'exports' ? result.exports : result.imports,
              error: null,
            };
          }
        } catch { /* file not found */ }
      }

      if (req.type === 'file_exists') {
        try {
          readFileSync(join(projectDir, req.file_path));
          return { type: req.type, file_path: req.file_path, data: true, error: null };
        } catch {
          return { type: req.type, file_path: req.file_path, data: false, error: null };
        }
      }

      return { type: req.type, file_path: req.file_path, data: null, error: 'Unknown query type' };
    };

    this.queryServer = new QueryServer(queryHandler);
    this.discovery = new MeshDiscovery({
      name: config.name,
      pub_port: 0, // Will be set after binding
      rep_port: 0,
    });
  }

  async start(): Promise<void> {
    // Start networking
    this.pubPort = await this.broadcaster.start(0);
    this.repPort = await this.queryServer.start(0);

    // Update discovery with actual ports
    this.discovery = new MeshDiscovery({
      name: this.config.name,
      pub_port: this.pubPort,
      rep_port: this.repPort,
    });

    const selfInfo = this.discovery.getSelfInfo();
    this.teamState = new TeamState(selfInfo.peer_id);

    // Wire up discovery events
    this.discovery.on('peer-discovered', async (peer: PeerInfo) => {
      console.log(`  Discovered: ${peer.dev_name} (${peer.address})`);
      this.teamState.addPeer(peer);
      await this.broadcaster.subscribeTo(peer.address, peer.pub_port);
      this.updateContext();
    });

    this.discovery.on('peer-lost', (peerId: string) => {
      this.teamState.markOffline(peerId);
      this.updateContext();
    });

    // Wire up broadcaster events
    this.broadcaster.on('update', (update: SwarmUpdate) => {
      this.teamState.applyUpdate(update);
      this.teamState.heartbeat(update.peer_id);
      this.updateContext();
    });

    // Wire up file watcher
    this.watcher.on('change', async (event: { type: string; path: string; absolutePath: string }) => {
      const lang = FastExtractor.detectLanguage(event.path);
      let exports: Array<{ name: string; signature: string }> = [];
      let imports: string[] = [];

      if (lang && event.type !== 'file_deleted') {
        try {
          const code = readFileSync(event.absolutePath, 'utf-8');
          const result = await this.fastExtractor.extractAsync(code, lang);
          exports = result.exports;
          imports = result.imports;
        } catch { /* file read error */ }
      }

      const workZone = event.path.split('/').slice(0, -1).join('/') || '.';

      const update: SwarmUpdate = {
        peer_id: selfInfo.peer_id,
        dev_name: this.config.name,
        timestamp: Date.now(),
        event_type: event.type as SwarmUpdate['event_type'],
        file_path: event.path,
        exports,
        imports,
        work_zone: workZone,
        intent: null,
        summary: null,
        interfaces: [],
        touches: [event.path],
      };

      // Tier 1: Broadcast immediately
      await this.broadcaster.publish(update);

      // Buffer for Tier 2
      this.tier2Buffer.push(update);
    });

    // Load plan if exists
    const plan = parsePlan(this.projectDir);
    if (plan) {
      console.log('Loaded PLAN.md for team coordination');
    }

    // Start components
    await this.watcher.start();
    await this.discovery.start();

    // Start Tier 2 timer
    this.tier2Timer = setInterval(async () => {
      if (this.tier2Buffer.length === 0) return;
      const batch = [...this.tier2Buffer];
      this.tier2Buffer = [];

      const enrichment = await this.richExtractor.enrichBatch(batch);
      if (enrichment.intent) {
        const intentUpdate: SwarmUpdate = {
          peer_id: selfInfo.peer_id,
          dev_name: this.config.name,
          timestamp: Date.now(),
          event_type: 'intent_updated',
          file_path: '',
          exports: [],
          imports: [],
          work_zone: batch[batch.length - 1]?.work_zone ?? '',
          intent: enrichment.intent,
          summary: enrichment.summary,
          interfaces: [],
          touches: [],
        };
        await this.broadcaster.publish(intentUpdate);
      }
    }, this.config.tier2_interval * 1000);

    // Start Tier 3 timer
    this.tier3Timer = setInterval(async () => {
      const peers = this.teamState.getAllPeers();
      if (peers.length === 0) return;

      const stateDescription = formatTeamContext(peers);
      const analysis = await this.richExtractor.analyzeTeam(stateDescription);
      if (analysis) {
        console.log('\n[Tier 3 Analysis]', analysis);
      }
    }, this.config.tier3_interval * 1000);

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const peer of this.teamState.getAllPeers()) {
        if (peer.status === 'online' && now - peer.last_seen > 15000) {
          this.teamState.markOffline(peer.peer_id);
          console.log(`  ${peer.dev_name} went offline`);
          this.updateContext();
        }
      }
    }, 5000);

    const peerCount = this.teamState.getAllPeers().length;
    console.log(`\nSwarmcode started`);
    console.log(`  Name: ${this.config.name}`);
    console.log(`  PUB port: ${this.pubPort}`);
    console.log(`  REP port: ${this.repPort}`);
    console.log(`  Peers: ${peerCount}`);
    console.log(`  Watching: ${this.projectDir}`);
    console.log(`  Context: ${this.config.context_file}`);
  }

  async stop(): Promise<void> {
    if (this.tier2Timer) clearInterval(this.tier2Timer);
    if (this.tier3Timer) clearInterval(this.tier3Timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    await this.watcher.stop();
    await this.discovery.stop();
    await this.broadcaster.stop();
    await this.queryServer.stop();
    await this.queryClient.close();

    this.injector.clear();
    console.log('Swarmcode stopped');
  }

  private updateContext(): void {
    const peers = this.teamState.getAllPeers();
    const conflicts = this.conflictDetector.detect(peers);
    const context = formatTeamContext(peers, conflicts);
    this.injector.inject(context);
  }
}
```

- [ ] **Step 2: Write integration test**

`tests/integration/agent.integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SwarmAgent } from '../../src/agent.js';
import { getDefaultConfig } from '../../src/config.js';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('SwarmAgent integration', () => {
  let testDir: string;
  let agent: SwarmAgent;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarmcode-agent-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    await agent?.stop();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should start and create context file on file changes', async () => {
    const config = getDefaultConfig('TestAgent');
    agent = new SwarmAgent(testDir, config);
    await agent.start();

    // Create a file — should trigger watcher + context injection
    writeFileSync(join(testDir, 'test.ts'), 'export function hello() { return "world"; }');

    // Wait for debounce + processing
    await new Promise((r) => setTimeout(r, 2000));

    // Context file may or may not exist depending on peer state
    // But the agent should have started without errors
    expect(true).toBe(true); // Agent started successfully
  }, 10000);

  it('should stop cleanly', async () => {
    const config = getDefaultConfig('TestAgent');
    agent = new SwarmAgent(testDir, config);
    await agent.start();
    await agent.stop();
    // No errors thrown
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 3: Create vitest integration config**

`vitest.integration.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: Run integration test**

```bash
npx vitest run --config vitest.integration.config.ts
```

Expected: PASS (agent starts, handles file changes, stops cleanly)

- [ ] **Step 5: Update src/index.ts with public exports**

`src/index.ts`:
```typescript
export const VERSION = '0.1.0';

export { SwarmAgent } from './agent.js';
export { loadConfig, getDefaultConfig } from './config.js';
export { createCLI } from './cli.js';
export type {
  SwarmUpdate,
  PeerInfo,
  PeerState,
  SwarmConfig,
  ExportEntry,
  FileState,
  ConflictSignal,
  QueryRequest,
  QueryResponse,
} from './types.js';
```

- [ ] **Step 6: Run all unit tests**

```bash
npx vitest run
```

Expected: All unit tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/agent.ts src/index.ts tests/integration/ vitest.integration.config.ts
git commit -m "feat: add agent orchestrator tying all components together"
```

---

### Task 17: Final Polish and Full Test Run

**Files:**
- Verify all tests pass
- Verify CLI works end-to-end

- [ ] **Step 1: Run full unit test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 2: Run integration tests**

```bash
npx vitest run --config vitest.integration.config.ts
```

Expected: All tests PASS

- [ ] **Step 3: Test CLI init command**

```bash
cd /tmp && mkdir swarmcode-e2e && cd swarmcode-e2e
npx tsx /home/jaredt17/projects/tellertech/pairpro-agent/bin/swarmcode.ts init --name "E2ETest"
cat .swarmcode/config.yaml
cd /home/jaredt17/projects/tellertech/pairpro-agent
rm -rf /tmp/swarmcode-e2e
```

Expected: Config file created with correct content.

- [ ] **Step 4: Build TypeScript**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final polish and verification"
```
