import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ManifestWriter } from '../../src/manifest/writer.js';

describe('ManifestWriter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-manifest-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the peers directory and writes manifest JSON', async () => {
    const writer = new ManifestWriter(tmpDir, 'Jared');
    await writer.write({
      name: 'Jared',
      updated_at: 1000,
      work_zone: 'src/app',
      intent: null,
      files: {
        'src/app/page.tsx': {
          exports: [{ name: 'Home', signature: 'export default function Home' }],
          imports: ['react'],
          last_modified: 1000,
        },
      },
    });

    const filePath = join(tmpDir, '.swarmcode', 'peers', 'Jared.json');
    expect(existsSync(filePath)).toBe(true);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.name).toBe('Jared');
    expect(data.files['src/app/page.tsx'].exports[0].name).toBe('Home');
  });

  it('overwrites existing manifest', async () => {
    const writer = new ManifestWriter(tmpDir, 'Jared');
    await writer.write({ name: 'Jared', updated_at: 1000, work_zone: '', intent: null, files: {} });
    await writer.write({ name: 'Jared', updated_at: 2000, work_zone: 'src', intent: null, files: {} });

    const filePath = join(tmpDir, '.swarmcode', 'peers', 'Jared.json');
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(data.updated_at).toBe(2000);
  });
});
