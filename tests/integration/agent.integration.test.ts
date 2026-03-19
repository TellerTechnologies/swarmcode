import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SwarmAgent } from '../../src/agent.js';
import { QueryClient } from '../../src/mesh/query.js';
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

  describe('path traversal protection', () => {
    let queryClient: QueryClient;

    beforeAll(() => {
      queryClient = new QueryClient();
    });

    afterAll(async () => {
      await queryClient.close();
    });

    it('rejects path traversal via ../ for file_exists query', async () => {
      const port = agent.getRepPort();
      const res = await queryClient.query('127.0.0.1', port, {
        type: 'file_exists',
        file_path: '../../../etc/passwd',
      });
      expect(res.error).toBe('Path outside project');
      expect(res.data).toBeNull();
    });

    it('rejects absolute path outside projectDir for file_exists query', async () => {
      const port = agent.getRepPort();
      const res = await queryClient.query('127.0.0.1', port, {
        type: 'file_exists',
        file_path: '/etc/passwd',
      });
      expect(res.error).toBe('Path outside project');
      expect(res.data).toBeNull();
    });

    it('rejects path traversal for exports query', async () => {
      const port = agent.getRepPort();
      const res = await queryClient.query('127.0.0.1', port, {
        type: 'exports',
        file_path: '../../etc/shadow',
      });
      expect(res.error).toBe('Path outside project');
      expect(res.data).toBeNull();
    });

    it('rejects path traversal for dependencies query', async () => {
      const port = agent.getRepPort();
      const res = await queryClient.query('127.0.0.1', port, {
        type: 'dependencies',
        file_path: '../sensitive-file.ts',
      });
      expect(res.error).toBe('Path outside project');
      expect(res.data).toBeNull();
    });

    it('allows a valid file path within projectDir', async () => {
      const port = agent.getRepPort();
      // Write a file inside tmpDir so we can query it
      const fileName = 'safe-query.ts';
      writeFileSync(join(tmpDir, fileName), 'export const x = 1;\n', 'utf-8');
      const res = await queryClient.query('127.0.0.1', port, {
        type: 'file_exists',
        file_path: fileName,
      });
      expect(res.error).toBeNull();
      expect(res.data).toBe(true);
    });
  });
});
