import type { PeerInfo, PeerState, SwarmUpdate, FileState } from '../types.js';

export class TeamState {
  private readonly selfId: string;
  private readonly peers: Map<string, PeerState> = new Map();

  constructor(selfId: string) {
    this.selfId = selfId;
  }

  addPeer(info: PeerInfo): void {
    if (info.peer_id === this.selfId) return;

    const existing = this.peers.get(info.peer_id);
    if (existing) {
      // Update connection info, preserve file state and other runtime fields
      existing.dev_name = info.dev_name;
      existing.address = info.address;
      existing.pub_port = info.pub_port;
      existing.rep_port = info.rep_port;
    } else {
      this.peers.set(info.peer_id, {
        peer_id: info.peer_id,
        dev_name: info.dev_name,
        status: 'online',
        last_seen: Date.now(),
        address: info.address,
        pub_port: info.pub_port,
        rep_port: info.rep_port,
        files: new Map(),
        work_zone: '',
        intent: null,
      });
    }
  }

  removePeer(peerId: string): void {
    this.peers.delete(peerId);
  }

  getPeer(peerId: string): PeerState | undefined {
    return this.peers.get(peerId);
  }

  getAllPeers(): PeerState[] {
    return Array.from(this.peers.values());
  }

  getOnlinePeers(): PeerState[] {
    return this.getAllPeers().filter((p) => p.status === 'online');
  }

  applyUpdate(update: SwarmUpdate): void {
    const peer = this.peers.get(update.peer_id);
    if (!peer) return;

    peer.work_zone = update.work_zone;
    peer.intent = update.intent;

    if (update.event_type === 'file_deleted') {
      peer.files.delete(update.file_path);
    } else {
      const fileState: FileState = {
        exports: update.exports,
        imports: update.imports,
        last_modified: update.timestamp,
      };
      peer.files.set(update.file_path, fileState);
    }
  }

  markOffline(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.status = 'offline';
  }

  heartbeat(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.last_seen = Date.now();
    peer.status = 'online';
  }

  getSnapshot(): PeerState[] {
    return this.getAllPeers().map((peer) => ({
      ...peer,
      files: new Map(
        Array.from(peer.files.entries()).map(([path, fs]) => [path, { ...fs, exports: [...fs.exports] }])
      ),
    }));
  }
}
