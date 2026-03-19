import { basename } from 'node:path';
import type { PeerState, ConflictSignal } from '../types.js';

export class ConflictDetector {
  detect(peers: PeerState[]): ConflictSignal[] {
    return [
      ...this.detectZoneOverlaps(peers),
      ...this.detectInterfaceConflicts(peers),
      ...this.detectDuplications(peers),
    ];
  }

  private detectZoneOverlaps(peers: PeerState[]): ConflictSignal[] {
    const online = peers.filter((p) => p.status === 'online');
    const signals: ConflictSignal[] = [];

    for (let i = 0; i < online.length; i++) {
      for (let j = i + 1; j < online.length; j++) {
        const a = online[i];
        const b = online[j];
        if (zonesOverlap(a.work_zone, b.work_zone)) {
          signals.push({
            type: 'zone_overlap',
            severity: 'warning',
            peers: [a.peer_id, b.peer_id],
            description: `Peers ${a.dev_name} and ${b.dev_name} have overlapping work zones: '${a.work_zone}' and '${b.work_zone}'`,
            file_paths: [],
          });
        }
      }
    }

    return signals;
  }

  private detectInterfaceConflicts(peers: PeerState[]): ConflictSignal[] {
    // Build a map: export name -> list of { peer_id, file_path }
    const exportMap = new Map<string, Array<{ peer_id: string; file_path: string }>>();

    for (const peer of peers) {
      // Collect unique export names per peer (deduplicated across same peer's files)
      const seenForPeer = new Set<string>();

      for (const [filePath, fileState] of peer.files) {
        for (const exportEntry of fileState.exports) {
          if (!seenForPeer.has(exportEntry.name)) {
            seenForPeer.add(exportEntry.name);
            const existing = exportMap.get(exportEntry.name) ?? [];
            existing.push({ peer_id: peer.peer_id, file_path: filePath });
            exportMap.set(exportEntry.name, existing);
          }
        }
      }
    }

    const signals: ConflictSignal[] = [];

    for (const [exportName, entries] of exportMap) {
      // Only conflict if entries come from more than one peer
      const peerIds = [...new Set(entries.map((e) => e.peer_id))];
      if (peerIds.length < 2) continue;

      // Collect all file paths involved
      const filePaths = entries.map((e) => e.file_path);

      signals.push({
        type: 'interface_conflict',
        severity: 'critical',
        peers: peerIds,
        description: `Export '${exportName}' is defined by multiple peers: ${peerIds.join(', ')}`,
        file_paths: filePaths,
      });
    }

    return signals;
  }

  private detectDuplications(peers: PeerState[]): ConflictSignal[] {
    // Build a map: basename -> list of { peer_id, file_path }
    const basenameMap = new Map<string, Array<{ peer_id: string; file_path: string }>>();

    for (const peer of peers) {
      for (const [filePath] of peer.files) {
        const base = basename(filePath);
        const existing = basenameMap.get(base) ?? [];
        existing.push({ peer_id: peer.peer_id, file_path: filePath });
        basenameMap.set(base, existing);
      }
    }

    const signals: ConflictSignal[] = [];

    for (const [, entries] of basenameMap) {
      // Only conflict if entries come from more than one peer
      const peerIds = [...new Set(entries.map((e) => e.peer_id))];
      if (peerIds.length < 2) continue;

      const filePaths = entries.map((e) => e.file_path);

      signals.push({
        type: 'duplication',
        severity: 'warning',
        peers: peerIds,
        description: `File with the same name found across peers ${peerIds.join(', ')}: ${filePaths.join(', ')}`,
        file_paths: filePaths,
      });
    }

    return signals;
  }
}

function zonesOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  // Normalize: ensure trailing slash for prefix check
  const aNorm = a.endsWith('/') ? a : `${a}/`;
  const bNorm = b.endsWith('/') ? b : `${b}/`;
  return aNorm === bNorm || aNorm.startsWith(bNorm) || bNorm.startsWith(aNorm);
}
