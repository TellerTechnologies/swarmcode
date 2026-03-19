import { describe, it, expect } from 'vitest';
import type {
  SwarmUpdate,
  PeerState,
  SwarmConfig,
  QueryRequest,
  QueryResponse,
  FileState,
  ExportEntry,
  EnrichmentConfig,
  ConflictSignal,
} from '../src/types.js';

describe('SwarmUpdate', () => {
  it('creates a valid SwarmUpdate with tier 1 fields', () => {
    const update: SwarmUpdate = {
      peer_id: 'peer-abc-123',
      dev_name: 'alice',
      timestamp: Date.now(),
      event_type: 'file_modified',
      file_path: 'src/utils.ts',
      exports: [{ name: 'formatDate', signature: 'formatDate(d: Date): string' }],
      imports: ['fs', 'path'],
      work_zone: 'src/',
      intent: null,
      summary: null,
      interfaces: [],
      touches: [],
    };

    expect(update.peer_id).toBe('peer-abc-123');
    expect(update.dev_name).toBe('alice');
    expect(update.event_type).toBe('file_modified');
    expect(update.file_path).toBe('src/utils.ts');
    expect(update.exports).toHaveLength(1);
    expect(update.exports[0].name).toBe('formatDate');
    expect(update.imports).toContain('fs');
    expect(update.intent).toBeNull();
    expect(update.summary).toBeNull();
  });

  it('accepts all valid EventType values', () => {
    const types: SwarmUpdate['event_type'][] = [
      'file_created',
      'file_modified',
      'file_deleted',
      'intent_updated',
    ];
    expect(types).toHaveLength(4);
  });

  it('allows non-null intent and summary for enriched updates', () => {
    const update: SwarmUpdate = {
      peer_id: 'peer-xyz',
      dev_name: 'bob',
      timestamp: 1000,
      event_type: 'file_created',
      file_path: 'src/api.ts',
      exports: [],
      imports: [],
      work_zone: 'src/',
      intent: 'Adding REST API endpoint for user auth',
      summary: 'Defines POST /auth/login handler',
      interfaces: ['AuthRequest', 'AuthResponse'],
      touches: ['src/db.ts', 'src/middleware.ts'],
    };

    expect(update.intent).toBe('Adding REST API endpoint for user auth');
    expect(update.summary).toBe('Defines POST /auth/login handler');
    expect(update.interfaces).toContain('AuthRequest');
    expect(update.touches).toContain('src/db.ts');
  });
});

describe('PeerState', () => {
  it('creates a PeerState with a Map of files', () => {
    const fileState: FileState = {
      exports: [{ name: 'doThing', signature: 'doThing(): void' }],
      imports: ['react'],
      last_modified: 1700000000000,
    };

    const peerState: PeerState = {
      peer_id: 'peer-001',
      dev_name: 'charlie',
      status: 'online',
      last_seen: Date.now(),
      address: '192.168.1.10',
      pub_port: 5555,
      rep_port: 5556,
      files: new Map([['src/component.tsx', fileState]]),
      work_zone: 'src/',
      intent: null,
    };

    expect(peerState.peer_id).toBe('peer-001');
    expect(peerState.status).toBe('online');
    expect(peerState.files).toBeInstanceOf(Map);
    expect(peerState.files.size).toBe(1);
    expect(peerState.files.get('src/component.tsx')).toEqual(fileState);
    expect(peerState.pub_port).toBe(5555);
    expect(peerState.rep_port).toBe(5556);
  });

  it('accepts offline status', () => {
    const peerState: PeerState = {
      peer_id: 'peer-002',
      dev_name: 'dana',
      status: 'offline',
      last_seen: Date.now() - 60000,
      address: '10.0.0.1',
      pub_port: 6000,
      rep_port: 6001,
      files: new Map(),
      work_zone: '',
      intent: null,
    };

    expect(peerState.status).toBe('offline');
    expect(peerState.files.size).toBe(0);
  });
});

describe('SwarmConfig', () => {
  it('creates a SwarmConfig with enrichment config', () => {
    const enrichment: EnrichmentConfig = {
      provider: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      tier2_model: 'claude-haiku-3-5',
      tier3_model: 'claude-sonnet-4-5',
    };

    const config: SwarmConfig = {
      name: 'my-project',
      ai_tool: 'claude-code',
      context_file: 'CLAUDE.md',
      ignore: ['node_modules', 'dist', '.git'],
      tier2_interval: 30,
      tier3_interval: 300,
      enrichment,
    };

    expect(config.name).toBe('my-project');
    expect(config.ai_tool).toBe('claude-code');
    expect(config.context_file).toBe('CLAUDE.md');
    expect(config.ignore).toContain('node_modules');
    expect(config.tier2_interval).toBe(30);
    expect(config.tier3_interval).toBe(300);
    expect(config.enrichment.provider).toBe('anthropic');
    expect(config.enrichment.tier2_model).toBe('claude-haiku-3-5');
  });

  it('accepts provider none for offline mode', () => {
    const config: SwarmConfig = {
      name: 'offline-project',
      ai_tool: 'cursor',
      context_file: '.cursorrules',
      ignore: [],
      tier2_interval: 60,
      tier3_interval: 600,
      enrichment: {
        provider: 'none',
        api_key_env: '',
        tier2_model: '',
        tier3_model: '',
      },
    };

    expect(config.enrichment.provider).toBe('none');
    expect(config.ai_tool).toBe('cursor');
  });
});

describe('QueryRequest and QueryResponse', () => {
  it('creates a valid QueryRequest', () => {
    const request: QueryRequest = {
      type: 'exports',
      file_path: 'src/utils.ts',
    };

    expect(request.type).toBe('exports');
    expect(request.file_path).toBe('src/utils.ts');
  });

  it('creates a successful QueryResponse', () => {
    const exports: ExportEntry[] = [
      { name: 'add', signature: 'add(a: number, b: number): number' },
    ];

    const response: QueryResponse = {
      type: 'exports',
      file_path: 'src/utils.ts',
      data: exports,
      error: null,
    };

    expect(response.type).toBe('exports');
    expect(response.error).toBeNull();
    expect(response.data).toEqual(exports);
  });

  it('creates a QueryResponse with an error', () => {
    const response: QueryResponse = {
      type: 'file_exists',
      file_path: 'src/missing.ts',
      data: null,
      error: 'File not found',
    };

    expect(response.error).toBe('File not found');
    expect(response.data).toBeNull();
  });

  it('supports all QueryType values', () => {
    const types: QueryRequest['type'][] = ['exports', 'file_exists', 'dependencies'];
    expect(types).toHaveLength(3);
  });
});

describe('ConflictSignal', () => {
  it('creates a zone_overlap conflict signal', () => {
    const conflict: ConflictSignal = {
      type: 'zone_overlap',
      severity: 'warning',
      peers: ['peer-001', 'peer-002'],
      description: 'Both peers are editing files in src/auth/',
      file_paths: ['src/auth/login.ts', 'src/auth/logout.ts'],
    };

    expect(conflict.type).toBe('zone_overlap');
    expect(conflict.severity).toBe('warning');
    expect(conflict.peers).toHaveLength(2);
  });

  it('creates a critical interface_conflict signal', () => {
    const conflict: ConflictSignal = {
      type: 'interface_conflict',
      severity: 'critical',
      peers: ['peer-001', 'peer-003'],
      description: 'Conflicting definitions of UserAuth interface',
      file_paths: ['src/types.ts'],
    };

    expect(conflict.severity).toBe('critical');
    expect(conflict.type).toBe('interface_conflict');
  });
});
