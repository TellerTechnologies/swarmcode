import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SwarmConfig, AITool, LLMProvider } from './types.js';

export function resolveContextFile(aiTool: string): string {
  switch (aiTool) {
    case 'claude-code':
      return 'CLAUDE.md';
    case 'cursor':
      return '.cursorrules';
    case 'copilot':
      return '.github/copilot-instructions.md';
    default:
      return 'CLAUDE.md';
  }
}

export function getDefaultConfig(name?: string): SwarmConfig {
  return {
    name: name ?? 'swarmcode-project',
    ai_tool: 'claude-code',
    context_file: 'CLAUDE.md',
    ignore: ['node_modules', '.git', 'dist'],
    sync_interval: 30,
    tier2_interval: 30,
    tier3_interval: 300,
    enrichment: {
      provider: 'none',
      api_key_env: '',
      tier2_model: '',
      tier3_model: '',
    },
  };
}

export function loadConfig(projectDir: string): SwarmConfig {
  const defaults = getDefaultConfig();
  const configPath = join(projectDir, '.swarmcode', 'config.yaml');

  if (!existsSync(configPath)) {
    return defaults;
  }

  let raw: unknown;
  try {
    const content = readFileSync(configPath, 'utf-8');
    raw = parseYaml(content);
  } catch {
    return defaults;
  }

  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const yaml = raw as Record<string, unknown>;

  const enrichmentYaml =
    yaml['enrichment'] && typeof yaml['enrichment'] === 'object'
      ? (yaml['enrichment'] as Record<string, unknown>)
      : {};

  const VALID_AI_TOOLS: AITool[] = ['claude-code', 'cursor', 'copilot', 'custom'];
  const VALID_LLM_PROVIDERS: LLMProvider[] = ['anthropic', 'openai', 'ollama', 'none'];

  const rawAiTool = yaml['ai_tool'] as string | undefined;
  const ai_tool: AITool =
    rawAiTool !== undefined && VALID_AI_TOOLS.includes(rawAiTool as AITool)
      ? (rawAiTool as AITool)
      : defaults.ai_tool;

  const rawProvider = enrichmentYaml['provider'] as string | undefined;
  const validatedProvider: LLMProvider =
    rawProvider !== undefined && VALID_LLM_PROVIDERS.includes(rawProvider as LLMProvider)
      ? (rawProvider as LLMProvider)
      : defaults.enrichment.provider;

  const rawSyncInterval = yaml['sync_interval'] as unknown;
  const sync_interval =
    typeof rawSyncInterval === 'number' && rawSyncInterval > 0
      ? rawSyncInterval
      : defaults.sync_interval;

  const rawTier2 = yaml['tier2_interval'] as unknown;
  const tier2_interval =
    typeof rawTier2 === 'number' && rawTier2 > 0 ? rawTier2 : defaults.tier2_interval;

  const rawTier3 = yaml['tier3_interval'] as unknown;
  const tier3_interval =
    typeof rawTier3 === 'number' && rawTier3 > 0 ? rawTier3 : defaults.tier3_interval;

  const enrichment = {
    provider: validatedProvider,
    api_key_env: (enrichmentYaml['api_key_env'] as string | undefined) ?? defaults.enrichment.api_key_env,
    tier2_model: (enrichmentYaml['tier2_model'] as string | undefined) ?? defaults.enrichment.tier2_model,
    tier3_model: (enrichmentYaml['tier3_model'] as string | undefined) ?? defaults.enrichment.tier3_model,
  };

  // Explicit context_file overrides auto-resolution; otherwise resolve from ai_tool
  const context_file =
    (yaml['context_file'] as string | undefined) ?? resolveContextFile(ai_tool);

  const config: SwarmConfig = {
    name: (yaml['name'] as string | undefined) ?? defaults.name,
    ai_tool,
    context_file,
    ignore: Array.isArray(yaml['ignore'])
      ? (yaml['ignore'] as string[])
      : defaults.ignore,
    sync_interval,
    tier2_interval,
    tier3_interval,
    enrichment,
  };

  return config;
}
