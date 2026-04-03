/**
 * Integration smoke tests for Linear API — hits the REAL API, no mocks.
 *
 * Requires SWARMCODE_LINEAR_API_KEY to be set. Skips entirely if missing.
 *
 * These tests are READ-ONLY by default. Write tests (create/update/archive)
 * are gated behind SWARMCODE_LINEAR_SMOKE_WRITE=1 and clean up after themselves.
 *
 * Run: npm run test:integration -- tests/integration/linear-smoke.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  isConfigured,
  getViewer,
  getTeams,
  getUsers,
  getWorkflowStates,
  getCycles,
  getLinearData,
  searchIssues,
  getIssue,
  getLabels,
  getProjects,
  startIssue,
  completeIssue,
  updateIssueStatus,
  updateIssue,
  createIssue,
  createSubIssue,
  commentOnIssue,
  archiveIssue,
  addIssueLabel,
  removeIssueLabel,
  addIssueToCycle,
  addIssueToProject,
  getIssueRelations,
  getIssueHistory,
  getProjectIssues,
  getProjectUpdates,
  createProject,
  updateProject,
  createProjectUpdate,
  createIssueRelation,
  type LinearTeam,
  type LinearUser,
  type LinearIssue,
} from '../../src/linear.js';

const SKIP = !process.env.SWARMCODE_LINEAR_API_KEY;
const WRITE_ENABLED = process.env.SWARMCODE_LINEAR_SMOKE_WRITE === '1';

// Shared state populated in beforeAll
let viewer: LinearUser;
let teams: LinearTeam[];
let team: LinearTeam;
let teamId: string;
let sampleIssue: LinearIssue | null = null;

describe.skipIf(SKIP)('Linear API smoke tests (live)', () => {
  beforeAll(async () => {
    viewer = await getViewer();
    teams = await getTeams();
    expect(teams.length).toBeGreaterThan(0);
    // Use SWARMCODE_LINEAR_TEAM if set, otherwise first team
    const teamKey = process.env.SWARMCODE_LINEAR_TEAM;
    team = (teamKey ? teams.find(t => t.key === teamKey) : teams[0])!;
    expect(team).toBeDefined();
    teamId = team.id;

    // Find any existing issue for read tests
    const data = await getLinearData();
    if (data && data.issues.length > 0) {
      sampleIssue = data.issues[0];
    }
  });

  // -----------------------------------------------------------------
  // Auth & basic reads
  // -----------------------------------------------------------------

  describe('auth & basics', () => {
    it('isConfigured returns true', () => {
      expect(isConfigured()).toBe(true);
    });

    it('getViewer returns a valid user', () => {
      expect(viewer.id).toBeTruthy();
      expect(viewer.name).toBeTruthy();
      expect(viewer.email).toContain('@');
      expect(viewer.active).toBe(true);
    });

    it('getTeams returns at least one team', () => {
      expect(teams.length).toBeGreaterThan(0);
      for (const t of teams) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.key).toBeTruthy();
      }
    });

    it('getUsers returns at least the current viewer', async () => {
      const users = await getUsers();
      expect(users.length).toBeGreaterThan(0);
      const me = users.find(u => u.id === viewer.id);
      expect(me).toBeDefined();
    });
  });

  // -----------------------------------------------------------------
  // Team-scoped reads
  // -----------------------------------------------------------------

  describe('team-scoped reads', () => {
    it('getWorkflowStates returns sorted states', async () => {
      const states = await getWorkflowStates(teamId);
      expect(states.length).toBeGreaterThan(0);
      for (const s of states) {
        expect(s.id).toBeTruthy();
        expect(s.name).toBeTruthy();
        expect(typeof s.type).toBe('string');
        expect(typeof s.position).toBe('number');
      }
      // Verify sorting
      for (let i = 1; i < states.length; i++) {
        expect(states[i].position).toBeGreaterThanOrEqual(states[i - 1].position);
      }
    });

    it('getCycles returns active/recent structure', async () => {
      const cycles = await getCycles(teamId);
      expect(cycles).toHaveProperty('active');
      expect(cycles).toHaveProperty('recent');
      expect(Array.isArray(cycles.recent)).toBe(true);
      if (cycles.active) {
        expect(cycles.active.id).toBeTruthy();
        expect(typeof cycles.active.number).toBe('number');
      }
    });

    it('getLabels returns label list', async () => {
      const labels = await getLabels();
      // Workspace may have no labels, but structure should be valid
      expect(Array.isArray(labels)).toBe(true);
      for (const l of labels) {
        expect(l.id).toBeTruthy();
        expect(l.name).toBeTruthy();
        expect(typeof l.color).toBe('string');
      }
    });
  });

  // -----------------------------------------------------------------
  // Issue reads
  // -----------------------------------------------------------------

  describe('issue reads', () => {
    it('getLinearData returns issues array', async () => {
      const data = await getLinearData();
      expect(data).not.toBeNull();
      expect(Array.isArray(data!.issues)).toBe(true);
      for (const issue of data!.issues) {
        expect(issue.id).toBeTruthy();
        expect(issue.identifier).toBeTruthy();
        expect(issue.title).toBeTruthy();
        expect(typeof issue.status).toBe('string');
        expect(typeof issue.statusType).toBe('string');
        expect(Array.isArray(issue.labels)).toBe(true);
      }
    });

    it('searchIssues returns results (may be empty)', async () => {
      const results = await searchIssues(team.key, 5);
      expect(Array.isArray(results)).toBe(true);
      for (const issue of results) {
        expect(issue.id).toBeTruthy();
        expect(issue.identifier).toBeTruthy();
        // Verify re-fetch worked — labels should be resolved arrays, not undefined
        expect(Array.isArray(issue.labels)).toBe(true);
      }
    });

    it('getIssue returns full detail with comments and children', async () => {
      if (!sampleIssue) return; // skip if no issues exist
      const detail = await getIssue(sampleIssue.identifier);
      expect(detail.id).toBe(sampleIssue.id);
      expect(detail.identifier).toBe(sampleIssue.identifier);
      // Detail-specific fields
      expect(typeof detail.teamId).toBe('string');
      expect(typeof detail.teamKey).toBe('string');
      expect(typeof detail.createdAt).toBe('string');
      expect(typeof detail.updatedAt).toBe('string');
      expect(Array.isArray(detail.comments)).toBe(true);
      expect(Array.isArray(detail.children)).toBe(true);
      // This is the exact call chain that was broken: searchIssues -> issue() -> .comments()
      // If we got here without "issue.comments is not a function", the fix works.
    });

    it('getIssueRelations returns array', async () => {
      if (!sampleIssue) return;
      const relations = await getIssueRelations(sampleIssue.identifier);
      expect(Array.isArray(relations)).toBe(true);
      for (const r of relations) {
        expect(r.id).toBeTruthy();
        expect(typeof r.type).toBe('string');
        expect(r.relatedIssue).toBeDefined();
      }
    });

    it('getIssueHistory returns array', async () => {
      if (!sampleIssue) return;
      const history = await getIssueHistory(sampleIssue.identifier, 5);
      expect(Array.isArray(history)).toBe(true);
      for (const h of history) {
        expect(h.id).toBeTruthy();
        expect(typeof h.createdAt).toBe('string');
      }
    });
  });

  // -----------------------------------------------------------------
  // Project reads
  // -----------------------------------------------------------------

  describe('project reads', () => {
    it('getProjects returns array', async () => {
      const projects = await getProjects(5);
      expect(Array.isArray(projects)).toBe(true);
      for (const p of projects) {
        expect(p.id).toBeTruthy();
        expect(p.name).toBeTruthy();
        expect(typeof p.state).toBe('string');
        expect(Array.isArray(p.teamIds)).toBe(true);
      }
    });

    it('getProjectIssues works for first project', async () => {
      const projects = await getProjects(1);
      if (projects.length === 0) return;
      const issues = await getProjectIssues(projects[0].id, 5);
      expect(Array.isArray(issues)).toBe(true);
    });

    it('getProjectUpdates works for first project', async () => {
      const projects = await getProjects(1);
      if (projects.length === 0) return;
      const updates = await getProjectUpdates(projects[0].id, 5);
      expect(Array.isArray(updates)).toBe(true);
      for (const u of updates) {
        expect(u.id).toBeTruthy();
        expect(typeof u.body).toBe('string');
        expect(typeof u.health).toBe('string');
      }
    });
  });

  // -----------------------------------------------------------------
  // Write operations (opt-in, creates + cleans up)
  // -----------------------------------------------------------------

  describe.skipIf(!WRITE_ENABLED)('write operations (SWARMCODE_LINEAR_SMOKE_WRITE=1)', () => {
    let createdIssueId: string;
    let createdIssueIdentifier: string;
    let subIssueId: string;
    let subIssueIdentifier: string;

    it('createIssue creates and returns a valid issue', async () => {
      const result = await createIssue({
        title: '[smoke-test] integration test issue — safe to delete',
        teamId,
        description: 'Automated smoke test. Will be archived.',
        priority: 0, // no priority
      });
      expect(result.success).toBe(true);
      expect(result.issue).not.toBeNull();
      expect(result.issue!.id).toBeTruthy();
      expect(result.issue!.identifier).toBeTruthy();
      createdIssueId = result.issue!.id;
      createdIssueIdentifier = result.issue!.identifier;
    });

    it('updateIssue updates title', async () => {
      const result = await updateIssue(createdIssueIdentifier, {
        title: '[smoke-test] updated title — safe to delete',
      });
      expect(result.success).toBe(true);
    });

    it('startIssue assigns and moves to started', async () => {
      const result = await startIssue(createdIssueIdentifier);
      expect(result.success).toBe(true);
      expect(result.issue).not.toBeNull();
      expect(result.issue!.assignee).toBeTruthy();
    });

    it('updateIssueStatus moves to unstarted', async () => {
      const result = await updateIssueStatus(createdIssueIdentifier, 'unstarted');
      expect(result.success).toBe(true);
    });

    it('commentOnIssue adds a comment', async () => {
      const result = await commentOnIssue(createdIssueIdentifier, 'Smoke test comment — ignore.');
      expect(result.success).toBe(true);
      expect(result.commentId).toBeTruthy();
    });

    it('createSubIssue creates a child issue', async () => {
      const result = await createSubIssue(createdIssueIdentifier, {
        title: '[smoke-test] sub-issue — safe to delete',
      });
      expect(result.success).toBe(true);
      expect(result.issue).not.toBeNull();
      subIssueId = result.issue!.id;
      subIssueIdentifier = result.issue!.identifier;
    });

    it('getIssue shows children after sub-issue creation', async () => {
      const detail = await getIssue(createdIssueIdentifier);
      expect(detail.children.length).toBeGreaterThan(0);
      expect(detail.children.some(c => c.identifier === subIssueIdentifier)).toBe(true);
    });

    it('addIssueLabel and removeIssueLabel round-trip', async () => {
      const labels = await getLabels();
      if (labels.length === 0) return; // no labels to test with
      const label = labels[0];
      const addResult = await addIssueLabel(createdIssueIdentifier, label.id);
      expect(addResult.success).toBe(true);
      // Idempotent — adding again should also succeed
      const addAgain = await addIssueLabel(createdIssueIdentifier, label.id);
      expect(addAgain.success).toBe(true);
      const removeResult = await removeIssueLabel(createdIssueIdentifier, label.id);
      expect(removeResult.success).toBe(true);
    });

    it('completeIssue marks done', async () => {
      const result = await completeIssue(createdIssueIdentifier);
      expect(result.success).toBe(true);
    });

    // Cleanup: archive both issues
    it('archiveIssue cleans up sub-issue', async () => {
      if (!subIssueIdentifier) return;
      const result = await archiveIssue(subIssueIdentifier);
      expect(result.success).toBe(true);
    });

    it('archiveIssue cleans up parent issue', async () => {
      const result = await archiveIssue(createdIssueIdentifier);
      expect(result.success).toBe(true);
    });
  });
});
