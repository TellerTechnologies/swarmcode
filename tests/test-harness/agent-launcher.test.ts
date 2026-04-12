import { vi, describe, it, expect, beforeEach } from 'vitest';
import { buildAgentPrompt, buildMcpConfig, createWorktree, removeWorktree } from '../../src/test/agent-launcher.js';

describe('buildAgentPrompt', () => {
  it('includes start_session and pick_issue instructions', () => {
    const prompt = buildAgentPrompt();
    expect(prompt).toContain('start_session');
    expect(prompt).toContain('pick_issue');
    expect(prompt).toContain('complete_issue');
    expect(prompt).toContain('commit');
  });

  it('does not include a specific issue ID', () => {
    const prompt = buildAgentPrompt();
    expect(prompt).not.toMatch(/TEL-\d+/);
  });
});

describe('buildMcpConfig', () => {
  it('returns valid MCP JSON with swarmcode server', () => {
    const config = buildMcpConfig();
    const parsed = JSON.parse(config);
    expect(parsed.mcpServers.swarmcode).toBeDefined();
    expect(parsed.mcpServers.swarmcode.command).toBeDefined();
    expect(parsed.mcpServers.swarmcode.args).toContain('swarmcode');
  });
});

describe('createWorktree', () => {
  it('is a function', () => {
    expect(typeof createWorktree).toBe('function');
  });
});

describe('removeWorktree', () => {
  it('is a function', () => {
    expect(typeof removeWorktree).toBe('function');
  });
});
