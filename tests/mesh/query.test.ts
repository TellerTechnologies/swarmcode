import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryServer, QueryClient } from '../../src/mesh/query.js';
import type { QueryRequest, QueryResponse, ExportEntry } from '../../src/types.js';

describe('QueryServer / QueryClient', () => {
  let server: QueryServer;
  let client: QueryClient;

  afterEach(async () => {
    await client?.close();
    await server?.stop();
  });

  describe('export query', () => {
    it('server handles request for file exports; client receives correct data', async () => {
      const exports: ExportEntry[] = [
        { name: 'foo', signature: 'function foo(): void' },
        { name: 'bar', signature: 'const bar: number' },
      ];

      server = new QueryServer(async (req: QueryRequest): Promise<QueryResponse> => {
        return {
          type: req.type,
          file_path: req.file_path,
          data: exports,
          error: null,
        };
      });

      const port = await server.start(0);
      client = new QueryClient();

      const req: QueryRequest = { type: 'exports', file_path: 'src/foo.ts' };
      const res = await client.query('127.0.0.1', port, req);

      expect(res.type).toBe('exports');
      expect(res.file_path).toBe('src/foo.ts');
      expect(res.error).toBeNull();
      expect(res.data).toEqual(exports);
    });
  });

  describe('file_exists query', () => {
    it('server responds true when file path matches', async () => {
      server = new QueryServer(async (req: QueryRequest): Promise<QueryResponse> => {
        const exists = req.file_path === 'src/existing.ts';
        return { type: req.type, file_path: req.file_path, data: exists, error: null };
      });

      const port = await server.start(0);
      client = new QueryClient();

      const req: QueryRequest = { type: 'file_exists', file_path: 'src/existing.ts' };
      const res = await client.query('127.0.0.1', port, req);

      expect(res.type).toBe('file_exists');
      expect(res.data).toBe(true);
      expect(res.error).toBeNull();
    });

    it('server responds false when file path does not match', async () => {
      server = new QueryServer(async (req: QueryRequest): Promise<QueryResponse> => {
        const exists = req.file_path === 'src/existing.ts';
        return { type: req.type, file_path: req.file_path, data: exists, error: null };
      });

      const port = await server.start(0);
      client = new QueryClient();

      const req: QueryRequest = { type: 'file_exists', file_path: 'src/missing.ts' };
      const res = await client.query('127.0.0.1', port, req);

      expect(res.type).toBe('file_exists');
      expect(res.data).toBe(false);
      expect(res.error).toBeNull();
    });
  });

  describe('error handling', () => {
    it('when server handler throws, client receives error response', async () => {
      server = new QueryServer(async (_req: QueryRequest): Promise<QueryResponse> => {
        throw new Error('handler exploded');
      });

      const port = await server.start(0);
      client = new QueryClient();

      const req: QueryRequest = { type: 'exports', file_path: 'src/bad.ts' };
      const res = await client.query('127.0.0.1', port, req);

      expect(res.type).toBe('exports');
      expect(res.file_path).toBe('src/bad.ts');
      expect(res.data).toBeNull();
      expect(res.error).toBe('handler exploded');
    });
  });

  describe('multiple queries', () => {
    it('client can send multiple sequential queries reusing the same socket', async () => {
      let callCount = 0;
      server = new QueryServer(async (req: QueryRequest): Promise<QueryResponse> => {
        callCount++;
        return { type: req.type, file_path: req.file_path, data: callCount, error: null };
      });

      const port = await server.start(0);
      client = new QueryClient();

      const r1 = await client.query('127.0.0.1', port, { type: 'exports', file_path: 'a.ts' });
      const r2 = await client.query('127.0.0.1', port, { type: 'exports', file_path: 'b.ts' });

      expect(r1.data).toBe(1);
      expect(r2.data).toBe(2);
    });
  });
});
