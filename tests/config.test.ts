import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveContextFile, getDefaultConfig, loadConfig } from '../src/config.js';

describe('resolveContextFile', () => {
  it('maps claude-code to CLAUDE.md', () => {
    expect(resolveContextFile('claude-code')).toBe('CLAUDE.md');
  });

  it('maps cursor to .cursorrules', () => {
    expect(resolveContextFile('cursor')).toBe('.cursorrules');
  });

  it('maps copilot to .github/copilot-instructions.md', () => {
    expect(resolveContextFile('copilot')).toBe('.github/copilot-instructions.md');
  });

  it('returns CLAUDE.md as default for unknown tools', () => {
    expect(resolveContextFile('custom')).toBe('CLAUDE.md');
    expect(resolveContextFile('unknown')).toBe('CLAUDE.md');
    expect(resolveContextFile('')).toBe('CLAUDE.md');
  });
});

describe('getDefaultConfig', () => {
  it('returns a config with sensible defaults', () => {
    const config = getDefaultConfig();

    expect(config.name).toBe('swarmcode-project');
    expect(config.ai_tool).toBe('claude-code');
    expect(config.context_file).toBe('CLAUDE.md');
    expect(config.ignore).toContain('node_modules');
    expect(config.ignore).toContain('.git');
    expect(config.sync_interval).toBe(30);
    expect(config.tier2_interval).toBeGreaterThan(0);
    expect(config.tier3_interval).toBeGreaterThan(config.tier2_interval);
    expect(config.enrichment.provider).toBe('none');
  });

  it('accepts an optional project name', () => {
    const config = getDefaultConfig('my-awesome-project');
    expect(config.name).toBe('my-awesome-project');
  });

  it('returns a new object on each call', () => {
    const a = getDefaultConfig();
    const b = getDefaultConfig();
    expect(a).not.toBe(b);
    a.ignore.push('extra');
    expect(b.ignore).not.toContain('extra');
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(tmpDir);

    expect(config.enrichment.provider).toBe('none');
    expect(config.ignore).toContain('node_modules');
  });

  it('loads a full config from .swarmcode/config.yaml', () => {
    mkdirSync(join(tmpDir, '.swarmcode'));
    writeFileSync(
      join(tmpDir, '.swarmcode', 'config.yaml'),
      `
name: my-team-project
ai_tool: cursor
ignore:
  - node_modules
  - dist
  - .git
tier2_interval: 45
tier3_interval: 450
enrichment:
  provider: openai
  api_key_env: OPENAI_API_KEY
  tier2_model: gpt-4o-mini
  tier3_model: gpt-4o
`.trim()
    );

    const config = loadConfig(tmpDir);

    expect(config.name).toBe('my-team-project');
    expect(config.ai_tool).toBe('cursor');
    expect(config.context_file).toBe('.cursorrules');
    expect(config.tier2_interval).toBe(45);
    expect(config.tier3_interval).toBe(450);
    expect(config.enrichment.provider).toBe('openai');
    expect(config.enrichment.api_key_env).toBe('OPENAI_API_KEY');
    expect(config.enrichment.tier2_model).toBe('gpt-4o-mini');
  });

  it('auto-resolves context_file from ai_tool when not specified', () => {
    mkdirSync(join(tmpDir, '.swarmcode'));
    writeFileSync(
      join(tmpDir, '.swarmcode', 'config.yaml'),
      `
name: copilot-project
ai_tool: copilot
`.trim()
    );

    const config = loadConfig(tmpDir);

    expect(config.ai_tool).toBe('copilot');
    expect(config.context_file).toBe('.github/copilot-instructions.md');
  });

  it('respects explicit context_file override in YAML', () => {
    mkdirSync(join(tmpDir, '.swarmcode'));
    writeFileSync(
      join(tmpDir, '.swarmcode', 'config.yaml'),
      `
name: custom-project
ai_tool: claude-code
context_file: MY_CUSTOM_CONTEXT.md
`.trim()
    );

    const config = loadConfig(tmpDir);

    expect(config.context_file).toBe('MY_CUSTOM_CONTEXT.md');
  });

  it('merges partial config with defaults', () => {
    mkdirSync(join(tmpDir, '.swarmcode'));
    writeFileSync(
      join(tmpDir, '.swarmcode', 'config.yaml'),
      `
name: partial-project
tier2_interval: 20
`.trim()
    );

    const config = loadConfig(tmpDir);
    const defaults = getDefaultConfig();

    expect(config.name).toBe('partial-project');
    expect(config.tier2_interval).toBe(20);
    // Fields not in YAML should fall back to defaults
    expect(config.tier3_interval).toBe(defaults.tier3_interval);
    expect(config.enrichment.provider).toBe('none');
    expect(config.ignore).toEqual(defaults.ignore);
  });

  it('handles malformed YAML gracefully by returning defaults', () => {
    mkdirSync(join(tmpDir, '.swarmcode'));
    writeFileSync(
      join(tmpDir, '.swarmcode', 'config.yaml'),
      `: invalid: yaml: {{{'`
    );

    // Should not throw, fall back to defaults
    const config = loadConfig(tmpDir);
    expect(config.enrichment.provider).toBe('none');
  });

  describe('runtime config validation', () => {
    it('falls back to default ai_tool when value is invalid', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\nai_tool: not-a-real-tool\n`
      );
      const config = loadConfig(tmpDir);
      const defaults = getDefaultConfig();
      expect(config.ai_tool).toBe(defaults.ai_tool);
    });

    it('falls back to default provider when enrichment.provider is invalid', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\nenrichment:\n  provider: bad-provider\n`
      );
      const config = loadConfig(tmpDir);
      expect(config.enrichment.provider).toBe('none');
    });

    it('falls back to default tier2_interval when value is zero', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\ntier2_interval: 0\n`
      );
      const config = loadConfig(tmpDir);
      const defaults = getDefaultConfig();
      expect(config.tier2_interval).toBe(defaults.tier2_interval);
    });

    it('falls back to default tier2_interval when value is negative', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\ntier2_interval: -10\n`
      );
      const config = loadConfig(tmpDir);
      const defaults = getDefaultConfig();
      expect(config.tier2_interval).toBe(defaults.tier2_interval);
    });

    it('falls back to default tier3_interval when value is not a number', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\ntier3_interval: "not-a-number"\n`
      );
      const config = loadConfig(tmpDir);
      const defaults = getDefaultConfig();
      expect(config.tier3_interval).toBe(defaults.tier3_interval);
    });

    it('accepts valid ai_tool values', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\nai_tool: cursor\n`
      );
      const config = loadConfig(tmpDir);
      expect(config.ai_tool).toBe('cursor');
    });

    it('accepts valid positive tier intervals', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\ntier2_interval: 15\ntier3_interval: 120\n`
      );
      const config = loadConfig(tmpDir);
      expect(config.tier2_interval).toBe(15);
      expect(config.tier3_interval).toBe(120);
    });

    it('uses default sync_interval of 30 when not specified', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\n`
      );
      const config = loadConfig(tmpDir);
      expect(config.sync_interval).toBe(30);
    });

    it('loads custom sync_interval from config', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\nsync_interval: 60\n`
      );
      const config = loadConfig(tmpDir);
      expect(config.sync_interval).toBe(60);
    });

    it('falls back to default sync_interval when value is invalid', () => {
      mkdirSync(join(tmpDir, '.swarmcode'));
      writeFileSync(
        join(tmpDir, '.swarmcode', 'config.yaml'),
        `name: test-project\nsync_interval: -5\n`
      );
      const config = loadConfig(tmpDir);
      expect(config.sync_interval).toBe(30);
    });
  });
});
