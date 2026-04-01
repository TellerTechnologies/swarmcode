#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxPath = pathToFileURL(require.resolve('tsx/esm')).href;
const entry = join(__dirname, 'swarmcode.ts');

execFileSync(process.execPath, ['--import', tsxPath, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
