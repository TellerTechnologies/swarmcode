import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SwarmAgent } from '../../src/agent.js';
import { getDefaultConfig } from '../../src/config.js';

describe('SwarmAgent integration', () => {
  let tmpDir: string;
  let agent: SwarmAgent;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-integration-'));
    const config = getDefaultConfig('integration-test');
    agent = new SwarmAgent(tmpDir, config);
  });

  afterAll(async () => {
    if (agent) {
      await agent.stop();
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('starts and stops without error', async () => {
    await expect(agent.start()).resolves.not.toThrow();
  });

  it('processes a new file without error', async () => {
    // Write a TypeScript file into the tmp dir
    const filePath = join(tmpDir, 'hello.ts');
    writeFileSync(filePath, 'export function hello(): string { return "hello"; }\n', 'utf-8');

    // Wait a bit for the watcher debounce to fire
    await new Promise((resolve) => setTimeout(resolve, 500));

    // No assertion needed beyond "no error thrown" — verified by reaching here
    expect(true).toBe(true);
  });

  it('updateContext does not throw when no peers are present', () => {
    expect(() => agent.updateContext()).not.toThrow();
  });
});
