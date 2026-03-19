import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileWatcher } from '../src/watcher.js';
import type { WatcherEvent } from '../src/watcher.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('FileWatcher', () => {
  let tmpDir: string;
  let watcher: FileWatcher;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-watcher-test-'));
  });

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits file_created when a new file is added', async () => {
    const events: WatcherEvent[] = [];
    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    watcher.on('change', (event: WatcherEvent) => events.push(event));

    await watcher.start();
    await sleep(200); // let chokidar settle

    const filePath = join(tmpDir, 'newfile.ts');
    writeFileSync(filePath, 'export const x = 1;');

    await sleep(600); // wait for debounced event

    const created = events.find((e) => e.type === 'file_created' && e.path === 'newfile.ts');
    expect(created).toBeDefined();
    expect(created?.absolutePath).toBe(filePath);
  }, 10000);

  it('emits file_modified when an existing file changes', async () => {
    const filePath = join(tmpDir, 'existing.ts');
    writeFileSync(filePath, 'export const x = 1;');

    const events: WatcherEvent[] = [];
    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    watcher.on('change', (event: WatcherEvent) => events.push(event));

    await watcher.start();
    await sleep(200); // let chokidar settle and index existing files

    writeFileSync(filePath, 'export const x = 2;');

    await sleep(600); // wait for debounced event

    const modified = events.find((e) => e.type === 'file_modified' && e.path === 'existing.ts');
    expect(modified).toBeDefined();
    expect(modified?.absolutePath).toBe(filePath);
  }, 10000);

  it('emits file_deleted when a file is removed', async () => {
    const filePath = join(tmpDir, 'todelete.ts');
    writeFileSync(filePath, 'export const y = 42;');

    const events: WatcherEvent[] = [];
    watcher = new FileWatcher(tmpDir, { debounceMs: 50 });
    watcher.on('change', (event: WatcherEvent) => events.push(event));

    await watcher.start();
    await sleep(200); // let chokidar settle and index existing files

    unlinkSync(filePath);

    await sleep(600); // wait for debounced event

    const deleted = events.find((e) => e.type === 'file_deleted' && e.path === 'todelete.ts');
    expect(deleted).toBeDefined();
    expect(deleted?.absolutePath).toBe(filePath);
  }, 10000);

  it('ignores files matching ignore patterns', async () => {
    const events: WatcherEvent[] = [];
    watcher = new FileWatcher(tmpDir, {
      debounceMs: 50,
      ignore: ['node_modules', '*.log'],
    });
    watcher.on('change', (event: WatcherEvent) => events.push(event));

    await watcher.start();
    await sleep(200);

    writeFileSync(join(tmpDir, 'debug.log'), 'some log output');
    writeFileSync(join(tmpDir, 'real.ts'), 'export const z = 3;');

    await sleep(600);

    const logEvent = events.find((e) => e.path === 'debug.log');
    expect(logEvent).toBeUndefined();

    const tsEvent = events.find((e) => e.path === 'real.ts');
    expect(tsEvent).toBeDefined();
  }, 10000);

  it('debounces rapid changes and emits ≤2 events for 3 rapid writes', async () => {
    const filePath = join(tmpDir, 'rapidfile.ts');
    writeFileSync(filePath, 'v0');

    const events: WatcherEvent[] = [];
    watcher = new FileWatcher(tmpDir, { debounceMs: 200 });
    watcher.on('change', (event: WatcherEvent) => events.push(event));

    await watcher.start();
    await sleep(200); // let chokidar settle

    // 3 rapid writes within 100ms
    writeFileSync(filePath, 'v1');
    await sleep(30);
    writeFileSync(filePath, 'v2');
    await sleep(30);
    writeFileSync(filePath, 'v3');

    await sleep(800); // wait for debounced events to fire

    const fileEvents = events.filter((e) => e.path === 'rapidfile.ts');
    expect(fileEvents.length).toBeLessThanOrEqual(2);
    expect(fileEvents.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});
