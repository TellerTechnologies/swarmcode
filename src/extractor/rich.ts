import type { LLMProvider } from '../llm/provider.js';
import type { SwarmUpdate } from '../types.js';

export interface EnrichmentResult {
  intent: string | null;
  summary: string | null;
}

export class RichExtractor {
  constructor(private readonly provider: LLMProvider) {}

  /**
   * Format a batch of SwarmUpdates into a description and ask the LLM to
   * summarize the developer's intent (Tier 2).
   */
  async enrichBatch(updates: SwarmUpdate[]): Promise<EnrichmentResult> {
    if (updates.length === 0) {
      return { intent: null, summary: null };
    }

    const description = updates
      .map((u) => {
        const exportNames = u.exports.map((e) => e.name).join(', ') || 'none';
        const importPaths = u.imports.join(', ') || 'none';
        return [
          `File: ${u.file_path} (${u.event_type})`,
          `  Developer: ${u.dev_name}`,
          `  Work zone: ${u.work_zone}`,
          `  Exports: ${exportNames}`,
          `  Imports: ${importPaths}`,
        ].join('\n');
      })
      .join('\n\n');

    const summary = await this.provider.summarize(description, 'tier2');

    return {
      intent: summary,
      summary,
    };
  }

  /**
   * Ask the LLM to analyze the overall team state (Tier 3).
   */
  async analyzeTeam(teamStateDescription: string): Promise<string | null> {
    return this.provider.analyze(teamStateDescription);
  }
}
