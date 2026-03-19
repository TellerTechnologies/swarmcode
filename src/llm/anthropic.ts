import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from './provider.js';
import type { EnrichmentConfig } from '../types.js';

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic;

  constructor(
    private readonly config: EnrichmentConfig,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    const model = tier === 'tier2' ? this.config.tier2_model : this.config.tier3_model;

    try {
      const message = await this.client.messages.create({
        model,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: `Summarize the following code changes in one concise sentence describing the developer's intent:\n\n${changesDescription}`,
          },
        ],
      });

      const block = message.content[0];
      if (block.type === 'text') {
        return block.text.trim() || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async analyze(teamState: string): Promise<string | null> {
    const model = this.config.tier3_model;

    try {
      const message = await this.client.messages.create({
        model,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Analyze the following team development state and identify any potential conflicts, coordination opportunities, or important patterns:\n\n${teamState}`,
          },
        ],
      });

      const block = message.content[0];
      if (block.type === 'text') {
        return block.text.trim() || null;
      }
      return null;
    } catch {
      return null;
    }
  }
}
