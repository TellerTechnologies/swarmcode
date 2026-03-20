import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ManifestReader } from '../../src/manifest/reader.js';

describe('ManifestReader', () => {
  let tmpDir: string;
  let peersDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-manifest-'));
    peersDir = join(tmpDir, '.swarmcode', 'peers');
    mkdirSync(peersDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads all peer manifests except self', () => {
    writeFileSync(join(peersDir, 'Jared.json'), JSON.stringify({ name: 'Jared', updated_at: 1000, work_zone: '', intent: null, files: {} }));
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: 2000, work_zone: 'src/lib', intent: null, files: { 'src/lib/db.ts': { exports: [], imports: [], last_modified: 2000 } } }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].dev_name).toBe('laptop');
    expect(peers[0].files.size).toBe(1);
  });

  it('returns empty array when no peers directory', () => {
    const reader = new ManifestReader(join(tmpDir, 'nonexistent'), 'Jared');
    const peers = reader.readPeers();
    expect(peers).toEqual([]);
  });

  it('marks peers as offline if manifest is older than threshold', () => {
    const oldTimestamp = Date.now() - 120_000;
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: oldTimestamp, work_zone: '', intent: null, files: {} }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers[0].status).toBe('offline');
  });

  it('marks peers as online if manifest is recent', () => {
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: Date.now(), work_zone: '', intent: null, files: {} }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers[0].status).toBe('online');
  });

  it('skips malformed JSON files', () => {
    writeFileSync(join(peersDir, 'bad.json'), 'not json');
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({ name: 'laptop', updated_at: Date.now(), work_zone: '', intent: null, files: {} }));

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();
    expect(peers).toHaveLength(1);
  });
});
