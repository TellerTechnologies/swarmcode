export type EventType = 'file_created' | 'file_modified' | 'file_deleted' | 'intent_updated' | 'heartbeat';
export type PeerStatus = 'online' | 'offline';
export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'none';
export type AITool = 'claude-code' | 'cursor' | 'copilot' | 'custom';
export type QueryType = 'exports' | 'file_exists' | 'dependencies';

export interface ExportEntry {
  name: string;
  signature: string;
}

export interface SwarmUpdate {
  peer_id: string;
  dev_name: string;
  timestamp: number;
  event_type: EventType;
  file_path: string;
  exports: ExportEntry[];
  imports: string[];
  work_zone: string;
  intent: string | null;
  summary: string | null;
  interfaces: string[];
  touches: string[];
}

export interface FileState {
  exports: ExportEntry[];
  imports: string[];
  last_modified: number;
}

export interface PeerInfo {
  peer_id: string;
  dev_name: string;
  address: string;
  pub_port: number;
  rep_port: number;
}

export interface PeerState {
  peer_id: string;
  dev_name: string;
  status: PeerStatus;
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
  peers: string[];
  tier2_interval: number;
  tier3_interval: number;
  enrichment: EnrichmentConfig;
}

export interface QueryRequest {
  type: QueryType;
  file_path: string;
}

export interface QueryResponse<T = unknown> {
  type: QueryType;
  file_path: string;
  data: T;
  error: string | null;
}

export interface ConflictSignal {
  type: 'zone_overlap' | 'interface_conflict' | 'duplication';
  severity: 'warning' | 'critical';
  peers: string[];
  description: string;
  file_paths: string[];
}
