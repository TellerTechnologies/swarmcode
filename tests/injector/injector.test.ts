import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ContextInjector } from '../../src/injector/injector.js';

const START_MARKER = '<!-- SWARMCODE START -->';
const END_MARKER = '<!-- SWARMCODE END -->';

describe('ContextInjector', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-injector-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the context file if it does not exist', async () => {
    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    const filePath = join(tmpDir, 'CLAUDE.md');

    expect(existsSync(filePath)).toBe(false);
    const wrote = await injector.inject('## Team Context\nHello');
    expect(wrote).toBe(true);
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain(START_MARKER);
    expect(content).toContain('## Team Context\nHello');
    expect(content).toContain(END_MARKER);
  });

  it('preserves existing content outside markers', async () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '# My Project\n\nSome existing docs.\n', 'utf-8');

    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    await injector.inject('Injected content');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('# My Project');
    expect(content).toContain('Some existing docs.');
    expect(content).toContain(START_MARKER);
    expect(content).toContain('Injected content');
    expect(content).toContain(END_MARKER);
  });

  it('replaces existing swarmcode block on subsequent injects', async () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '# My Project\n', 'utf-8');

    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    await injector.inject('First content');
    await injector.inject('Second content');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('First content');
    expect(content).toContain('Second content');
    // Only one start/end marker pair
    expect(content.split(START_MARKER).length).toBe(2);
    expect(content.split(END_MARKER).length).toBe(2);
  });

  it('returns false and skips write when content is unchanged', async () => {
    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    const wrote1 = await injector.inject('Same content');
    expect(wrote1).toBe(true);

    const filePath = join(tmpDir, 'CLAUDE.md');
    const mtimeBefore = readFileSync(filePath, 'utf-8');

    const wrote2 = await injector.inject('Same content');
    expect(wrote2).toBe(false);

    // File content should be identical
    const mtimeAfter = readFileSync(filePath, 'utf-8');
    expect(mtimeBefore).toBe(mtimeAfter);
  });

  it('returns true after content changes', async () => {
    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    await injector.inject('Old content');

    const wrote = await injector.inject('New content');
    expect(wrote).toBe(true);
  });

  it('creates nested directories if context file path contains subdirs', async () => {
    const injector = new ContextInjector(tmpDir, 'nested/deep/.cursorrules');
    const filePath = join(tmpDir, 'nested/deep/.cursorrules');

    expect(existsSync(filePath)).toBe(false);
    await injector.inject('nested content');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('nested content');
  });

  it('clear removes the swarmcode section', async () => {
    const filePath = join(tmpDir, 'CLAUDE.md');
    writeFileSync(filePath, '# My Project\n\nExisting content.\n', 'utf-8');

    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    await injector.inject('Team context here');
    await injector.clear();

    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain(START_MARKER);
    expect(content).not.toContain(END_MARKER);
    expect(content).not.toContain('Team context here');
    expect(content).toContain('# My Project');
    expect(content).toContain('Existing content.');
  });

  it('clear on non-existent file does not throw', async () => {
    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    await expect(injector.clear()).resolves.not.toThrow();
  });

  it('clear resets lastContent so next inject writes again', async () => {
    const injector = new ContextInjector(tmpDir, 'CLAUDE.md');
    await injector.inject('Content');
    expect(await injector.inject('Content')).toBe(false); // unchanged, skip

    await injector.clear();
    expect(await injector.inject('Content')).toBe(true); // after clear, should write
  });
});
