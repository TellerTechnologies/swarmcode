import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const START_MARKER = '<!-- SWARMCODE START -->';
const END_MARKER = '<!-- SWARMCODE END -->';

export class ContextInjector {
  private readonly filePath: string;
  private lastContent: string | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(projectDir: string, contextFile: string) {
    this.filePath = resolve(projectDir, contextFile);
  }

  async inject(content: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.writeQueue = this.writeQueue.then(async () => {
        resolve(await this._doInject(content));
      });
    });
  }

  private async _doInject(content: string): Promise<boolean> {
    const block = `${START_MARKER}\n${content}\n${END_MARKER}`;

    if (block === this.lastContent) {
      return false;
    }

    let existingFileContent = '';
    const fileExists = await access(this.filePath).then(() => true).catch(() => false);
    if (fileExists) {
      existingFileContent = await readFile(this.filePath, 'utf-8');
    } else {
      // Ensure parent directories exist
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
    }

    let newFileContent: string;

    const startIdx = existingFileContent.indexOf(START_MARKER);
    const endIdx = existingFileContent.indexOf(END_MARKER);

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      // Replace existing block
      const before = existingFileContent.slice(0, startIdx);
      const after = existingFileContent.slice(endIdx + END_MARKER.length);
      newFileContent = `${before}${block}${after}`;
    } else {
      // Append block to existing content
      if (existingFileContent && !existingFileContent.endsWith('\n')) {
        newFileContent = `${existingFileContent}\n\n${block}\n`;
      } else if (existingFileContent) {
        newFileContent = `${existingFileContent}\n${block}\n`;
      } else {
        newFileContent = `${block}\n`;
      }
    }

    await writeFile(this.filePath, newFileContent, 'utf-8');
    this.lastContent = block;
    return true;
  }

  async clear(): Promise<void> {
    return new Promise((resolve) => {
      this.writeQueue = this.writeQueue.then(async () => {
        await this._doClear();
        resolve();
      });
    });
  }

  private async _doClear(): Promise<void> {
    const fileExists = await access(this.filePath).then(() => true).catch(() => false);
    if (!fileExists) return;

    const existingFileContent = await readFile(this.filePath, 'utf-8');

    const startIdx = existingFileContent.indexOf(START_MARKER);
    const endIdx = existingFileContent.indexOf(END_MARKER);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;

    const before = existingFileContent.slice(0, startIdx);
    const after = existingFileContent.slice(endIdx + END_MARKER.length);

    // Clean up extra blank lines left by removal
    const cleaned = (before + after).replace(/\n{3,}/g, '\n\n').trimEnd();
    await writeFile(this.filePath, cleaned ? cleaned + '\n' : '', 'utf-8');

    this.lastContent = null;
  }
}
