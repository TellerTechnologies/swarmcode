import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

const START_MARKER = '<!-- SWARMCODE START -->';
const END_MARKER = '<!-- SWARMCODE END -->';

export class ContextInjector {
  private readonly filePath: string;
  private lastContent: string | null = null;

  constructor(projectDir: string, contextFile: string) {
    this.filePath = resolve(projectDir, contextFile);
  }

  inject(content: string): boolean {
    const block = `${START_MARKER}\n${content}\n${END_MARKER}`;

    if (block === this.lastContent) {
      return false;
    }

    let existingFileContent = '';
    if (existsSync(this.filePath)) {
      existingFileContent = readFileSync(this.filePath, 'utf-8');
    } else {
      // Ensure parent directories exist
      const dir = dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
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

    writeFileSync(this.filePath, newFileContent, 'utf-8');
    this.lastContent = block;
    return true;
  }

  clear(): void {
    if (!existsSync(this.filePath)) return;

    const existingFileContent = readFileSync(this.filePath, 'utf-8');

    const startIdx = existingFileContent.indexOf(START_MARKER);
    const endIdx = existingFileContent.indexOf(END_MARKER);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return;

    const before = existingFileContent.slice(0, startIdx);
    const after = existingFileContent.slice(endIdx + END_MARKER.length);

    // Clean up extra blank lines left by removal
    const cleaned = (before + after).replace(/\n{3,}/g, '\n\n').trimEnd();
    writeFileSync(this.filePath, cleaned ? cleaned + '\n' : '', 'utf-8');

    this.lastContent = null;
  }
}
