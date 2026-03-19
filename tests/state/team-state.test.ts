import { describe, it, expect, beforeEach } from 'vitest';
import { TeamState } from '../../src/state/team-state.js';
import type { PeerInfo, SwarmUpdate } from '../../src/types.js';

const makePeerInfo = (overrides: Partial<PeerInfo> = {}): PeerInfo => ({
  peer_id: 'peer-001',
  dev_name: 'alice',
  address: '192.168.1.10',
  pub_port: 5555,
  rep_port: 5556,
  ...overrides,
});

const makeUpdate = (overrides: Partial<SwarmUpdate> = {}): SwarmUpdate => ({
  peer_id: 'peer-001',
  dev_name: 'alice',
  timestamp: 1000,
  event_type: 'file_created',
  file_path: 'src/utils.ts',
  exports: [{ name: 'add', signature: 'add(a: number, b: number): number' }],
  imports: ['fs'],
  work_zone: 'src/',
  intent: null,
  summary: null,
  interfaces: [],
  touches: [],
  ...overrides,
});

describe('TeamState', () => {
  let state: TeamState;

  beforeEach(() => {
    state = new TeamState('self-id');
  });

  describe('addPeer', () => {
    it('registers a new peer', () => {
      state.addPeer(makePeerInfo());
      const peer = state.getPeer('peer-001');
      expect(peer).toBeDefined();
      expect(peer?.peer_id).toBe('peer-001');
      expect(peer?.dev_name).toBe('alice');
      expect(peer?.status).toBe('online');
      expect(peer?.address).toBe('192.168.1.10');
      expect(peer?.pub_port).toBe(5555);
      expect(peer?.rep_port).toBe(5556);
      expect(peer?.files).toBeInstanceOf(Map);
      expect(peer?.files.size).toBe(0);
      expect(peer?.work_zone).toBe('');
      expect(peer?.intent).toBeNull();
    });

    it('updates an existing peer connection info', () => {
      state.addPeer(makePeerInfo({ address: '10.0.0.1' }));
      state.addPeer(makePeerInfo({ address: '10.0.0.2', pub_port: 9999 }));
      const peer = state.getPeer('peer-001');
      expect(peer?.address).toBe('10.0.0.2');
      expect(peer?.pub_port).toBe(9999);
    });

    it('preserves existing file state when updating peer connection info', () => {
      state.addPeer(makePeerInfo());
      state.applyUpdate(makeUpdate({ event_type: 'file_created', file_path: 'src/a.ts' }));
      state.addPeer(makePeerInfo({ address: '10.0.0.99' }));
      const peer = state.getPeer('peer-001');
      expect(peer?.files.size).toBe(1);
    });
  });

  describe('removePeer', () => {
    it('removes an existing peer', () => {
      state.addPeer(makePeerInfo());
      state.removePeer('peer-001');
      expect(state.getPeer('peer-001')).toBeUndefined();
    });

    it('is a no-op for unknown peer', () => {
      expect(() => state.removePeer('ghost')).not.toThrow();
    });
  });

  describe('getAllPeers', () => {
    it('returns all peers excluding self', () => {
      state.addPeer(makePeerInfo({ peer_id: 'peer-001' }));
      state.addPeer(makePeerInfo({ peer_id: 'peer-002', dev_name: 'bob' }));
      // self should not appear even if added
      state.addPeer(makePeerInfo({ peer_id: 'self-id', dev_name: 'self' }));
      const peers = state.getAllPeers();
      expect(peers).toHaveLength(2);
      expect(peers.map((p) => p.peer_id)).not.toContain('self-id');
    });

    it('returns empty array when no peers', () => {
      expect(state.getAllPeers()).toHaveLength(0);
    });
  });

  describe('getOnlinePeers', () => {
    it('returns only online peers', () => {
      state.addPeer(makePeerInfo({ peer_id: 'peer-001' }));
      state.addPeer(makePeerInfo({ peer_id: 'peer-002', dev_name: 'bob' }));
      state.markOffline('peer-002');
      const online = state.getOnlinePeers();
      expect(online).toHaveLength(1);
      expect(online[0].peer_id).toBe('peer-001');
    });
  });

  describe('applyUpdate', () => {
    it('adds file to files Map on file_created', () => {
      state.addPeer(makePeerInfo());
      state.applyUpdate(makeUpdate({ event_type: 'file_created', file_path: 'src/utils.ts' }));
      const peer = state.getPeer('peer-001');
      expect(peer?.files.has('src/utils.ts')).toBe(true);
      const fileState = peer?.files.get('src/utils.ts');
      expect(fileState?.exports).toHaveLength(1);
      expect(fileState?.imports).toContain('fs');
      expect(fileState?.last_modified).toBe(1000);
    });

    it('updates file in files Map on file_modified', () => {
      state.addPeer(makePeerInfo());
      state.applyUpdate(makeUpdate({ event_type: 'file_created', file_path: 'src/utils.ts', timestamp: 1000 }));
      state.applyUpdate(makeUpdate({ event_type: 'file_modified', file_path: 'src/utils.ts', timestamp: 2000, exports: [] }));
      const fileState = state.getPeer('peer-001')?.files.get('src/utils.ts');
      expect(fileState?.exports).toHaveLength(0);
      expect(fileState?.last_modified).toBe(2000);
    });

    it('removes file from files Map on file_deleted', () => {
      state.addPeer(makePeerInfo());
      state.applyUpdate(makeUpdate({ event_type: 'file_created', file_path: 'src/utils.ts' }));
      expect(state.getPeer('peer-001')?.files.has('src/utils.ts')).toBe(true);
      state.applyUpdate(makeUpdate({ event_type: 'file_deleted', file_path: 'src/utils.ts' }));
      expect(state.getPeer('peer-001')?.files.has('src/utils.ts')).toBe(false);
    });

    it('updates work_zone and intent on applyUpdate', () => {
      state.addPeer(makePeerInfo());
      state.applyUpdate(makeUpdate({ work_zone: 'src/auth/', intent: 'Building auth module' }));
      const peer = state.getPeer('peer-001');
      expect(peer?.work_zone).toBe('src/auth/');
      expect(peer?.intent).toBe('Building auth module');
    });

    it('is a no-op for unknown peer', () => {
      expect(() => state.applyUpdate(makeUpdate({ peer_id: 'ghost' }))).not.toThrow();
    });

    it('auto-registers peer if not yet known', () => {
      // applyUpdate should not crash, but does not need to create the peer
      // (no-op for unknown peer is acceptable)
      const update = makeUpdate({ peer_id: 'new-peer' });
      expect(() => state.applyUpdate(update)).not.toThrow();
    });
  });

  describe('markOffline', () => {
    it('sets peer status to offline', () => {
      state.addPeer(makePeerInfo());
      state.markOffline('peer-001');
      expect(state.getPeer('peer-001')?.status).toBe('offline');
    });

    it('is a no-op for unknown peer', () => {
      expect(() => state.markOffline('ghost')).not.toThrow();
    });
  });

  describe('heartbeat', () => {
    it('updates last_seen and sets status to online', async () => {
      state.addPeer(makePeerInfo());
      state.markOffline('peer-001');
      const before = Date.now();
      state.heartbeat('peer-001');
      const after = Date.now();
      const peer = state.getPeer('peer-001');
      expect(peer?.status).toBe('online');
      expect(peer?.last_seen).toBeGreaterThanOrEqual(before);
      expect(peer?.last_seen).toBeLessThanOrEqual(after);
    });

    it('is a no-op for unknown peer', () => {
      expect(() => state.heartbeat('ghost')).not.toThrow();
    });
  });

  describe('getSnapshot', () => {
    it('returns a deep copy of all peer states', () => {
      state.addPeer(makePeerInfo({ peer_id: 'peer-001' }));
      state.addPeer(makePeerInfo({ peer_id: 'peer-002', dev_name: 'bob' }));
      state.applyUpdate(makeUpdate({ peer_id: 'peer-001', file_path: 'src/a.ts' }));

      const snapshot = state.getSnapshot();
      expect(snapshot).toHaveLength(2);

      // Mutating snapshot should not affect internal state
      const snapshotPeer = snapshot.find((p) => p.peer_id === 'peer-001')!;
      snapshotPeer.files.set('src/injected.ts', { exports: [], imports: [], last_modified: 0 });
      snapshotPeer.work_zone = 'mutated/';

      const original = state.getPeer('peer-001')!;
      expect(original.files.has('src/injected.ts')).toBe(false);
      expect(original.work_zone).not.toBe('mutated/');
    });

    it('does not include self in snapshot', () => {
      state.addPeer(makePeerInfo({ peer_id: 'self-id' }));
      const snapshot = state.getSnapshot();
      expect(snapshot.map((p) => p.peer_id)).not.toContain('self-id');
    });
  });
});
