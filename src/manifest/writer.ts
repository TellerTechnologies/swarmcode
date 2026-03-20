import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManifestData } from '../types.js';

export class ManifestWriter {
  private readonly manifestPath: string;
  private readonly peersDir: string;

  constructor(projectDir: string, name: string) {
    this.peersDir = join(projectDir, '.swarmcode', 'peers');
    this.manifestPath = join(this.peersDir, `${name}.json`);
  }

  async write(data: ManifestData): Promise<void> {
    await mkdir(this.peersDir, { recursive: true });
    await writeFile(this.manifestPath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
