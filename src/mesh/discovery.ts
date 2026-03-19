import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Bonjour } from 'bonjour-service';
import type { Service } from 'bonjour-service';
import type { PeerInfo } from '../types.js';

const SERVICE_TYPE = 'swarmcode';
const SERVICE_PROTOCOL = 'tcp';

export interface MeshDiscoveryOptions {
  name: string;
  pub_port: number;
  rep_port: number;
}

export class MeshDiscovery extends EventEmitter {
  private readonly selfInfo: PeerInfo;
  private readonly knownPeers: Map<string, PeerInfo> = new Map();
  private bonjour: Bonjour | null = null;

  constructor(opts: MeshDiscoveryOptions) {
    super();
    this.selfInfo = {
      peer_id: randomUUID(),
      dev_name: opts.name,
      address: '',
      pub_port: opts.pub_port,
      rep_port: opts.rep_port,
    };
  }

  getSelfInfo(): PeerInfo {
    return { ...this.selfInfo };
  }

  async start(): Promise<void> {
    this.bonjour = new Bonjour();

    // Publish our own service with peer metadata encoded in TXT records
    this.bonjour.publish({
      name: this.selfInfo.peer_id,
      type: SERVICE_TYPE,
      port: this.selfInfo.pub_port,
      protocol: SERVICE_PROTOCOL,
      txt: {
        peer_id: this.selfInfo.peer_id,
        dev_name: this.selfInfo.dev_name,
        pub_port: String(this.selfInfo.pub_port),
        rep_port: String(this.selfInfo.rep_port),
      },
    });

    // Browse for other peers advertising the same service type
    const browser = this.bonjour.find({ type: SERVICE_TYPE, protocol: SERVICE_PROTOCOL });

    browser.on('up', (service: Service) => {
      const txt = service.txt as Record<string, string> | undefined;
      if (!txt) return;

      const address = service.addresses?.[0] ?? service.referer?.address ?? '';
      const peer: PeerInfo = {
        peer_id: txt['peer_id'] ?? service.name,
        dev_name: txt['dev_name'] ?? service.name,
        address,
        pub_port: Number(txt['pub_port'] ?? service.port),
        rep_port: Number(txt['rep_port'] ?? 0),
      };

      this.handlePeerFound(peer);
    });

    browser.on('down', (service: Service) => {
      const txt = service.txt as Record<string, string> | undefined;
      const peerId = txt?.['peer_id'] ?? service.name;
      this.handlePeerLost(peerId);
    });
  }

  async stop(): Promise<void> {
    if (this.bonjour) {
      await new Promise<void>((resolve) => {
        this.bonjour!.destroy(() => resolve());
      });
      this.bonjour = null;
    }
  }

  handlePeerFound(peer: PeerInfo): void {
    // Skip self
    if (peer.peer_id === this.selfInfo.peer_id) return;

    // Skip already-known peers (by ID)
    if (this.knownPeers.has(peer.peer_id)) return;

    // Skip if we already know a peer at this address (prevents duplicates
    // when both mDNS and manual --peer discover the same machine)
    for (const known of this.knownPeers.values()) {
      if (known.address === peer.address && known.address !== '') return;
    }

    this.knownPeers.set(peer.peer_id, peer);
    this.emit('peer-discovered', peer);
  }

  handlePeerLost(peerId: string): void {
    this.knownPeers.delete(peerId);
    this.emit('peer-lost', peerId);
  }

  getKnownPeers(): PeerInfo[] {
    return Array.from(this.knownPeers.values());
  }
}
