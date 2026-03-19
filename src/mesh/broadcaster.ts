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
    await this.pub.bind(`tcp://0.0.0.0:${port}`);
    this.running = true;

    // Extract port from lastEndpoint e.g. "tcp://0.0.0.0:12345"
    const endpoint = this.pub.lastEndpoint as string;
    const boundPort = parseInt(endpoint.split(':').pop() ?? String(port), 10);
    return boundPort;
  }

  async subscribeTo(address: string, port: number): Promise<void> {
    const sub = new zmq.Subscriber();
    sub.connect(`tcp://${address}:${port}`);
    sub.subscribe(TOPIC);
    this.subs.push(sub);

    // Start receive loop in background
    this.receiveLoop(sub);
  }

  private async receiveLoop(sub: zmq.Subscriber): Promise<void> {
    // Note: No backpressure applied here — messages are processed as they arrive.
    // This is a known v1 limitation; it works fine for 3-15 peers. A microbatch
    // approach (buffering every 50ms) could be added if throughput becomes an issue.
    try {
      for await (const [topicBuf, msgBuf] of sub) {
        if (!this.running) break;
        try {
          const update: SwarmUpdate = JSON.parse(msgBuf.toString());
          this.emit('update', update);
        } catch {
          // Ignore malformed messages
        }
      }
    } catch {
      // Socket was closed — exit loop silently
    }
  }

  async publish(update: SwarmUpdate): Promise<void> {
    if (!this.pub) throw new Error('MeshBroadcaster not started');
    await this.pub.send([TOPIC, JSON.stringify(update)]);
  }

  async stop(): Promise<void> {
    this.running = false;

    // Close all subscriber sockets first to break receive loops
    for (const sub of this.subs) {
      sub.close();
    }
    this.subs = [];

    if (this.pub) {
      this.pub.close();
      this.pub = null;
    }
  }
}
