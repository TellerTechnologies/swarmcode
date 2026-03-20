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
import type { SwarmConfig, FileState } from './types.js';
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

    const plan = parsePlan(this.projectDir);
    if (plan) {
      console.log(`Loaded PLAN.md with ${plan.assignments.length} assignment(s).`);
    }

    this.watcher.on('change', (event: WatcherEvent) => {
      console.log(`[watch] ${event.type} ${event.path}`);
      void this.handleFileChange(event);
    });
    await this.watcher.start();

    await this.extractAllKnownFiles();
    await this.writeManifest();

    this.gitSync.start(this.config.sync_interval * 1000);

    this.contextTimer = setInterval(() => {
      this.updateContext();
    }, this.config.sync_interval * 1000);

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

    const zones = [...this.localFiles.keys()].map(p => p.split('/').slice(0, -1).join('/') || '.');
    const zoneCounts = new Map<string, number>();
    for (const z of zones) {
      zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
    }
    const workZone = [...zoneCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

    await this.manifestWriter.write({
      name: this.config.name,
      updated_at: Date.now(),
      work_zone: workZone,
      intent: null,
      files,
    });
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
