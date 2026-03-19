export const VERSION = '0.1.0';

export { SwarmAgent } from './agent.js';
export { loadConfig, getDefaultConfig } from './config.js';
export { createCLI } from './cli.js';

export type {
  EventType,
  PeerStatus,
  LLMProvider as LLMProviderType,
  AITool,
  QueryType,
  ExportEntry,
  SwarmUpdate,
  FileState,
  PeerInfo,
  PeerState,
  EnrichmentConfig,
  SwarmConfig,
  QueryRequest,
  QueryResponse,
  ConflictSignal,
} from './types.js';
