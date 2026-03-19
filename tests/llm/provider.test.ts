import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLLMProvider } from '../../src/llm/provider.js';
import type { EnrichmentConfig } from '../../src/types.js';

const baseConfig: EnrichmentConfig = {
  provider: 'anthropic',
  api_key_env: 'ANTHROPIC_API_KEY',
  tier2_model: 'claude-haiku-4-5',
  tier3_model: 'claude-sonnet-4-5',
};

describe('createLLMProvider – no-op cases', () => {
  beforeEach(() => {
    // Ensure env var is absent
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null from summarize when provider is "none"', async () => {
    const provider = createLLMProvider({ ...baseConfig, provider: 'none' });
    const result = await provider.summarize('some changes', 'tier2');
    expect(result).toBeNull();
  });

  it('returns null from analyze when provider is "none"', async () => {
    const provider = createLLMProvider({ ...baseConfig, provider: 'none' });
    const result = await provider.analyze('team state');
    expect(result).toBeNull();
  });

  it('returns null from summarize when API key env var is not set (anthropic)', async () => {
    const provider = createLLMProvider({ ...baseConfig, provider: 'anthropic' });
    const result = await provider.summarize('some changes', 'tier2');
    expect(result).toBeNull();
  });

  it('returns null from analyze when API key env var is not set (anthropic)', async () => {
    const provider = createLLMProvider({ ...baseConfig, provider: 'anthropic' });
    const result = await provider.analyze('team state');
    expect(result).toBeNull();
  });

  it('returns null from summarize when API key env var is not set (openai)', async () => {
    const provider = createLLMProvider({
      ...baseConfig,
      provider: 'openai',
      api_key_env: 'OPENAI_API_KEY',
    });
    const result = await provider.summarize('some changes', 'tier3');
    expect(result).toBeNull();
  });

  it('returns null from analyze when API key env var is not set (openai)', async () => {
    const provider = createLLMProvider({
      ...baseConfig,
      provider: 'openai',
      api_key_env: 'OPENAI_API_KEY',
    });
    const result = await provider.analyze('team state');
    expect(result).toBeNull();
  });

  it('returns null for unknown provider (e.g. ollama)', async () => {
    const provider = createLLMProvider({ ...baseConfig, provider: 'ollama' as any });
    const result = await provider.summarize('some changes', 'tier2');
    expect(result).toBeNull();
  });
});
