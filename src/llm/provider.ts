import type { EnrichmentConfig } from '../types.js';

export interface LLMProvider {
  summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null>;
  analyze(teamState: string): Promise<string | null>;
}

class NoOpProvider implements LLMProvider {
  async summarize(_changesDescription: string, _tier: 'tier2' | 'tier3'): Promise<null> {
    return null;
  }

  async analyze(_teamState: string): Promise<null> {
    return null;
  }
}

export function createLLMProvider(config: EnrichmentConfig): LLMProvider {
  if (config.provider === 'none') {
    return new NoOpProvider();
  }

  const apiKey = process.env[config.api_key_env];
  if (!apiKey) {
    return new NoOpProvider();
  }

  if (config.provider === 'anthropic') {
    // Lazy import to avoid hard dependency at module load time
    return new LazyAnthropicProvider(config, apiKey);
  }

  if (config.provider === 'openai') {
    return new LazyOpenAIProvider(config, apiKey);
  }

  // Fallback for unknown providers (e.g. 'ollama')
  return new NoOpProvider();
}

// ---------------------------------------------------------------------------
// Lazy wrappers – delegate to the concrete provider on first call so that
// the SDK constructors only run when actually needed.
// ---------------------------------------------------------------------------

class LazyAnthropicProvider implements LLMProvider {
  private _inner: LLMProvider | null = null;

  constructor(
    private readonly config: EnrichmentConfig,
    private readonly apiKey: string,
  ) {}

  private async _get(): Promise<LLMProvider> {
    if (!this._inner) {
      const { AnthropicProvider } = await import('./anthropic.js');
      this._inner = new AnthropicProvider(this.config, this.apiKey);
    }
    return this._inner;
  }

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    return (await this._get()).summarize(changesDescription, tier);
  }

  async analyze(teamState: string): Promise<string | null> {
    return (await this._get()).analyze(teamState);
  }
}

class LazyOpenAIProvider implements LLMProvider {
  private _inner: LLMProvider | null = null;

  constructor(
    private readonly config: EnrichmentConfig,
    private readonly apiKey: string,
  ) {}

  private async _get(): Promise<LLMProvider> {
    if (!this._inner) {
      const { OpenAIProvider } = await import('./openai.js');
      this._inner = new OpenAIProvider(this.config, this.apiKey);
    }
    return this._inner;
  }

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    return (await this._get()).summarize(changesDescription, tier);
  }

  async analyze(teamState: string): Promise<string | null> {
    return (await this._get()).analyze(teamState);
  }
}
