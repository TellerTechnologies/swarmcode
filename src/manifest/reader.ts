import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { ManifestData, PeerState, FileState } from '../types.js';

const OFFLINE_THRESHOLD_MS = 90_000;

export class ManifestReader {
  private readonly peersDir: string;
  private readonly selfName: string;

  constructor(projectDir: string, selfName: string) {
    this.peersDir = join(projectDir, '.swarmcode', 'peers');
    this.selfName = selfName;
  }

  readPeers(): PeerState[] {
    if (!existsSync(this.peersDir)) return [];

    const files = readdirSync(this.peersDir).filter(f => f.endsWith('.json'));
    const peers: PeerState[] = [];

    for (const file of files) {
      const name = basename(file, '.json');
      if (name === this.selfName) continue;

      try {
        const raw = readFileSync(join(this.peersDir, file), 'utf-8');
        const data: ManifestData = JSON.parse(raw);

        const fileMap = new Map<string, FileState>();
        for (const [path, state] of Object.entries(data.files)) {
          fileMap.set(path, state);
        }

        const isOnline = Date.now() - data.updated_at < OFFLINE_THRESHOLD_MS;

        peers.push({
          peer_id: name,
          dev_name: data.name,
          status: isOnline ? 'online' : 'offline',
          last_seen: data.updated_at,
          address: '',
          pub_port: 0,
          rep_port: 0,
          files: fileMap,
          work_zone: data.work_zone,
          intent: data.intent,
        });
      } catch {
        // Skip malformed files
      }
    }

    return peers;
  }
}
