import { describe, it, expect } from 'vitest';
import type {
  PeerState,
  SwarmConfig,
  FileState,
  ExportEntry,
  EnrichmentConfig,
  ConflictSignal,
  ManifestData,
} from '../src/types.js';


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
      sync_interval: 5,
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
      sync_interval: 10,
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


describe('ManifestData', () => {
  it('creates a valid ManifestData with files record', () => {
    const fileState: FileState = {
      exports: [{ name: 'parseConfig', signature: 'parseConfig(path: string): SwarmConfig' }],
      imports: ['fs', 'path'],
      last_modified: 1700000000000,
    };

    const manifest: ManifestData = {
      name: 'alice',
      updated_at: Date.now(),
      work_zone: 'src/',
      intent: 'Refactoring config loader',
      files: { 'src/config.ts': fileState },
    };

    expect(manifest.name).toBe('alice');
    expect(manifest.work_zone).toBe('src/');
    expect(manifest.intent).toBe('Refactoring config loader');
    expect(manifest.files['src/config.ts']).toEqual(fileState);
  });

  it('accepts null intent', () => {
    const manifest: ManifestData = {
      name: 'bob',
      updated_at: 1000,
      work_zone: '',
      intent: null,
      files: {},
    };

    expect(manifest.intent).toBeNull();
    expect(Object.keys(manifest.files)).toHaveLength(0);
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
