export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'none';
export type AITool = 'claude-code' | 'cursor' | 'copilot' | 'custom';

export interface ExportEntry {
  name: string;
  signature: string;
}

export interface FileState {
  exports: ExportEntry[];
  imports: string[];
  last_modified: number;
}

export interface ManifestData {
  name: string;
  updated_at: number;
  work_zone: string;
  intent: string | null;
  files: Record<string, FileState>;
}

export interface PeerState {
  peer_id: string;
  dev_name: string;
  status: 'online' | 'offline';
  last_seen: number;
  address: string;
  pub_port: number;
  rep_port: number;
  files: Map<string, FileState>;
  work_zone: string;
  intent: string | null;
}

export interface EnrichmentConfig {
  provider: LLMProvider;
  api_key_env: string;
  tier2_model: string;
  tier3_model: string;
}

export interface SwarmConfig {
  name: string;
  ai_tool: AITool;
  context_file: string;
  ignore: string[];
  sync_interval: number;
  tier2_interval: number;
  tier3_interval: number;
  enrichment: EnrichmentConfig;
}

export interface ConflictSignal {
  type: 'zone_overlap' | 'interface_conflict' | 'duplication';
  severity: 'warning' | 'critical';
  peers: string[];
  description: string;
  file_paths: string[];
}
