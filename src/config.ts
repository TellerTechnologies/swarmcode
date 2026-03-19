import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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
    ignore: ['node_modules', '.git', 'dist', '.swarmcode'],
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

  const enrichment = {
    provider: (enrichmentYaml['provider'] as LLMProvider | undefined) ?? defaults.enrichment.provider,
    api_key_env: (enrichmentYaml['api_key_env'] as string | undefined) ?? defaults.enrichment.api_key_env,
    tier2_model: (enrichmentYaml['tier2_model'] as string | undefined) ?? defaults.enrichment.tier2_model,
    tier3_model: (enrichmentYaml['tier3_model'] as string | undefined) ?? defaults.enrichment.tier3_model,
  };

  const ai_tool = (yaml['ai_tool'] as AITool | undefined) ?? defaults.ai_tool;

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
    tier2_interval: (yaml['tier2_interval'] as number | undefined) ?? defaults.tier2_interval,
    tier3_interval: (yaml['tier3_interval'] as number | undefined) ?? defaults.tier3_interval,
    enrichment,
  };

  return config;
}
