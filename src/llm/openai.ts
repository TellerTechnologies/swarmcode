import OpenAI from 'openai';
import type { LLMProvider } from './provider.js';
import type { EnrichmentConfig } from '../types.js';

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor(
    private readonly config: EnrichmentConfig,
    apiKey: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async summarize(changesDescription: string, tier: 'tier2' | 'tier3'): Promise<string | null> {
    const model = tier === 'tier2' ? this.config.tier2_model : this.config.tier3_model;

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content: `Summarize the following code changes in one concise sentence describing the developer's intent:\n\n${changesDescription}`,
          },
        ],
      });

      const text = response.choices[0]?.message?.content;
      return text ? text.trim() : null;
    } catch {
      return null;
    }
  }

  async analyze(teamState: string): Promise<string | null> {
    const model = this.config.tier3_model;

    try {
      const response = await this.client.chat.completions.create({
        model,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Analyze the following team development state and identify any potential conflicts, coordination opportunities, or important patterns:\n\n${teamState}`,
          },
        ],
      });

      const text = response.choices[0]?.message?.content;
      return text ? text.trim() : null;
    } catch {
      return null;
    }
  }
}
