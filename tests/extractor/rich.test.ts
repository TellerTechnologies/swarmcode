import { describe, it, expect, vi } from 'vitest';
import { RichExtractor } from '../../src/extractor/rich.js';
import type { LLMProvider } from '../../src/llm/provider.js';
import type { SwarmUpdate } from '../../src/types.js';

function makeUpdate(overrides: Partial<SwarmUpdate> = {}): SwarmUpdate {
  return {
    peer_id: 'peer-1',
    dev_name: 'alice',
    timestamp: Date.now(),
    event_type: 'file_modified',
    file_path: 'src/api.ts',
    exports: [{ name: 'fetchUser', signature: 'export function fetchUser(id: string)' }],
    imports: ['../types.js'],
    work_zone: 'api',
    intent: null,
    summary: null,
    interfaces: [],
    touches: [],
    ...overrides,
  };
}

function makeMockProvider(summarizeReturn: string | null, analyzeReturn: string | null): LLMProvider {
  return {
    summarize: vi.fn().mockResolvedValue(summarizeReturn),
    analyze: vi.fn().mockResolvedValue(analyzeReturn),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// enrichBatch
// ──────────────────────────────────────────────────────────────────────────────

describe('RichExtractor.enrichBatch', () => {
  it('calls provider.summarize with tier2 and returns intent + summary', async () => {
    const provider = makeMockProvider('alice is adding a fetchUser API', null);
    const extractor = new RichExtractor(provider);
    const updates = [makeUpdate()];

    const result = await extractor.enrichBatch(updates);

    expect(provider.summarize).toHaveBeenCalledOnce();
    expect(provider.summarize).toHaveBeenCalledWith(expect.stringContaining('src/api.ts'), 'tier2');
    expect(result.intent).toBe('alice is adding a fetchUser API');
    expect(result.summary).toBe('alice is adding a fetchUser API');
  });

  it('includes file path, dev name, work zone, exports and imports in description', async () => {
    const provider = makeMockProvider('summary text', null);
    const extractor = new RichExtractor(provider);

    const update = makeUpdate({
      file_path: 'src/auth/login.ts',
      dev_name: 'bob',
      work_zone: 'auth',
      exports: [{ name: 'loginUser', signature: 'export function loginUser()' }],
      imports: ['./session.js', '../types.js'],
    });

    await extractor.enrichBatch([update]);

    const [descArg] = (provider.summarize as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(descArg).toContain('src/auth/login.ts');
    expect(descArg).toContain('bob');
    expect(descArg).toContain('auth');
    expect(descArg).toContain('loginUser');
    expect(descArg).toContain('./session.js');
  });

  it('handles multiple updates in a single batch', async () => {
    const provider = makeMockProvider('multi-file summary', null);
    const extractor = new RichExtractor(provider);

    const updates = [
      makeUpdate({ file_path: 'src/a.ts' }),
      makeUpdate({ file_path: 'src/b.ts', dev_name: 'bob' }),
    ];

    const result = await extractor.enrichBatch(updates);

    const [descArg] = (provider.summarize as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(descArg).toContain('src/a.ts');
    expect(descArg).toContain('src/b.ts');
    expect(result.summary).toBe('multi-file summary');
  });

  it('returns { intent: null, summary: null } when provider returns null', async () => {
    const provider = makeMockProvider(null, null);
    const extractor = new RichExtractor(provider);

    const result = await extractor.enrichBatch([makeUpdate()]);

    expect(result.intent).toBeNull();
    expect(result.summary).toBeNull();
  });

  it('returns { intent: null, summary: null } when updates array is empty', async () => {
    const provider = makeMockProvider('should not be called', null);
    const extractor = new RichExtractor(provider);

    const result = await extractor.enrichBatch([]);

    expect(provider.summarize).not.toHaveBeenCalled();
    expect(result.intent).toBeNull();
    expect(result.summary).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// analyzeTeam
// ──────────────────────────────────────────────────────────────────────────────

describe('RichExtractor.analyzeTeam', () => {
  it('delegates to provider.analyze and returns its result', async () => {
    const provider = makeMockProvider(null, 'potential conflict in auth zone');
    const extractor = new RichExtractor(provider);

    const result = await extractor.analyzeTeam('alice: auth zone; bob: auth zone');

    expect(provider.analyze).toHaveBeenCalledOnce();
    expect(provider.analyze).toHaveBeenCalledWith('alice: auth zone; bob: auth zone');
    expect(result).toBe('potential conflict in auth zone');
  });

  it('returns null when provider returns null', async () => {
    const provider = makeMockProvider(null, null);
    const extractor = new RichExtractor(provider);

    const result = await extractor.analyzeTeam('team state description');

    expect(result).toBeNull();
  });
});
