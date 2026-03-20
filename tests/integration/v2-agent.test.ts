import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('v2 agent integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-v2-'));
    const peersDir = join(tmpDir, '.swarmcode', 'peers');
    mkdirSync(peersDir, { recursive: true });
    writeFileSync(join(peersDir, 'laptop.json'), JSON.stringify({
      name: 'laptop',
      updated_at: Date.now(),
      work_zone: 'src/lib',
      intent: null,
      files: {
        'src/lib/types.ts': {
          exports: [{ name: 'Task', signature: 'export interface Task' }],
          imports: [],
          last_modified: Date.now(),
        },
        'src/lib/db.ts': {
          exports: [
            { name: 'getAllTasks', signature: 'export function getAllTasks()' },
            { name: 'createTask', signature: 'export function createTask(title: string)' },
          ],
          imports: ['better-sqlite3', './types'],
          last_modified: Date.now(),
        },
      },
    }));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads peer manifests and generates correct context', async () => {
    const { ManifestReader } = await import('../../src/manifest/reader.js');
    const { formatTeamContext } = await import('../../src/injector/formatter.js');
    const { ConflictDetector } = await import('../../src/conflict/detector.js');

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();

    expect(peers).toHaveLength(1);
    expect(peers[0].dev_name).toBe('laptop');
    expect(peers[0].files.get('src/lib/types.ts')?.exports[0].name).toBe('Task');

    const detector = new ConflictDetector();
    const conflicts = detector.detect(peers);
    const context = formatTeamContext(peers, conflicts);

    expect(context).toContain('laptop');
    expect(context).toContain('Task');
    expect(context).toContain('getAllTasks');
    expect(context).toContain('import from here, do not rebuild');
  });

  it('manifest writer output can be read by manifest reader', async () => {
    const { ManifestWriter } = await import('../../src/manifest/writer.js');
    const { ManifestReader } = await import('../../src/manifest/reader.js');

    const writer = new ManifestWriter(tmpDir, 'Sarah');
    await writer.write({
      name: 'Sarah',
      updated_at: Date.now(),
      work_zone: 'src/components',
      intent: 'Building dashboard',
      files: {
        'src/components/Dashboard.tsx': {
          exports: [{ name: 'Dashboard', signature: 'export function Dashboard()' }],
          imports: ['react'],
          last_modified: Date.now(),
        },
      },
    });

    const reader = new ManifestReader(tmpDir, 'Jared');
    const peers = reader.readPeers();

    // Should see both laptop (from beforeEach) and Sarah
    expect(peers).toHaveLength(2);
    const sarah = peers.find(p => p.dev_name === 'Sarah');
    expect(sarah).toBeDefined();
    expect(sarah!.intent).toBe('Building dashboard');
    expect(sarah!.files.get('src/components/Dashboard.tsx')).toBeDefined();
  });
});
