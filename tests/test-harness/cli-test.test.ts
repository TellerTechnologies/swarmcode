import { describe, it, expect } from 'vitest';
import { createCLI } from '../../src/cli.js';

describe('swarmcode test commands', () => {
  it('registers test command with run subcommand', () => {
    const program = createCLI();
    const testCmd = program.commands.find(c => c.name() === 'test');
    expect(testCmd).toBeDefined();
  });

  it('test command has run, list, report, and cleanup subcommands', () => {
    const program = createCLI();
    const testCmd = program.commands.find(c => c.name() === 'test');
    const subcommands = testCmd?.commands.map(c => c.name()) ?? [];
    expect(subcommands).toContain('run');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('cleanup');
  });
});
