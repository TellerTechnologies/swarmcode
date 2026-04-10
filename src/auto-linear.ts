/**
 * Auto-Linear: automatic git↔Linear state synchronization.
 *
 * Three automation layers:
 * 1. Auto-complete: detect merged branches → mark issues Done
 * 2. Auto-progress: batch commit messages → post as Linear comments
 * 3. Auto-health: detect project completion/staleness → update project health
 */

import * as git from './git.js';
import { extractIssueId } from './branch-parser.js';
import {
  isConfigured,
  getLinearData,
  completeIssue,
  reviewIssue,
  commentOnIssue,
  getProjects,
  getProjectIssues,
  getProjectUpdates,
  createProjectUpdate,
  updateProject,
  getIssue,
} from './linear.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoCompleteResult {
  completed: Array<{ identifier: string; branch: string }>;
  errors: Array<{ identifier: string; error: string }>;
}

export interface BranchWarning {
  type: 'no_issue_id' | 'already_done' | 'assigned_to_other';
  message: string;
}

export interface StaleIssue {
  identifier: string;
  title: string;
  assignee: string | null;
  branch: string;
  hoursSinceLastCommit: number;
}

export interface SessionLinearContext {
  auto_completed: AutoCompleteResult;
  branch_warnings: BranchWarning[];
  stale_issues: StaleIssue[];
}

export interface AutoProgressResult {
  commented: Array<{ identifier: string; commitCount: number }>;
  errors: Array<{ identifier: string; error: string }>;
}

// ---------------------------------------------------------------------------
// 1. Auto-complete: merged branches → Done
// ---------------------------------------------------------------------------

/**
 * Detect remote branches merged into main, extract issue IDs, and mark
 * those issues as Done in Linear.
 */
export async function autoComplete(): Promise<AutoCompleteResult> {
  if (!isConfigured()) return { completed: [], errors: [] };

  const mergedBranches = git.getMergedRemoteBranches();
  const completed: AutoCompleteResult['completed'] = [];
  const errors: AutoCompleteResult['errors'] = [];

  for (const branch of mergedBranches) {
    const issueId = extractIssueId(branch);
    if (!issueId) continue;

    // Check if issue is still In Progress (avoid re-completing)
    try {
      const issue = await getIssue(issueId);
      if (issue.statusType === 'completed' || issue.statusType === 'cancelled') {
        continue; // Already done
      }

      const result = await completeIssue(issueId);
      if (result.success) {
        // Post a completion comment with commit summary
        try {
          const commits = git.getBranchLog(branch, '30d');
          const summary = commits.slice(0, 10).map(c => `- ${c.message}`).join('\n');
          await commentOnIssue(issueId, `Completed (auto-detected merge to main).\n\nCommits:\n${summary}`);
        } catch {
          // Comment is optional
        }
        completed.push({ identifier: issueId, branch });
      } else {
        errors.push({ identifier: issueId, error: result.error ?? 'Unknown error' });
      }
    } catch (e: any) {
      errors.push({ identifier: issueId, error: e.message });
    }
  }

  return { completed, errors };
}

// ---------------------------------------------------------------------------
// 2. Branch validation & stale detection
// ---------------------------------------------------------------------------

/**
 * Validate the current branch against Linear state.
 * Returns warnings if the branch has issues.
 */
export async function validateBranch(): Promise<BranchWarning[]> {
  if (!isConfigured()) return [];

  const branch = git.getCurrentBranch();
  if (!branch) return [];

  const issueId = extractIssueId(branch);
  if (!issueId) {
    // Only warn on feature branches, not main/develop
    const skipBranches = ['main', 'master', 'develop', 'dev', 'staging'];
    if (!skipBranches.includes(branch)) {
      return [{ type: 'no_issue_id', message: `Branch "${branch}" has no Linear issue ID. Use a name like feat/${branch.toLowerCase()}-123-description for automatic linking.` }];
    }
    return [];
  }

  const warnings: BranchWarning[] = [];

  try {
    const issue = await getIssue(issueId);

    if (issue.statusType === 'completed' || issue.statusType === 'cancelled') {
      warnings.push({
        type: 'already_done',
        message: `${issueId} "${issue.title}" is already ${issue.status}. You may be working on a stale branch.`,
      });
    }

    const viewer = git.getCurrentUser();
    if (issue.assignee && viewer && issue.assignee !== viewer) {
      warnings.push({
        type: 'assigned_to_other',
        message: `${issueId} "${issue.title}" is assigned to ${issue.assignee}, not you (${viewer}). Consider coordinating before making changes.`,
      });
    }
  } catch {
    // Issue not found in Linear — not a warning, might be a non-Linear branch
  }

  return warnings;
}

/**
 * Detect In Progress issues whose branches have no recent commits.
 */
export async function detectStaleIssues(staleHours: number = 4): Promise<StaleIssue[]> {
  if (!isConfigured()) return [];

  const stale: StaleIssue[] = [];
  const now = Date.now() / 1000;
  const remoteBranches = git.getActiveRemoteBranches();

  try {
    const data = await getLinearData();
    if (!data) return [];

    const inProgress = data.issues.filter(i => i.statusType === 'started');

    for (const issue of inProgress) {
      // Find a matching branch
      const matchingBranch = remoteBranches.find(b => {
        const id = extractIssueId(b);
        return id === issue.identifier;
      });

      if (!matchingBranch) continue; // No branch found — can't check staleness

      const lastCommitTime = git.getBranchLastCommitTime(matchingBranch);
      if (lastCommitTime === 0) continue;

      const hoursSince = (now - lastCommitTime) / 3600;
      if (hoursSince >= staleHours) {
        stale.push({
          identifier: issue.identifier,
          title: issue.title,
          assignee: issue.assignee,
          branch: matchingBranch,
          hoursSinceLastCommit: Math.round(hoursSince),
        });
      }
    }
  } catch {
    // Linear API error — return empty
  }

  return stale;
}

/**
 * Run all session-start Linear automations.
 */
export async function runSessionLinearChecks(): Promise<SessionLinearContext> {
  const [auto_completed, branch_warnings, stale_issues] = await Promise.all([
    autoComplete(),
    validateBranch(),
    detectStaleIssues(),
  ]);

  return { auto_completed, branch_warnings, stale_issues };
}

// ---------------------------------------------------------------------------
// 3. Auto-review: open PR → move issue to In Review
// ---------------------------------------------------------------------------

// Track which issues we've already moved to review this session
const reviewedIssues = new Set<string>();

/**
 * Called after auto-push succeeds. If the current branch has an open PR,
 * move the linked Linear issue to "In Review".
 */
export async function autoReview(): Promise<{ moved: string | null; error?: string }> {
  if (!isConfigured()) return { moved: null };

  const branch = git.getCurrentBranch();
  if (!branch) return { moved: null };

  const issueId = extractIssueId(branch);
  if (!issueId) return { moved: null };

  // Only move once per session per issue
  if (reviewedIssues.has(issueId)) return { moved: null };

  if (!git.hasOpenPR()) return { moved: null };

  try {
    const issue = await getIssue(issueId);
    // Only move if currently "In Progress" (started), not already reviewed/done
    if (issue.statusType !== 'started' || issue.status.toLowerCase().includes('review')) {
      reviewedIssues.add(issueId);
      return { moved: null };
    }

    const result = await reviewIssue(issueId);
    if (result.success) {
      reviewedIssues.add(issueId);
      return { moved: issueId };
    }
    return { moved: null, error: result.error ?? 'Unknown error' };
  } catch (e: any) {
    return { moved: null, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// 4. Auto-progress: batch commits → Linear comments
// ---------------------------------------------------------------------------

// Track what we've already commented per issue to avoid duplicates
const lastCommentedSha: Map<string, string> = new Map();
const lastCommentTime: Map<string, number> = new Map();

const AUTO_COMMENT_THROTTLE_SECS = 30 * 60; // 30 minutes between auto-comments per issue

/**
 * Called after auto-push succeeds. Extracts issue IDs from recent commits
 * and posts batched progress comments to Linear.
 *
 * @param previousSha - the HEAD sha before the push
 */
export async function autoProgress(previousSha: string): Promise<AutoProgressResult> {
  if (!isConfigured()) return { commented: [], errors: [] };

  const commits = git.getCommitMessagesSince(previousSha);
  if (commits.length === 0) return { commented: [], errors: [] };

  // Group commits by issue ID
  const byIssue = new Map<string, string[]>();
  for (const c of commits) {
    const id = extractIssueId(c.message);
    if (!id) continue;
    const existing = byIssue.get(id);
    if (existing) {
      existing.push(c.message);
    } else {
      byIssue.set(id, [c.message]);
    }
  }

  const commented: AutoProgressResult['commented'] = [];
  const errors: AutoProgressResult['errors'] = [];
  const now = Date.now() / 1000;

  for (const [issueId, messages] of byIssue) {
    // Throttle: don't comment more than once per 30 minutes per issue
    const lastTime = lastCommentTime.get(issueId) ?? 0;
    if (now - lastTime < AUTO_COMMENT_THROTTLE_SECS) continue;

    const body = `Progress (auto):\n${messages.map(m => `- ${m}`).join('\n')}`;

    try {
      const result = await commentOnIssue(issueId, body);
      if (result.success) {
        commented.push({ identifier: issueId, commitCount: messages.length });
        lastCommentTime.set(issueId, now);
      } else {
        errors.push({ identifier: issueId, error: result.error ?? 'Unknown' });
      }
    } catch (e: any) {
      errors.push({ identifier: issueId, error: e.message });
    }
  }

  return { commented, errors };
}

// ---------------------------------------------------------------------------
// 5. Project health auto-pilot
// ---------------------------------------------------------------------------

/**
 * Check all projects and auto-update health/status based on issue states.
 */
export async function autoProjectHealth(): Promise<Array<{ projectName: string; action: string }>> {
  if (!isConfigured()) return [];

  const actions: Array<{ projectName: string; action: string }> = [];

  try {
    const projects = await getProjects();

    for (const project of projects) {
      if (project.state === 'completed' || project.state === 'canceled') continue;

      try {
        const issues = await getProjectIssues(project.id);
        if (issues.length === 0) continue;

        const allDone = issues.every(i => i.statusType === 'completed' || i.statusType === 'cancelled');
        const anyStuck = issues.some(i => {
          if (i.statusType !== 'started') return false;
          // Check if the issue has a due date that's passed
          if (i.dueDate && new Date(i.dueDate) < new Date()) return true;
          return false;
        });

        if (allDone && project.state !== 'completed') {
          // All issues done → complete the project
          const totalIssues = issues.length;
          const body = `All ${totalIssues} issue(s) completed. Project finished.`;

          await updateProject(project.id, { state: 'completed' });
          await createProjectUpdate(project.id, body, 'onTrack');
          actions.push({ projectName: project.name, action: `completed (all ${totalIssues} issues done)` });
        } else if (anyStuck) {
          // Overdue issues → check current health
          const updates = await getProjectUpdates(project.id, 1);
          const currentHealth = updates[0]?.health ?? 'onTrack';

          if (currentHealth !== 'atRisk' && currentHealth !== 'offTrack') {
            const overdueCount = issues.filter(i =>
              i.statusType === 'started' && i.dueDate && new Date(i.dueDate) < new Date()
            ).length;
            const body = `${overdueCount} issue(s) are past their due date. Flagging as at risk.`;

            await createProjectUpdate(project.id, body, 'atRisk');
            actions.push({ projectName: project.name, action: `flagged at risk (${overdueCount} overdue)` });
          }
        }
      } catch {
        // Skip projects we can't read
      }
    }
  } catch {
    // Linear API error
  }

  return actions;
}
