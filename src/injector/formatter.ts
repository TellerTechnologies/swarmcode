import type { PeerState, ConflictSignal } from '../types.js';

function timeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function formatTeamContext(peers: PeerState[], conflicts?: ConflictSignal[], analysis?: string): string {
  const lines: string[] = [];

  lines.push('## Swarmcode Team Context');
  lines.push('');
  lines.push('> Do not rebuild existing work. Import from teammates where possible.');

  if (conflicts && conflicts.length > 0) {
    lines.push('');
    lines.push('### Active Warnings');
    for (const conflict of conflicts) {
      lines.push('');
      lines.push(`WARNING: ${conflict.description}`);
      if (conflict.file_paths.length > 0) {
        lines.push(`Affected files: ${conflict.file_paths.join(', ')}`);
      }
      lines.push(`Peers involved: ${conflict.peers.join(', ')}`);
    }
  }

  for (const peer of peers) {
    lines.push('');
    lines.push(`### ${peer.dev_name}`);
    lines.push('');

    const statusStr = peer.status === 'online'
      ? `online (last seen ${timeSince(peer.last_seen)})`
      : `offline (last seen ${timeSince(peer.last_seen)})`;
    lines.push(`**Status:** ${statusStr}`);

    if (peer.work_zone) {
      lines.push(`**Work zone:** \`${peer.work_zone}\` — DO NOT create files here; import from here, do not rebuild.`);
    }

    if (peer.intent) {
      lines.push(`**Intent:** ${peer.intent}`);
    }

    if (peer.files.size > 0) {
      lines.push('');
      lines.push('**Files:**');
      for (const [filePath, fileState] of peer.files) {
        lines.push('');
        lines.push(`- \`${filePath}\``);
        if (fileState.exports.length > 0) {
          lines.push('  Exports (import from here, do not rebuild):');
          for (const exp of fileState.exports) {
            lines.push(`  - \`${exp.name}\`: \`${exp.signature}\``);
          }
        }
      }
    }
  }

  if (analysis) {
    lines.push('');
    lines.push('### Team Analysis');
    lines.push('');
    lines.push(analysis);
  }

  lines.push('');

  return lines.join('\n');
}
