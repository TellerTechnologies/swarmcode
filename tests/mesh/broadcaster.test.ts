import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MeshBroadcaster } from '../../src/mesh/broadcaster.js';
import type { SwarmUpdate } from '../../src/types.js';

function makeUpdate(peerId: string): SwarmUpdate {
  return {
    peer_id: peerId,
    dev_name: 'test-dev',
    timestamp: Date.now(),
    event_type: 'file_modified',
    file_path: '/test/file.ts',
    exports: [],
    imports: [],
    work_zone: '/test',
    intent: null,
    summary: null,
    interfaces: [],
    touches: [],
  };
}

describe('MeshBroadcaster', () => {
  describe('two nodes: A publishes, B subscribes to A', () => {
    let nodeA: MeshBroadcaster;
    let nodeB: MeshBroadcaster;

    beforeEach(async () => {
      nodeA = new MeshBroadcaster();
      nodeB = new MeshBroadcaster();
    });

    afterEach(async () => {
      await nodeA.stop();
      await nodeB.stop();
    });

    it('B receives an update published by A', async () => {
      const portA = await nodeA.start(0);
      await nodeB.start(0);
      await nodeB.subscribeTo('127.0.0.1', portA);

      // Allow ZMQ connection to establish
      await new Promise((r) => setTimeout(r, 200));

      const received: SwarmUpdate[] = [];
      nodeB.on('update', (u: SwarmUpdate) => received.push(u));

      const update = makeUpdate('peer-A');
      await nodeA.publish(update);

      // Allow message delivery
      await new Promise((r) => setTimeout(r, 300));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ peer_id: 'peer-A', event_type: 'file_modified' });
    });

    it('returns the actual bound port (non-zero) from start(0)', async () => {
      const port = await nodeA.start(0);
      expect(port).toBeGreaterThan(0);
    });

    it('does not emit update on the publisher itself', async () => {
      const portA = await nodeA.start(0);
      await nodeB.start(0);
      await nodeB.subscribeTo('127.0.0.1', portA);

      await new Promise((r) => setTimeout(r, 200));

      const publisherReceived: SwarmUpdate[] = [];
      nodeA.on('update', (u: SwarmUpdate) => publisherReceived.push(u));

      await nodeA.publish(makeUpdate('peer-A'));

      await new Promise((r) => setTimeout(r, 300));

      expect(publisherReceived).toHaveLength(0);
    });
  });

  describe('three nodes: A publishes, B and C both subscribe', () => {
    let nodeA: MeshBroadcaster;
    let nodeB: MeshBroadcaster;
    let nodeC: MeshBroadcaster;

    beforeEach(async () => {
      nodeA = new MeshBroadcaster();
      nodeB = new MeshBroadcaster();
      nodeC = new MeshBroadcaster();
    });

    afterEach(async () => {
      await nodeA.stop();
      await nodeB.stop();
      await nodeC.stop();
    });

    it('both B and C receive the update published by A', async () => {
      const portA = await nodeA.start(0);
      await nodeB.start(0);
      await nodeC.start(0);

      await nodeB.subscribeTo('127.0.0.1', portA);
      await nodeC.subscribeTo('127.0.0.1', portA);

      // Allow both ZMQ connections to establish
      await new Promise((r) => setTimeout(r, 200));

      const receivedB: SwarmUpdate[] = [];
      const receivedC: SwarmUpdate[] = [];
      nodeB.on('update', (u: SwarmUpdate) => receivedB.push(u));
      nodeC.on('update', (u: SwarmUpdate) => receivedC.push(u));

      const update = makeUpdate('peer-A-broadcast');
      await nodeA.publish(update);

      await new Promise((r) => setTimeout(r, 300));

      expect(receivedB).toHaveLength(1);
      expect(receivedB[0]).toMatchObject({ peer_id: 'peer-A-broadcast' });

      expect(receivedC).toHaveLength(1);
      expect(receivedC[0]).toMatchObject({ peer_id: 'peer-A-broadcast' });
    });

    it('multiple publishes are all received by subscribers', async () => {
      const portA = await nodeA.start(0);
      await nodeB.start(0);
      await nodeB.subscribeTo('127.0.0.1', portA);

      await new Promise((r) => setTimeout(r, 200));

      const receivedB: SwarmUpdate[] = [];
      nodeB.on('update', (u: SwarmUpdate) => receivedB.push(u));

      await nodeA.publish(makeUpdate('msg-1'));
      await nodeA.publish(makeUpdate('msg-2'));
      await nodeA.publish(makeUpdate('msg-3'));

      await new Promise((r) => setTimeout(r, 300));

      expect(receivedB).toHaveLength(3);
      const ids = receivedB.map((u) => u.peer_id);
      expect(ids).toContain('msg-1');
      expect(ids).toContain('msg-2');
      expect(ids).toContain('msg-3');
    });
  });
});
