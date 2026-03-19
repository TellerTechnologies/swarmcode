import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parsePlan } from '../../src/plan/parser.js';
import type { ProjectPlan } from '../../src/plan/parser.js';

describe('parsePlan', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'swarmcode-plan-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no PLAN.md exists', () => {
    const result = parsePlan(tmpDir);
    expect(result).toBeNull();
  });

  it('returns raw content when PLAN.md exists', () => {
    const content = '# Project Plan\n\nNo assignments here.\n';
    writeFileSync(join(tmpDir, 'PLAN.md'), content);

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe(content);
  });

  it('handles PLAN.md with no assignments', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan\n\nThis plan has no feature assignments yet.\n`
    );

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.assignments).toEqual([]);
    expect(result!.sharedContext).toBe('');
  });

  it('parses bold-style assignment lines: - **Feature** - Owner', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan

## Features

- **Authentication** - Alice
- **Dashboard** - Bob
`
    );

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.assignments).toHaveLength(2);

    expect(result!.assignments[0]).toEqual({
      feature: 'Authentication',
      owner: 'Alice',
      details: [],
    });
    expect(result!.assignments[1]).toEqual({
      feature: 'Dashboard',
      owner: 'Bob',
      details: [],
    });
  });

  it('parses plain-style assignment lines: - Feature - Owner', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan

- Authentication - Alice
- Dashboard - Bob
`
    );

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.assignments).toHaveLength(2);
    expect(result!.assignments[0].feature).toBe('Authentication');
    expect(result!.assignments[0].owner).toBe('Alice');
  });

  it('captures sub-items as details array', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan

- **Authentication** - Alice
  - JWT token flow
  - OAuth2 integration
  - Password reset
- **Dashboard** - Bob
  - Charts and graphs
`
    );

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();

    const auth = result!.assignments[0];
    expect(auth.feature).toBe('Authentication');
    expect(auth.owner).toBe('Alice');
    expect(auth.details).toEqual([
      'JWT token flow',
      'OAuth2 integration',
      'Password reset',
    ]);

    const dashboard = result!.assignments[1];
    expect(dashboard.details).toEqual(['Charts and graphs']);
  });

  it('extracts sharedContext from ## Shared heading', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan

## Features

- **Auth** - Alice

## Shared Context

All developers use the same Postgres database.
API base URL: https://api.example.com
`
    );

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.sharedContext).toContain('All developers use the same Postgres database.');
    expect(result!.sharedContext).toContain('API base URL: https://api.example.com');
  });

  it('sharedContext is empty when no ## Shared heading', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan\n\n- **Auth** - Alice\n`
    );

    const result = parsePlan(tmpDir);
    expect(result!.sharedContext).toBe('');
  });

  it('does not include assignment lines in sharedContext', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Project Plan

- **Auth** - Alice
  - Login flow

## Shared

Use TypeScript strict mode.
`
    );

    const result = parsePlan(tmpDir);
    expect(result!.sharedContext).not.toContain('Auth');
    expect(result!.sharedContext).toContain('Use TypeScript strict mode.');
    expect(result!.assignments).toHaveLength(1);
  });

  it('handles mixed bold and plain assignment styles in the same file', () => {
    writeFileSync(
      join(tmpDir, 'PLAN.md'),
      `# Plan

- **Search** - Carol
  - Full-text indexing
- Notifications - Dave
`
    );

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.assignments).toHaveLength(2);
    expect(result!.assignments[0]).toMatchObject({ feature: 'Search', owner: 'Carol' });
    expect(result!.assignments[0].details).toEqual(['Full-text indexing']);
    expect(result!.assignments[1]).toMatchObject({ feature: 'Notifications', owner: 'Dave' });
  });

  it('returns empty sharedContext and empty assignments for empty PLAN.md', () => {
    writeFileSync(join(tmpDir, 'PLAN.md'), '');

    const result = parsePlan(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.raw).toBe('');
    expect(result!.assignments).toEqual([]);
    expect(result!.sharedContext).toBe('');
  });
});
