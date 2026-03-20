export const VERSION = '0.1.0';

export { SwarmAgent } from './agent.js';
export { loadConfig, getDefaultConfig } from './config.js';
export { createCLI } from './cli.js';

export type {
  LLMProvider as LLMProviderType,
  AITool,
  ExportEntry,
  FileState,
  ManifestData,
  PeerState,
  EnrichmentConfig,
  SwarmConfig,
  ConflictSignal,
} from './types.js';
