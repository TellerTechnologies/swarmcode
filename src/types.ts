export interface GitCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
  files: string[];
}

export interface AuthorActivity {
  name: string;
  active_branches: string[];
  work_areas: string[];
  recent_files: string[];
  last_active: number;
  recent_commits: Array<{ message: string; timestamp: number }>;
}

export interface PathAuthor {
  name: string;
  commit_count: number;
  last_commit: number;
}

export interface PendingChange {
  branch: string;
  author: string;
  files: string[];
}

export type RiskLevel = 'safe' | 'caution' | 'conflict_likely';

export interface PathCheckResult {
  recent_authors: PathAuthor[];
  primary_owner: string | null;
  pending_changes: PendingChange[];
  locally_modified: boolean;
  risk: RiskLevel;
  risk_reason: string;
}

export interface ExportMatch {
  file: string;
  name: string;
  signature: string;
  last_modified_by: string;
  last_modified_at: number;
  in_flux: boolean;
  branch?: string;
}

export interface ConflictEntry {
  file: string;
  branches: Array<{ branch: string; author: string }>;
  local: boolean;
  severity: 'low' | 'high';
}

export interface ConflictReport {
  conflicts: ConflictEntry[];
  summary: string;
}

export interface DeveloperProfile {
  name: string;
  recent_commits: Array<{
    hash: string;
    message: string;
    timestamp: number;
    files: string[];
  }>;
  active_branches: string[];
  work_areas: string[];
  files: string[];
}

export interface AutoPushResult {
  enabled: boolean;
  already_enabled?: boolean;
  branch: string;
  interval: number;
  protected_branches: string[];
}

export interface AutoPushDisableResult {
  enabled: false;
  pushes_made: number;
}

export interface ProjectContextFile {
  path: string;
  content: string;
}

export interface ProjectContextResult {
  files: ProjectContextFile[];
  total_files: number;
  truncated: boolean;
}

export interface CheckAllResult {
  team_activity: AuthorActivity[];
  project_context: ProjectContextResult;
  conflicts: ConflictReport;
}
