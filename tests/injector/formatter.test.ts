import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTeamContext } from '../../src/injector/formatter.js';
import type { PeerState, ConflictSignal } from '../../src/types.js';

const NOW = 1_700_000_000_000;

function makePeer(overrides: Partial<PeerState> = {}): PeerState {
  return {
    peer_id: 'peer-001',
    dev_name: 'alice',
    status: 'online',
    last_seen: NOW - 30_000, // 30s ago
    address: '127.0.0.1',
    pub_port: 5555,
    rep_port: 5556,
    files: new Map(),
    work_zone: 'src/auth/',
    intent: 'Building auth module',
    ...overrides,
  };
}

describe('formatTeamContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates header with do-not-rebuild instruction', () => {
    const output = formatTeamContext([]);
    expect(output).toContain('## Swarmcode Team Context');
    expect(output.toLowerCase()).toContain('do not rebuild');
  });

  it('renders a single peer with files and exports', () => {
    const peer = makePeer({
      files: new Map([
        [
          'src/auth/index.ts',
          {
            exports: [
              { name: 'login', signature: 'login(user: string, pass: string): Promise<Token>' },
              { name: 'logout', signature: 'logout(token: Token): void' },
            ],
            imports: [],
            last_modified: NOW - 5000,
          },
        ],
      ]),
    });

    const output = formatTeamContext([peer]);

    expect(output).toContain('### alice');
    expect(output).toContain('online');
    expect(output).toContain('30s ago');
    expect(output).toContain('src/auth/');
    expect(output).toContain('DO NOT create files');
    expect(output).toContain('Building auth module');
    expect(output).toContain('src/auth/index.ts');
    expect(output).toContain('login');
    expect(output).toContain('login(user: string, pass: string): Promise<Token>');
    expect(output).toContain('logout');
    // imperative tone
    expect(output).toContain('import from here, do not rebuild');
  });

  it('renders multiple peers', () => {
    const alice = makePeer({ dev_name: 'alice', peer_id: 'peer-001' });
    const bob = makePeer({
      dev_name: 'bob',
      peer_id: 'peer-002',
      work_zone: 'src/api/',
      intent: 'Building REST API',
    });

    const output = formatTeamContext([alice, bob]);

    expect(output).toContain('### alice');
    expect(output).toContain('### bob');
    expect(output).toContain('src/auth/');
    expect(output).toContain('src/api/');
    expect(output).toContain('Building REST API');
  });

  it('marks offline peers with offline status and time', () => {
    const peer = makePeer({
      status: 'offline',
      last_seen: NOW - 3 * 60 * 1000, // 3 minutes ago
    });

    const output = formatTeamContext([peer]);

    expect(output).toContain('offline');
    expect(output).toContain('3m ago');
  });

  it('shows Active Warnings section when conflicts provided', () => {
    const peer = makePeer();
    const conflict: ConflictSignal = {
      type: 'zone_overlap',
      severity: 'warning',
      peers: ['alice', 'bob'],
      description: 'Both working in src/auth/ simultaneously',
      file_paths: ['src/auth/index.ts'],
    };

    const output = formatTeamContext([peer], [conflict]);

    expect(output).toContain('### Active Warnings');
    expect(output).toContain('WARNING:');
    expect(output).toContain('Both working in src/auth/ simultaneously');
    expect(output).toContain('src/auth/index.ts');
    expect(output).toContain('alice');
    expect(output).toContain('bob');
  });

  it('omits Active Warnings section when no conflicts', () => {
    const output = formatTeamContext([makePeer()]);
    expect(output).not.toContain('### Active Warnings');
  });

  it('omits Active Warnings section when conflicts is empty array', () => {
    const output = formatTeamContext([makePeer()], []);
    expect(output).not.toContain('### Active Warnings');
  });

  it('uses imperative tone for exports', () => {
    const peer = makePeer({
      files: new Map([
        [
          'src/utils.ts',
          {
            exports: [{ name: 'formatDate', signature: 'formatDate(d: Date): string' }],
            imports: [],
            last_modified: NOW,
          },
        ],
      ]),
    });

    const output = formatTeamContext([peer]);
    expect(output).toContain('import from here, do not rebuild');
  });

  it('handles peer with no files gracefully', () => {
    const peer = makePeer({ files: new Map() });
    const output = formatTeamContext([peer]);
    expect(output).toContain('### alice');
    expect(output).not.toContain('**Files:**');
  });

  it('handles peer with no intent gracefully', () => {
    const peer = makePeer({ intent: null });
    const output = formatTeamContext([peer]);
    expect(output).toContain('### alice');
    expect(output).not.toContain('**Intent:**');
  });
});
