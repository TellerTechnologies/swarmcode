import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export class GitSync {
  private readonly projectDir: string;
  private readonly devName: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(projectDir: string, devName: string) {
    this.projectDir = projectDir;
    this.devName = devName;
  }

  start(intervalMs: number = 30_000): void {
    // Run immediately, then on interval
    void this.sync();
    this.timer = setInterval(() => void this.sync(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    try {
      const hasRemote = await this.git('remote').then(r => r.stdout.trim().length > 0).catch(() => false);
      if (!hasRemote) return;

      // Stage only manifest files
      await this.git('add', '.swarmcode/peers/');

      // Check if there's anything to commit
      const status = await this.git('diff', '--cached', '--name-only');
      if (status.stdout.trim().length > 0) {
        await this.git('commit', '-m', `swarmcode: sync from ${this.devName}`);
        console.log(`[git-sync] Committed manifest`);
      }

      // Pull with rebase
      try {
        const pull = await this.git('pull', '--rebase', '--no-edit');
        if (pull.stdout.includes('Fast-forward') || pull.stdout.includes('rewinding')) {
          console.log(`[git-sync] Pulled latest`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('CONFLICT') || msg.includes('could not apply')) {
          console.log(`[git-sync] Merge conflict, aborting rebase`);
          await this.git('rebase', '--abort').catch(() => {});
          return;
        }
      }

      // Push if ahead
      try {
        const ahead = await this.git('rev-list', '--count', '@{u}..HEAD');
        if (parseInt(ahead.stdout.trim(), 10) > 0) {
          await this.git('push');
          console.log(`[git-sync] Pushed`);
        }
      } catch {
        // non-fatal
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('nothing to commit')) {
        console.log(`[git-sync] Error: ${msg.split('\n')[0]}`);
      }
    } finally {
      this.syncing = false;
    }
  }

  private async git(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    return exec('git', args, { cwd: this.projectDir, timeout: 15_000 });
  }
}
