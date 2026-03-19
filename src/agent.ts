import { readFile, access } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { FileWatcher } from './watcher.js';
import { FastExtractor } from './extractor/fast.js';
import { RichExtractor } from './extractor/rich.js';
import { MeshDiscovery } from './mesh/discovery.js';
import { MeshBroadcaster } from './mesh/broadcaster.js';
import { QueryServer, QueryClient } from './mesh/query.js';
import { TeamState } from './state/team-state.js';
import { ContextInjector } from './injector/injector.js';
import { formatTeamContext } from './injector/formatter.js';
import { ConflictDetector } from './conflict/detector.js';
import { createLLMProvider } from './llm/provider.js';
import { parsePlan } from './plan/parser.js';
import type { SwarmConfig, SwarmUpdate, PeerInfo, QueryRequest, QueryResponse } from './types.js';
import type { WatcherEvent } from './watcher.js';

export class SwarmAgent {
  private static readonly MAX_TIER2_BUFFER = 500;

  private readonly projectDir: string;
  private readonly config: SwarmConfig;

  private watcher: FileWatcher;
  private fastExtractor: FastExtractor;
  private richExtractor: RichExtractor;
  private broadcaster: MeshBroadcaster;
  private queryServer: QueryServer;
  private queryClient: QueryClient;
  private teamState: TeamState | null = null;
  private discovery: MeshDiscovery | null = null;
  private injector: ContextInjector;
  private conflictDetector: ConflictDetector;

  private selfId: string = '';
  private pubPort: number = 0;
  private repPort: number = 0;

  private tier2Buffer: SwarmUpdate[] = [];
  private tier2Timer: ReturnType<typeof setInterval> | null = null;
  private tier3Timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastTier3Analysis: string | null = null;

  constructor(projectDir: string, config: SwarmConfig) {
    this.projectDir = projectDir;
    this.config = config;

    this.watcher = new FileWatcher(projectDir, { ignore: config.ignore });
    this.fastExtractor = new FastExtractor();
    const llmProvider = createLLMProvider(config.enrichment);
    this.richExtractor = new RichExtractor(llmProvider);
    this.broadcaster = new MeshBroadcaster();
    this.injector = new ContextInjector(projectDir, config.context_file);
    this.conflictDetector = new ConflictDetector();

    // QueryServer handler: answers queries about our own files
    this.queryServer = new QueryServer(async (req: QueryRequest): Promise<QueryResponse> => {
      return this.handleQuery(req);
    });

    this.queryClient = new QueryClient();
  }

  async start(): Promise<void> {
    await this.fastExtractor.init();

    // Bind PUB and REP on random ports (port=0)
    this.pubPort = await this.broadcaster.start(0);
    this.repPort = await this.queryServer.start(0);

    // Create discovery with actual ports
    this.discovery = new MeshDiscovery({
      name: this.config.name,
      pub_port: this.pubPort,
      rep_port: this.repPort,
    });

    const selfInfo = this.discovery.getSelfInfo();
    this.selfId = selfInfo.peer_id;
    this.teamState = new TeamState(this.selfId);

    // Wire up discovery events
    this.discovery.on('peer-discovered', (peer: PeerInfo) => {
      this.teamState!.addPeer(peer);
      // Subscribe to their broadcasts
      this.broadcaster.subscribeTo(peer.address, peer.pub_port).catch(() => {
        // Ignore connection errors for unreachable peers
      });
      this.updateContext();
    });

    this.discovery.on('peer-lost', (peerId: string) => {
      this.teamState!.markOffline(peerId);
      this.updateContext();
    });

    // Wire up broadcaster 'update' events
    this.broadcaster.on('update', (update: SwarmUpdate) => {
      if (!this.teamState) return;
      // Only accept updates from known/discovered peers
      if (!this.teamState.getPeer(update.peer_id)) {
        return; // Ignore unknown peer
      }
      this.teamState.applyUpdate(update);
      this.teamState.heartbeat(update.peer_id);
      this.updateContext();
    });

    // Wire up watcher 'change' events
    this.watcher.on('change', async (event: WatcherEvent) => {
      await this.handleFileChange(event);
    });

    // Start discovery
    await this.discovery.start();

    // Load PLAN.md if present
    const plan = parsePlan(this.projectDir);
    if (plan) {
      console.log(`Loaded PLAN.md with ${plan.assignments.length} assignment(s).`);
    }

    // Start watcher
    await this.watcher.start();

    // Tier 2 timer: batch enrich and broadcast
    this.tier2Timer = setInterval(async () => {
      if (this.tier2Buffer.length === 0) return;
      const batch = this.tier2Buffer.splice(0);
      try {
        const result = await this.richExtractor.enrichBatch(batch);
        if (result.intent || result.summary) {
          // Re-broadcast the last update with enriched intent
          const lastUpdate = batch[batch.length - 1];
          const enriched: SwarmUpdate = {
            ...lastUpdate,
            intent: result.intent,
            summary: result.summary,
            event_type: 'intent_updated',
          };
          await this.broadcaster.publish(enriched);
        }
      } catch {
        // Enrichment failures are non-fatal
      }
    }, this.config.tier2_interval * 1000);

    // Tier 3 timer: full team analysis
    this.tier3Timer = setInterval(async () => {
      if (!this.teamState) return;
      const peers = this.teamState.getSnapshot();
      const description = peers
        .map((p) => `${p.dev_name} (${p.status}): zone=${p.work_zone}, intent=${p.intent ?? 'unknown'}`)
        .join('\n');
      try {
        const analysis = await this.richExtractor.analyzeTeam(description);
        if (analysis) {
          // Store the analysis and trigger a context update
          // so the AI gets the cross-team insights
          this.lastTier3Analysis = analysis;
          await this.updateContext();
        }
      } catch {
        // Analysis failures are non-fatal
      }
    }, this.config.tier3_interval * 1000);

    // Heartbeat timer: mark peers offline after 15s silence
    this.heartbeatTimer = setInterval(() => {
      if (!this.teamState) return;
      const now = Date.now();
      const OFFLINE_THRESHOLD_MS = 15_000;
      for (const peer of this.teamState.getAllPeers()) {
        if (peer.status === 'online' && now - peer.last_seen > OFFLINE_THRESHOLD_MS) {
          this.teamState.markOffline(peer.peer_id);
          this.updateContext();
        }
      }
    }, 5_000);

    console.log(`Swarmcode agent started. PUB port: ${this.pubPort}, REP port: ${this.repPort}`);
  }

  async stop(): Promise<void> {
    // Clear all timers
    if (this.tier2Timer) { clearInterval(this.tier2Timer); this.tier2Timer = null; }
    if (this.tier3Timer) { clearInterval(this.tier3Timer); this.tier3Timer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }

    // Stop all components
    await this.watcher.stop();
    if (this.discovery) { await this.discovery.stop(); this.discovery = null; }
    await this.broadcaster.stop();
    await this.queryServer.stop();
    await this.queryClient.close();

    // Clear injected context
    await this.injector.clear();

    console.log('Swarmcode agent stopped.');
  }

  getRepPort(): number {
    return this.repPort;
  }

  private updateContext(): void {
    if (!this.teamState) return;
    const peers = this.teamState.getSnapshot();
    if (peers.length === 0) return;
    const conflicts = this.conflictDetector.detect(peers);
    const content = formatTeamContext(peers, conflicts, this.lastTier3Analysis ?? undefined);
    this.injector.inject(content).catch(() => {
      // Non-fatal: ignore inject errors
    });
  }

  private async handleFileChange(event: WatcherEvent): Promise<void> {
    if (event.type === 'file_deleted') {
      const update: SwarmUpdate = {
        peer_id: this.selfId,
        dev_name: this.config.name,
        timestamp: Date.now(),
        event_type: 'file_deleted',
        file_path: event.path,
        exports: [],
        imports: [],
        work_zone: this.inferWorkZone(event.path),
        intent: null,
        summary: null,
        interfaces: [],
        touches: [],
      };
      try {
        await this.broadcaster.publish(update);
      } catch {
        // Non-fatal
      }
      if (this.tier2Buffer.length >= SwarmAgent.MAX_TIER2_BUFFER) {
        this.tier2Buffer.shift(); // Drop oldest
      }
      this.tier2Buffer.push(update);
      return;
    }

    // For created/modified: fast extract
    let code = '';
    try {
      code = await readFile(event.absolutePath, 'utf-8');
    } catch {
      return; // File may have been deleted between event and read
    }

    const language = FastExtractor.detectLanguage(event.path);
    const extracted = language ? this.fastExtractor.extract(code, language) : { exports: [], imports: [] };

    const update: SwarmUpdate = {
      peer_id: this.selfId,
      dev_name: this.config.name,
      timestamp: Date.now(),
      event_type: event.type,
      file_path: event.path,
      exports: extracted.exports,
      imports: extracted.imports,
      work_zone: this.inferWorkZone(event.path),
      intent: null,
      summary: null,
      interfaces: [],
      touches: [],
    };

    try {
      await this.broadcaster.publish(update);
    } catch {
      // Non-fatal
    }

    if (this.tier2Buffer.length >= SwarmAgent.MAX_TIER2_BUFFER) {
      this.tier2Buffer.shift(); // Drop oldest
    }
    this.tier2Buffer.push(update);
  }

  private inferWorkZone(filePath: string): string {
    // Use the full directory path (everything except the filename) as the work zone
    // e.g. src/auth/middleware.ts -> src/auth
    return filePath.split('/').slice(0, -1).join('/') || '.';
  }

  private isPathSafe(filePath: string): boolean {
    const resolved = resolve(this.projectDir, filePath);
    return resolved.startsWith(this.projectDir + sep) || resolved === this.projectDir;
  }

  private async handleQuery(req: QueryRequest): Promise<QueryResponse> {
    // Validate path to prevent path traversal attacks
    if (!this.isPathSafe(req.file_path)) {
      return { type: req.type, file_path: req.file_path, data: null, error: 'Path outside project' };
    }

    // Resolve to absolute path within projectDir
    const absolutePath = resolve(this.projectDir, req.file_path);

    if (req.type === 'file_exists') {
      const exists = await access(absolutePath).then(() => true).catch(() => false);
      return { type: req.type, file_path: req.file_path, data: exists, error: null };
    }

    if (req.type === 'exports') {
      try {
        const code = await readFile(absolutePath, 'utf-8');
        const language = FastExtractor.detectLanguage(req.file_path);
        const result = language ? this.fastExtractor.extract(code, language) : { exports: [], imports: [] };
        return { type: req.type, file_path: req.file_path, data: result.exports, error: null };
      } catch (err) {
        return { type: req.type, file_path: req.file_path, data: null, error: String(err) };
      }
    }

    if (req.type === 'dependencies') {
      try {
        const code = await readFile(absolutePath, 'utf-8');
        const language = FastExtractor.detectLanguage(req.file_path);
        const result = language ? this.fastExtractor.extract(code, language) : { exports: [], imports: [] };
        return { type: req.type, file_path: req.file_path, data: result.imports, error: null };
      } catch (err) {
        return { type: req.type, file_path: req.file_path, data: null, error: String(err) };
      }
    }

    return { type: req.type, file_path: req.file_path, data: null, error: 'Unknown query type' };
  }
}
