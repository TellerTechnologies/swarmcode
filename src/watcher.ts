import { EventEmitter } from 'events';
import { watch } from 'chokidar';
import { relative } from 'path';
import type { FSWatcher } from 'chokidar';
import type { EventType } from './types.js';

export interface WatcherEvent {
  type: EventType;
  path: string;
  absolutePath: string;
}

export interface WatcherOptions {
  ignore?: string[];
  debounceMs?: number;
}

export class FileWatcher extends EventEmitter {
  private readonly dir: string;
  private readonly ignore: string[];
  private readonly debounceMs: number;
  private chokidar: FSWatcher | null = null;
  private knownFiles: Set<string> = new Set();
  private pendingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(dir: string, options: WatcherOptions = {}) {
    super();
    this.dir = dir;
    this.ignore = options.ignore ?? [];
    this.debounceMs = options.debounceMs ?? 300;
  }

  async start(): Promise<void> {
    // Build ignored patterns: always ignore dotfiles, plus user-supplied strings converted to RegExp
    const ignoredPatterns: (RegExp | string)[] = [
      /(^|[/\\])\../, // dotfiles
      ...this.ignore.map((pattern) => {
        // Escape special regex chars except '*' which becomes '.*'
        const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(regexStr);
      }),
    ];

    this.chokidar = watch(this.dir, {
      ignored: ignoredPatterns,
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: false,
    });

    // Track files that exist when the watcher starts
    await new Promise<void>((resolve) => {
      this.chokidar!.on('add', (absPath: string) => {
        this.knownFiles.add(absPath);
      });
      this.chokidar!.on('ready', () => {
        resolve();
      });
    });

    // After ready, re-attach 'add' to handle new files post-start
    this.chokidar.removeAllListeners('add');

    this.chokidar.on('add', (absPath: string) => {
      if (this.knownFiles.has(absPath)) {
        // Already tracked — treat as modify (shouldn't normally happen post-ready)
        this.schedule(absPath, 'file_modified');
      } else {
        this.knownFiles.add(absPath);
        this.schedule(absPath, 'file_created');
      }
    });

    this.chokidar.on('change', (absPath: string) => {
      this.schedule(absPath, 'file_modified');
    });

    this.chokidar.on('unlink', (absPath: string) => {
      this.knownFiles.delete(absPath);
      this.schedule(absPath, 'file_deleted');
    });
  }

  async stop(): Promise<void> {
    // Cancel all pending debounce timers
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();

    if (this.chokidar) {
      await this.chokidar.close();
      this.chokidar = null;
    }
  }

  private schedule(absPath: string, type: EventType): void {
    // Cancel any existing timer for this file
    const existing = this.pendingTimers.get(absPath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(absPath);
      const relPath = relative(this.dir, absPath);
      const event: WatcherEvent = {
        type,
        path: relPath,
        absolutePath: absPath,
      };
      this.emit('change', event);
    }, this.debounceMs);

    this.pendingTimers.set(absPath, timer);
  }
}
