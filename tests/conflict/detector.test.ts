import { describe, it, expect } from 'vitest';
import { ConflictDetector } from '../../src/conflict/detector.js';
import type { PeerState, FileState } from '../../src/types.js';

function makePeer(
  peer_id: string,
  work_zone: string,
  files: Record<string, { exports?: string[]; imports?: string[] }> = {},
  status: 'online' | 'offline' = 'online',
): PeerState {
  const fileMap = new Map<string, FileState>();
  for (const [path, { exports = [], imports = [] }] of Object.entries(files)) {
    fileMap.set(path, {
      exports: exports.map((name) => ({ name, signature: `${name}(): void` })),
      imports,
      last_modified: Date.now(),
    });
  }
  return {
    peer_id,
    dev_name: peer_id,
    status,
    last_seen: Date.now(),
    address: '127.0.0.1',
    pub_port: 5555,
    rep_port: 5556,
    files: fileMap,
    work_zone,
    intent: null,
  };
}

describe('ConflictDetector', () => {
  describe('zone overlap detection', () => {
    it('detects two online peers with the same work zone', () => {
      const peers = [
        makePeer('peer-a', 'src/auth'),
        makePeer('peer-b', 'src/auth'),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const zoneConflicts = signals.filter((s) => s.type === 'zone_overlap');
      expect(zoneConflicts).toHaveLength(1);
      expect(zoneConflicts[0].peers).toContain('peer-a');
      expect(zoneConflicts[0].peers).toContain('peer-b');
      expect(zoneConflicts[0].severity).toBe('warning');
    });

    it('detects a parent/child zone overlap (one zone is prefix of the other)', () => {
      const peers = [
        makePeer('peer-a', 'src/auth'),
        makePeer('peer-b', 'src/auth/middleware'),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const zoneConflicts = signals.filter((s) => s.type === 'zone_overlap');
      expect(zoneConflicts).toHaveLength(1);
      expect(zoneConflicts[0].peers).toContain('peer-a');
      expect(zoneConflicts[0].peers).toContain('peer-b');
    });

    it('does not flag peers with completely different zones', () => {
      const peers = [
        makePeer('peer-a', 'src/auth'),
        makePeer('peer-b', 'src/payments'),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const zoneConflicts = signals.filter((s) => s.type === 'zone_overlap');
      expect(zoneConflicts).toHaveLength(0);
    });

    it('does not flag offline peers for zone overlap', () => {
      const peers = [
        makePeer('peer-a', 'src/auth', {}, 'online'),
        makePeer('peer-b', 'src/auth', {}, 'offline'),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const zoneConflicts = signals.filter((s) => s.type === 'zone_overlap');
      expect(zoneConflicts).toHaveLength(0);
    });

    it('does not flag a single online peer', () => {
      const peers = [makePeer('peer-a', 'src/auth')];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const zoneConflicts = signals.filter((s) => s.type === 'zone_overlap');
      expect(zoneConflicts).toHaveLength(0);
    });
  });

  describe('interface conflict detection', () => {
    it('detects two different peers exporting the same name', () => {
      const peers = [
        makePeer('peer-a', 'src/auth', { 'src/auth/types.ts': { exports: ['UserAuth'] } }),
        makePeer('peer-b', 'src/api', { 'src/api/types.ts': { exports: ['UserAuth'] } }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const ifaceConflicts = signals.filter((s) => s.type === 'interface_conflict');
      expect(ifaceConflicts).toHaveLength(1);
      expect(ifaceConflicts[0].peers).toContain('peer-a');
      expect(ifaceConflicts[0].peers).toContain('peer-b');
      expect(ifaceConflicts[0].severity).toBe('critical');
      expect(ifaceConflicts[0].description).toContain('UserAuth');
    });

    it('does not flag duplicate export names within the same peer', () => {
      const peers = [
        makePeer('peer-a', 'src/auth', {
          'src/auth/login.ts': { exports: ['UserAuth'] },
          'src/auth/logout.ts': { exports: ['UserAuth'] },
        }),
        makePeer('peer-b', 'src/payments', { 'src/payments/utils.ts': { exports: ['formatAmount'] } }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const ifaceConflicts = signals.filter((s) => s.type === 'interface_conflict');
      expect(ifaceConflicts).toHaveLength(0);
    });

    it('reports each conflicting export name once', () => {
      const peers = [
        makePeer('peer-a', 'src/a', { 'src/a/index.ts': { exports: ['Foo', 'Bar'] } }),
        makePeer('peer-b', 'src/b', { 'src/b/index.ts': { exports: ['Foo', 'Bar'] } }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const ifaceConflicts = signals.filter((s) => s.type === 'interface_conflict');
      expect(ifaceConflicts).toHaveLength(2);
    });

    it('includes both conflicting file paths in the signal', () => {
      const peers = [
        makePeer('peer-a', 'src/a', { 'src/a/utils.ts': { exports: ['helperFn'] } }),
        makePeer('peer-b', 'src/b', { 'src/b/helpers.ts': { exports: ['helperFn'] } }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const ifaceConflicts = signals.filter((s) => s.type === 'interface_conflict');
      expect(ifaceConflicts[0].file_paths).toContain('src/a/utils.ts');
      expect(ifaceConflicts[0].file_paths).toContain('src/b/helpers.ts');
    });
  });

  describe('duplication detection', () => {
    it('detects two peers with files sharing the same basename', () => {
      const peers = [
        makePeer('peer-a', 'src/utils', { 'src/utils/auth-helpers.ts': {} }),
        makePeer('peer-b', 'src/lib', { 'src/lib/auth-helpers.ts': {} }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const dupConflicts = signals.filter((s) => s.type === 'duplication');
      expect(dupConflicts).toHaveLength(1);
      expect(dupConflicts[0].peers).toContain('peer-a');
      expect(dupConflicts[0].peers).toContain('peer-b');
      expect(dupConflicts[0].file_paths).toContain('src/utils/auth-helpers.ts');
      expect(dupConflicts[0].file_paths).toContain('src/lib/auth-helpers.ts');
    });

    it('does not flag files with different basenames', () => {
      const peers = [
        makePeer('peer-a', 'src/utils', { 'src/utils/auth.ts': {} }),
        makePeer('peer-b', 'src/lib', { 'src/lib/session.ts': {} }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const dupConflicts = signals.filter((s) => s.type === 'duplication');
      expect(dupConflicts).toHaveLength(0);
    });

    it('does not flag the same basename across files within the same peer', () => {
      const peers = [
        makePeer('peer-a', 'src', {
          'src/utils/helper.ts': {},
          'src/lib/helper.ts': {},
        }),
        makePeer('peer-b', 'tests', { 'tests/setup.ts': {} }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const dupConflicts = signals.filter((s) => s.type === 'duplication');
      expect(dupConflicts).toHaveLength(0);
    });

    it('includes severity of warning for duplication', () => {
      const peers = [
        makePeer('peer-a', 'src/a', { 'src/a/utils.ts': {} }),
        makePeer('peer-b', 'src/b', { 'src/b/utils.ts': {} }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const dupConflicts = signals.filter((s) => s.type === 'duplication');
      expect(dupConflicts[0].severity).toBe('warning');
    });
  });

  describe('combined detection', () => {
    it('returns an empty array when there are no peers', () => {
      const detector = new ConflictDetector();
      const signals = detector.detect([]);
      expect(signals).toEqual([]);
    });

    it('returns all conflict types together', () => {
      const peers = [
        makePeer('peer-a', 'src/auth', {
          'src/utils/shared.ts': { exports: ['SharedUtil'] },
          'src/auth/helper.ts': {},
        }),
        makePeer('peer-b', 'src/auth', {
          'src/lib/shared.ts': { exports: ['SharedUtil'] },
          'src/api/helper.ts': {},
        }),
      ];
      const detector = new ConflictDetector();
      const signals = detector.detect(peers);
      const types = signals.map((s) => s.type);
      expect(types).toContain('zone_overlap');
      expect(types).toContain('interface_conflict');
      expect(types).toContain('duplication');
    });
  });
});
