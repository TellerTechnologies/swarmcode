import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MeshDiscovery } from '../../src/mesh/discovery.js';
import type { PeerInfo } from '../../src/types.js';

// We do NOT call start() in these tests to avoid real mDNS network activity.
// Instead we directly exercise the public methods that manage peer state.

describe('MeshDiscovery', () => {
  let discovery: MeshDiscovery;

  beforeEach(() => {
    discovery = new MeshDiscovery({ name: 'test-peer', pub_port: 5555, rep_port: 5556 });
  });

  afterEach(() => {
    // Nothing to clean up – we never called start()
  });

  describe('getSelfInfo', () => {
    it('returns a PeerInfo with the configured name and ports', () => {
      const info = discovery.getSelfInfo();
      expect(info.dev_name).toBe('test-peer');
      expect(info.pub_port).toBe(5555);
      expect(info.rep_port).toBe(5556);
    });

    it('returns a PeerInfo with a valid UUID peer_id', () => {
      const info = discovery.getSelfInfo();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(info.peer_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('returns the same peer_id on multiple calls', () => {
      const first = discovery.getSelfInfo();
      const second = discovery.getSelfInfo();
      expect(first.peer_id).toBe(second.peer_id);
    });
  });

  describe('getKnownPeers', () => {
    it('returns an empty array initially', () => {
      expect(discovery.getKnownPeers()).toEqual([]);
    });
  });

  describe('handlePeerFound', () => {
    it('emits peer-discovered when a new peer is found', () => {
      const handler = vi.fn();
      discovery.on('peer-discovered', handler);

      const peer: PeerInfo = {
        peer_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        dev_name: 'alice',
        address: '192.168.1.2',
        pub_port: 6000,
        rep_port: 6001,
      };

      discovery.handlePeerFound(peer);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(peer);
    });

    it('adds the peer to known peers', () => {
      const peer: PeerInfo = {
        peer_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        dev_name: 'alice',
        address: '192.168.1.2',
        pub_port: 6000,
        rep_port: 6001,
      };

      discovery.handlePeerFound(peer);

      const known = discovery.getKnownPeers();
      expect(known).toHaveLength(1);
      expect(known[0]).toEqual(peer);
    });

    it('does not re-emit peer-discovered for already-known peers', () => {
      const handler = vi.fn();
      discovery.on('peer-discovered', handler);

      const peer: PeerInfo = {
        peer_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        dev_name: 'alice',
        address: '192.168.1.2',
        pub_port: 6000,
        rep_port: 6001,
      };

      discovery.handlePeerFound(peer);
      discovery.handlePeerFound(peer); // second call – should be ignored

      expect(handler).toHaveBeenCalledOnce();
    });

    it('skips self (own peer_id)', () => {
      const handler = vi.fn();
      discovery.on('peer-discovered', handler);

      const self = discovery.getSelfInfo();
      discovery.handlePeerFound(self);

      expect(handler).not.toHaveBeenCalled();
      expect(discovery.getKnownPeers()).toHaveLength(0);
    });

    it('handles multiple distinct peers', () => {
      const handler = vi.fn();
      discovery.on('peer-discovered', handler);

      const peerA: PeerInfo = {
        peer_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        dev_name: 'alice',
        address: '192.168.1.2',
        pub_port: 6000,
        rep_port: 6001,
      };
      const peerB: PeerInfo = {
        peer_id: 'bbbbbbbb-0000-4000-8000-000000000002',
        dev_name: 'bob',
        address: '192.168.1.3',
        pub_port: 7000,
        rep_port: 7001,
      };

      discovery.handlePeerFound(peerA);
      discovery.handlePeerFound(peerB);

      expect(handler).toHaveBeenCalledTimes(2);
      expect(discovery.getKnownPeers()).toHaveLength(2);
    });
  });

  describe('handlePeerLost', () => {
    it('emits peer-lost with the given peerId', () => {
      const handler = vi.fn();
      discovery.on('peer-lost', handler);

      const peerId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      discovery.handlePeerLost(peerId);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(peerId);
    });

    it('removes the peer from known peers', () => {
      const peer: PeerInfo = {
        peer_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        dev_name: 'alice',
        address: '192.168.1.2',
        pub_port: 6000,
        rep_port: 6001,
      };

      discovery.handlePeerFound(peer);
      expect(discovery.getKnownPeers()).toHaveLength(1);

      discovery.handlePeerLost(peer.peer_id);
      expect(discovery.getKnownPeers()).toHaveLength(0);
    });
  });
});
