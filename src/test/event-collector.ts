import { execFileSync } from 'node:child_process';
import type { TestEvent, AgentRun } from './types.js';

const EXEC_OPTS = { encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };

export class EventCollector {
  private events: TestEvent[] = [];
  private gitPollId: ReturnType<typeof setInterval> | null = null;
  private lastCommitShas: Map<string, string> = new Map();
  private agents: AgentRun[];
  private issueIdentifiers: string[];

  constructor(agents: AgentRun[], issueIdentifiers: string[]) {
    this.agents = agents;
    this.issueIdentifiers = issueIdentifiers;
  }

  startGitPolling(intervalMs: number = 10_000): void {
    for (const agent of this.agents) {
      const sha = this.getHeadSha(agent.worktreePath);
      if (sha) this.lastCommitShas.set(agent.id, sha);
    }
    this.gitPollId = setInterval(() => this.pollGit(), intervalMs);
  }

  private pollGit(): void {
    for (const agent of this.agents) {
      try {
        const currentSha = this.getHeadSha(agent.worktreePath);
        if (!currentSha) continue;
        const lastSha = this.lastCommitShas.get(agent.id);
        if (currentSha === lastSha) continue;
        const newCommits = this.getCommitsSince(agent.worktreePath, lastSha ?? '');
        for (const commit of newCommits) {
          this.record({
            timestamp: new Date().toISOString(),
            agent: agent.id,
            type: 'git_commit',
            data: { hash: commit.hash, message: commit.message },
          });
        }
        this.lastCommitShas.set(agent.id, currentSha);
      } catch {
        // Worktree may not exist yet or may be cleaned up
      }
    }
  }

  private getHeadSha(cwd: string): string | null {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { ...EXEC_OPTS, cwd }).trim();
    } catch {
      return null;
    }
  }

  private getCommitsSince(cwd: string, sinceSha: string): Array<{ hash: string; message: string }> {
    try {
      const range = sinceSha ? `${sinceSha}..HEAD` : 'HEAD~5..HEAD';
      const output = execFileSync('git', ['log', range, '--format=%H|%s'], { ...EXEC_OPTS, cwd }).trim();
      if (!output) return [];
      return output.split('\n').map(line => {
        const [hash, ...rest] = line.split('|');
        return { hash, message: rest.join('|') };
      });
    } catch {
      return [];
    }
  }

  record(event: TestEvent): void {
    this.events.push(event);
  }

  stop(): void {
    if (this.gitPollId) {
      clearInterval(this.gitPollId);
      this.gitPollId = null;
    }
  }

  getEvents(): TestEvent[] {
    return [...this.events];
  }

  toJSON(): string {
    return JSON.stringify(this.events, null, 2);
  }
}
