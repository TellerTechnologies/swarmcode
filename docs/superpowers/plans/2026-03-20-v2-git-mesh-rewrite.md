# Swarmcode v2: Git-as-Mesh Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ZMQ/mDNS mesh with git as the sole transport. Each peer writes a JSON manifest; git sync shares manifests between machines; the context injector reads all peer manifests to build CLAUDE.md.

**Architecture:** File watcher detects local changes → FastExtractor extracts exports/imports → ManifestWriter writes `.swarmcode/peers/<name>.json` → GitSync commits+pulls+pushes every 30s → ManifestReader reads all peer JSONs → ContextInjector writes CLAUDE.md. No network sockets, no discovery protocol, no ports.

**Tech Stack:** TypeScript, chokidar (file watcher), commander (CLI), yaml (config), vitest (tests). Dropping: zeromq, bonjour-service.

---

## File Structure

### Keep unchanged
- `src/extractor/fast.ts` — regex-based export/import extraction
- `src/extractor/rich.ts` — LLM enrichment (tier 2/3)
- `src/injector/injector.ts` — writes context blocks to CLAUDE.md
- `src/injector/formatter.ts` — formats PeerState[] into markdown
- `src/conflict/detector.ts` — detects zone overlaps, duplication
- `src/plan/parser.ts` — parses PLAN.md assignments
- `src/llm/provider.ts`, `src/llm/anthropic.ts`, `src/llm/openai.ts` — LLM providers
- `src/watcher.ts` — chokidar file watcher

### Keep with modifications
- `src/types.ts` — simplify: remove ZMQ types (PeerInfo ports, QueryRequest/Response, SwarmUpdate), add ManifestData
- `src/config.ts` — remove `peers` and `git_sync` (always on), simplify defaults
- `src/cli.ts` — remove `--peer`, `--git-sync` flags, simplify init/start
- `src/index.ts` — update exports
- `src/sync/git-sync.ts` — already exists, minor cleanup

### Create new
- `src/manifest/writer.ts` — writes local peer manifest JSON
- `src/manifest/reader.ts` — reads all peer manifest JSONs
- `src/agent.ts` — complete rewrite, ~100 lines instead of ~400

### Delete
- `src/mesh/announce.ts` — ZMQ announce server
- `src/mesh/broadcaster.ts` — ZMQ PUB/SUB
- `src/mesh/discovery.ts` — mDNS/Bonjour
- `src/mesh/query.ts` — ZMQ REQ/REP
- `src/state/team-state.ts` — replaced by manifest reader
- `tests/mesh/broadcaster.test.ts`
- `tests/mesh/discovery.test.ts`
- `tests/mesh/query.test.ts`
- `tests/state/team-state.test.ts`
- `tests/integration/agent.integration.test.ts` — rewrite needed

### Dependencies to remove from package.json
- `zeromq`
- `bonjour-service`

---

### Task 1: Simplify types.ts

**Files:**
- Modify: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the new types file**

Replace the full contents of `src/types.ts` with:

```typescript
export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'none';
export type AITool = 'claude-code' | 'cursor' | 'copilot' | 'custom';

export interface ExportEntry {
  name: string;
  signature: string;
}

export interface FileState {
  exports: ExportEntry[];
  imports: string[];
  last_modified: number;
}

export interface ManifestData {
  name: string;
  updated_at: number;
  work_zone: string;
  intent: string | null;
  files: Record<string, FileState>;
}

export interface PeerState {
  peer_id: string;
  dev_name: string;
  status: 'online' | 'offline';
  last_seen: number;
  // These fields exist for formatter/conflict detector compatibility
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
  sync_interval: number;
  tier2_interval: number;
  tier3_interval: number;
  enrichment: EnrichmentConfig;
}

export interface ConflictSignal {
  type: 'zone_overlap' | 'interface_conflict' | 'duplication';
  severity: 'warning' | 'critical';
  peers: string[];
  description: string;
  file_paths: string[];
}
```

- [ ] **Step 2: Update tests/types.test.ts**

Update the type test to verify ManifestData exists and the removed types (SwarmUpdate, PeerInfo, QueryRequest, etc.) are gone.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/types.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "refactor: simplify types for git-mesh architecture"
```

---

### Task 2: Simplify config.ts

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Update config**

Remove `peers`, `git_sync` fields. Add `sync_interval` (default 30). Remove `.swarmcode` from default ignore list (manifests live there and need to be git-tracked).

```typescript
export function getDefaultConfig(name?: string): SwarmConfig {
  return {
    name: name ?? 'swarmcode-project',
    ai_tool: 'claude-code',
    context_file: 'CLAUDE.md',
    ignore: ['node_modules', '.git', 'dist'],
    sync_interval: 30,
    tier2_interval: 30,
    tier3_interval: 300,
    enrichment: {
      provider: 'none',
      api_key_env: '',
      tier2_model: '',
      tier3_model: '',
    },
  };
}
```

Update `loadConfig` to parse `sync_interval` and remove `peers`/`git_sync` parsing.

- [ ] **Step 2: Update tests**

Fix any tests that reference removed config fields.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/config.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "refactor: simplify config for git-mesh"
```

---

### Task 3: Create manifest writer

**Files:**
- Create: `src/manifest/writer.ts`
- Create: `tests/manifest/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ManifestWriter } from '../../src/manifest/writer.js';

describe('ManifestWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-manifest-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the peers directory and writes manifest JSON', async () => {
    const writer = new ManifestWriter(tmpDir, 'Jared');
    await writer.write({
      name: 'Jared',
      updated_at: 1000,
      work_zone: 'src/app',
      intent: null,
      files: {
        'src/app/page.tsx': {
          exports: [{ name: 'Home', signature: 'export default function Home' }],
          imports: ['react'],
          last_modified: 1000,
        },
      },
    });

    const filePath = join(tmpDir, '.swarmcode', 'peers', 'Jared.json');
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.name).toBe('Jared');
    expect(data.files['src/app/page.tsx'].exports[0].name).toBe('Home');
  });

  it('overwrites existing manifest', async () => {
    const writer = new ManifestWriter(tmpDir, 'Jared');
    await writer.write({ name: 'Jared', updated_at: 1000, work_zone: '', intent: null, files: {} });
    await writer.write({ name: 'Jared', updated_at: 2000, work_zone: 'src', intent: null, files: {} });

    const filePath = join(tmpDir, '.swarmcode', 'peers', 'Jared.json');
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.updated_at).toBe(2000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/manifest/writer.test.ts -v`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement ManifestWriter**

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManifestData } from '../types.js';

export class ManifestWriter {
  private readonly manifestPath: string;
  private readonly peersDir: string;

  constructor(projectDir: string, name: string) {
    this.peersDir = join(projectDir, '.swarmcode', 'peers');
    this.manifestPath = join(this.peersDir, `${name}.json`);
  }

  async write(data: ManifestData): Promise<void> {
    await mkdir(this.peersDir, { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/manifest/writer.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/manifest/writer.ts tests/manifest/writer.test.ts
git commit -m "feat: add manifest writer for git-mesh"
```

---

### Task 4: Create manifest reader

**Files:**
- Create: `src/manifest/reader.ts`
- Create: `tests/manifest/reader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ManifestReader } from '../../src/manifest/reader.js';

describe('ManifestReader', () => {
  let tmpDir: string;
  let peersDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-manifest-'));
    peersDir = join(tmpDir, '.swarmcode', 'peers');
    mkdirSync(peersDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads all peer manifests except self', () => {
    writeFileSync(join(peersDir, 'Jared.json'), JSON.stringify({ name: 'Jared', updated_at: 1000, work_zone: '', intent: null, files: {} }));
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: 2000, work_zone: 'src/lib', intent: null, files: { 'src/lib/db.ts': { exports: [], imports: [], last_modified: 2000 } } }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].dev_name).toBe('laptop');
    expect(peers[0].files.size).toBe(1);
  });

  it('returns empty array when no peers directory', () => {
    const reader = new ManifestReader(join(tmpDir, 'nonexistent'), 'Jared');
    const peers = reader.readPeers();
    expect(peers).toEqual([]);
  });

  it('marks peers as offline if manifest is older than threshold', () => {
    const oldTimestamp = Date.now() - 120_000; // 2 min ago
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: oldTimestamp, work_zone: '', intent: null, files: {} }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers[0].status).toBe('offline');
  });

  it('marks peers as online if manifest is recent', () => {
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: Date.now(), work_zone: '', intent: null, files: {} }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers[0].status).toBe('online');
  });

  it('skips malformed JSON files', () => {
    writeFileSync(join(peersDir, 'bad.json'), 'not json');
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: Date.now(), work_zone: '', intent: null, files: {} }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/manifest/reader.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Implement ManifestReader**

```typescript
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ManifestData, PeerState, FileState } from '../types.js';

const OFFLINE_THRESHOLD_MS = 90_000; // 90s without update = offline

export class ManifestReader {
  private readonly peersDir: string;
  private readonly selfName: string;

  constructor(projectDir: string, selfName: string) {
    this.peersDir = join(projectDir, '.swarmcode', 'peers');
    this.selfName = selfName;
  }

  readPeers(): PeerState[] {
    if (!existsSync(this.peersDir)) return [];

    const files = readdirSync(this.peersDir).filter(f => f.endsWith('.json'));
    const peers: PeerState[] = [];

    for (const file of files) {
      const name = basename(file, '.json');
      if (name === this.selfName) continue;

      try {
        const raw = readFileSync(join(this.peersDir, file), 'utf-8');
        const data: ManifestData = JSON.parse(raw);

        const fileMap = new Map<string, FileState>();
        for (const [path, state] of Object.entries(data.files)) {
          fileMap.set(path, state);
        }

        const isOnline = Date.now() - data.updated_at < OFFLINE_THRESHOLD_MS;

        peers.push({
          peer_id: name,
          dev_name: data.name,
          status: isOnline ? 'online' : 'offline',
          last_seen: data.updated_at,
          address: '',
          pub_port: 0,
          rep_port: 0,
          files: fileMap,
          work_zone: data.work_zone,
          intent: data.intent,
        });
      } catch {
        // Skip malformed files
      }
    }

    return peers;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/manifest/reader.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/manifest/reader.ts tests/manifest/reader.test.ts
git commit -m "feat: add manifest reader for git-mesh"
```

---

### Task 5: Rewrite agent.ts

**Files:**
- Rewrite: `src/agent.ts`
- Create: `tests/agent.test.ts`

- [ ] **Step 1: Write the new agent**

The v2 agent is dramatically simpler. Core loop: watch files → update manifest → git sync → read peer manifests → inject context.

```typescript
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileWatcher } from './watcher.js';
import { FastExtractor } from './extractor/fast.js';
import { ManifestWriter } from './manifest/writer.js';
import { ManifestReader } from './manifest/reader.js';
import { ContextInjector } from './injector/injector.js';
import { formatTeamContext } from './injector/formatter.js';
import { ConflictDetector } from './conflict/detector.js';
import { GitSync } from './sync/git-sync.js';
import { parsePlan } from './plan/parser.js';
import type { SwarmConfig, ManifestData, FileState } from './types.js';
import type { WatcherEvent } from './watcher.js';

export class SwarmAgent {
  private readonly projectDir: string;
  private readonly config: SwarmConfig;

  private watcher: FileWatcher;
  private fastExtractor: FastExtractor;
  private manifestWriter: ManifestWriter;
  private manifestReader: ManifestReader;
  private injector: ContextInjector;
  private conflictDetector: ConflictDetector;
  private gitSync: GitSync;

  private localFiles: Map<string, FileState> = new Map();
  private contextTimer: ReturnType<typeof setInterval> | null = null;

  constructor(projectDir: string, config: SwarmConfig) {
    this.projectDir = projectDir;
    this.config = config;

    this.watcher = new FileWatcher(projectDir, {
      ignore: [...config.ignore, config.context_file],
    });
    this.fastExtractor = new FastExtractor();
    this.manifestWriter = new ManifestWriter(projectDir, config.name);
    this.manifestReader = new ManifestReader(projectDir, config.name);
    this.injector = new ContextInjector(projectDir, config.context_file);
    this.conflictDetector = new ConflictDetector();
    this.gitSync = new GitSync(projectDir, config.name);
  }

  async start(): Promise<void> {
    await this.fastExtractor.init();

    // Load plan
    const plan = parsePlan(this.projectDir);
    if (plan) {
      console.log(`Loaded PLAN.md with ${plan.assignments.length} assignment(s).`);
    }

    // Start file watcher
    this.watcher.on('change', (event: WatcherEvent) => {
      console.log(`[watch] ${event.type} ${event.path}`);
      void this.handleFileChange(event);
    });
    await this.watcher.start();

    // Extract all existing files
    await this.extractAllKnownFiles();

    // Write initial manifest
    await this.writeManifest();

    // Start git sync
    this.gitSync.start(this.config.sync_interval * 1000);

    // Periodically read peer manifests and update context
    this.contextTimer = setInterval(() => {
      this.updateContext();
    }, this.config.sync_interval * 1000);

    // Also update context immediately
    this.updateContext();

    console.log(`Swarmcode started`);
    console.log(`  Name: ${this.config.name}`);
    console.log(`  Watching: ${this.projectDir}`);
    console.log(`  Context: ${this.config.context_file}`);
    console.log(`  Sync: every ${this.config.sync_interval}s`);
  }

  async stop(): Promise<void> {
    if (this.contextTimer) {
      clearInterval(this.contextTimer);
      this.contextTimer = null;
    }
    this.gitSync.stop();
    await this.watcher.stop();
    await this.injector.clear();
    console.log('Swarmcode agent stopped.');
  }

  private async extractAllKnownFiles(): Promise<void> {
    const files = this.watcher.getKnownFiles();
    for (const relPath of files) {
      if (relPath === this.config.context_file) continue;
      await this.extractFile(relPath);
    }
    console.log(`[init] Extracted ${this.localFiles.size} file(s)`);
  }

  private async handleFileChange(event: WatcherEvent): Promise<void> {
    if (event.type === 'file_deleted') {
      this.localFiles.delete(event.path);
    } else {
      await this.extractFile(event.path);
    }
    await this.writeManifest();
  }

  private async extractFile(relPath: string): Promise<void> {
    const absPath = resolve(this.projectDir, relPath);
    let code = '';
    try {
      code = await readFile(absPath, 'utf-8');
    } catch {
      return;
    }

    const language = FastExtractor.detectLanguage(relPath);
    const extracted = language
      ? this.fastExtractor.extract(code, language)
      : { exports: [], imports: [] };

    this.localFiles.set(relPath, {
      exports: extracted.exports,
      imports: extracted.imports,
      last_modified: Date.now(),
    });
  }

  private async writeManifest(): Promise<void> {
    const files: Record<string, FileState> = {};
    for (const [path, state] of this.localFiles) {
      files[path] = state;
    }

    // Derive work zone from most common directory
    const zones = [...this.localFiles.keys()].map(p => p.split('/').slice(0, -1).join('/') || '.');
    const zoneCounts = new Map<string, number>();
    for (const z of zones) {
      zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
    }
    const workZone = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    const manifest: ManifestData = {
      name: this.config.name,
      updated_at: Date.now(),
      work_zone: workZone,
      intent: null,
      files,
    };

    await this.manifestWriter.write(manifest);
  }

  private updateContext(): void {
    const peers = this.manifestReader.readPeers();
    if (peers.length === 0) return;

    const conflicts = this.conflictDetector.detect(peers);
    const content = formatTeamContext(peers, conflicts);

    this.injector.inject(content).then((changed) => {
      if (changed) {
        const online = peers.filter(p => p.status === 'online');
        console.log(`[context] Updated ${this.config.context_file} (${online.length} peer(s) online)`);
      }
    }).catch(() => {});
  }
}
```

- [ ] **Step 2: Run any remaining passing tests to verify nothing critical broke**

Run: `npx vitest run tests/extractor tests/injector tests/conflict tests/plan tests/watcher.test.ts -v`
Expected: All PASS (these modules are unchanged)

- [ ] **Step 3: Commit**

```bash
git add src/agent.ts
git commit -m "feat: rewrite agent for git-mesh architecture"
```

---

### Task 6: Simplify CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Rewrite CLI**

Remove mDNS check, `--peer` flags, `--git-sync` flag. Keep `init` and `start` simple.

```typescript
import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, getDefaultConfig } from './config.js';
import { VERSION } from './index.js';

export function createCLI(): Command {
  const program = new Command();
  program.name('swarmcode').description('Team-aware AI coding via git').version(VERSION);

  program.command('init')
    .description('Initialize swarmcode in the current project')
    .option('--name <name>', 'Your display name')
    .option('--ai-tool <tool>', 'AI tool to use', 'claude-code')
    .action((options) => {
      const cwd = process.cwd();
      const configDir = join(cwd, '.swarmcode');
      const peersDir = join(configDir, 'peers');
      if (existsSync(configDir)) {
        console.log('.swarmcode/ already exists.');
        return;
      }
      mkdirSync(peersDir, { recursive: true });
      const config = getDefaultConfig(options.name);
      if (options.aiTool) config.ai_tool = options.aiTool;
      writeFileSync(join(configDir, 'config.yaml'), stringifyYaml({ ...config }), 'utf-8');
      console.log('Initialized swarmcode in .swarmcode/');
      console.log(`\nMake sure .swarmcode/peers/ is committed to git.`);
      console.log(`Add your context file (${config.context_file}) to .gitignore.`);
    });

  program.command('start')
    .description('Start the swarmcode agent')
    .option('--name <name>', 'Override display name')
    .action(async (options) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      if (options.name) config.name = options.name;
      console.log(`Starting swarmcode as "${config.name}"...`);
      const { SwarmAgent } = await import('./agent.js');
      const agent = new SwarmAgent(cwd, config);
      await agent.start();
      process.on('SIGINT', async () => { try { await agent.stop(); } catch {} process.exit(0); });
      process.on('SIGTERM', async () => { try { await agent.stop(); } catch {} process.exit(0); });
    });

  program.command('status')
    .description('Show who is working on what')
    .action(() => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const { ManifestReader } = require('./manifest/reader.js');
      const reader = new ManifestReader(cwd, config.name);
      const peers = reader.readPeers();
      if (peers.length === 0) {
        console.log('No peers found. Is anyone else running swarmcode?');
        return;
      }
      for (const peer of peers) {
        console.log(`${peer.dev_name} (${peer.status}) — ${peer.work_zone || 'no zone'}`);
        for (const [path] of peer.files) {
          console.log(`  ${path}`);
        }
      }
    });

  return program;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli.ts
git commit -m "refactor: simplify CLI for git-mesh"
```

---

### Task 7: Update index.ts and remove dead code

**Files:**
- Modify: `src/index.ts`
- Delete: `src/mesh/announce.ts`, `src/mesh/broadcaster.ts`, `src/mesh/discovery.ts`, `src/mesh/query.ts`, `src/state/team-state.ts`
- Delete: `tests/mesh/broadcaster.test.ts`, `tests/mesh/discovery.test.ts`, `tests/mesh/query.test.ts`, `tests/state/team-state.test.ts`, `tests/integration/agent.integration.test.ts`
- Modify: `package.json` — remove `zeromq`, `bonjour-service`

- [ ] **Step 1: Update index.ts exports**

```typescript
export const VERSION = '0.1.0';

export { SwarmAgent } from './agent.js';
export { loadConfig, getDefaultConfig } from './config.js';
export { createCLI } from './cli.js';

export type {
  LLMProvider as LLMProviderType,
  AITool,
  ExportEntry,
  FileState,
  ManifestData,
  PeerState,
  EnrichmentConfig,
  SwarmConfig,
  ConflictSignal,
} from './types.js';
```

- [ ] **Step 2: Delete mesh files and old tests**

```bash
rm src/mesh/announce.ts src/mesh/broadcaster.ts src/mesh/discovery.ts src/mesh/query.ts
rm src/state/team-state.ts
rm tests/mesh/broadcaster.test.ts tests/mesh/discovery.test.ts tests/mesh/query.test.ts
rm tests/state/team-state.test.ts tests/integration/agent.integration.test.ts
rmdir src/mesh src/state 2>/dev/null || true
rmdir tests/mesh tests/state tests/integration 2>/dev/null || true
```

- [ ] **Step 3: Remove zeromq and bonjour-service from package.json**

```bash
npm uninstall zeromq bonjour-service
```

- [ ] **Step 4: Run all remaining tests**

Run: `npx vitest run -v`
Expected: All tests PASS (the deleted test files won't be found, remaining tests should pass)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove ZMQ mesh, mDNS, and dead code"
```

---

### Task 8: Update GitSync for v2

**Files:**
- Modify: `src/sync/git-sync.ts`

- [ ] **Step 1: Update git-sync to only commit .swarmcode/peers/ by default**

The git sync should stage only manifest files by default (`.swarmcode/peers/*.json`), not `git add -A` which would commit user code. User code commits should be left to the developer. Add an optional `sync_all` mode for teams that want full auto-sync.

Update the `sync()` method:

```typescript
async sync(): Promise<void> {
  if (this.syncing) return;
  this.syncing = true;

  try {
    const hasRemote = await this.git('remote').then(r => r.stdout.trim().length > 0).catch(() => false);
    if (!hasRemote) return;

    // Stage only manifest files
    await this.git('add', '.swarmcode/peers/');

    // Check if there's anything to commit
    const status = await this.git('diff', '--cached', '--name-only');
    if (status.stdout.trim().length > 0) {
      await this.git('commit', '-m', `swarmcode: sync from ${this.devName}`);
      console.log(`[git-sync] Committed manifest`);
    }

    // Pull with rebase
    try {
      const pull = await this.git('pull', '--rebase', '--no-edit');
      if (pull.stdout.includes('Fast-forward') || pull.stdout.includes('rewinding')) {
        console.log(`[git-sync] Pulled latest`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('CONFLICT') || msg.includes('could not apply')) {
        console.log(`[git-sync] Merge conflict, aborting rebase`);
        await this.git('rebase', '--abort').catch(() => {});
        return;
      }
    }

    // Push if ahead
    try {
      const ahead = await this.git('rev-list', '--count', '@{u}..HEAD');
      if (parseInt(ahead.stdout.trim(), 10) > 0) {
        await this.git('push');
        console.log(`[git-sync] Pushed`);
      }
    } catch {
      // non-fatal
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('nothing to commit')) {
      console.log(`[git-sync] Error: ${msg.split('\n')[0]}`);
    }
  } finally {
    this.syncing = false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sync/git-sync.ts
git commit -m "refactor: git-sync only commits manifests, not user code"
```

---

### Task 9: Full integration test

**Files:**
- Create: `tests/integration/v2-agent.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow: watcher → extractor → manifest write → manifest read → context inject.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('v2 agent integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-v2-'));
    // Simulate a peer manifest already present (as if git pulled it)
    const peersDir = join(tmpDir, '.swarmcode', 'peers');
    mkdirSync(peersDir, { recursive: true });
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({
      name: 'laptop',
      updated_at: Date.now(),
      work_zone: 'src/lib',
      intent: null,
      files: {
        'src/lib/types.ts': {
          exports: [{ name: 'Task', signature: 'export interface Task' }],
          imports: [],
          last_modified: Date.now(),
        },
        'src/lib/db.ts': {
          exports: [
            { name: 'getAllTasks', signature: 'export function getAllTasks()' },
            { name: 'createTask', signature: 'export function createTask(title: string)' },
          ],
          imports: ['better-sqlite3', './types'],
          last_modified: Date.now(),
        },
      },
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads peer manifests and generates correct context', async () => {
    const { ManifestReader } = await import('../../src/manifest/reader.js');
    const { formatTeamContext } = await import('../../src/injector/formatter.js');
    const { ConflictDetector } = await import('../../src/conflict/detector.js');

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();

    expect(peers).toHaveLength(1);
    expect(peers[0].dev_name).toBe('laptop');
    expect(peers[0].files.get('src/lib/types.ts')?.exports[0].name).toBe('Task');

    const detector = new ConflictDetector();
    const conflicts = detector.detect(peers);
    const context = formatTeamContext(peers, conflicts);

    expect(context).toContain('laptop');
    expect(context).toContain('Task');
    expect(context).toContain('getAllTasks');
    expect(context).toContain('import from here, do not rebuild');
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/integration/v2-agent.test.ts -v`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run -v`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/v2-agent.test.ts
git commit -m "test: add v2 integration test for manifest-based flow"
```

---

### Task 10: Update README and push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Update the README to reflect the new architecture:
- Remove all ZMQ/mDNS/port references
- Remove `--peer` flag documentation
- Update "How It Works" to describe git-based sync
- Update config docs (remove `peers`, `git_sync`, add `sync_interval`)
- Simplify Quick Start (just `init` + `start`)
- Update FAQ

- [ ] **Step 2: Final commit and push**

```bash
git add README.md
git commit -m "docs: update README for v2 git-mesh architecture"
git push origin master
```
