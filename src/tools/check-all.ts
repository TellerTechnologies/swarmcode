import type { CheckAllResult } from '../types.js';
import { getTeamActivity } from './get-team-activity.js';
import { getProjectContext } from './get-project-context.js';
import { checkConflicts } from './check-conflicts.js';

export function checkAll(params: { since?: string }): CheckAllResult {
  const since = params.since ?? '24h';

  const team_activity = getTeamActivity({ since });
  const project_context = getProjectContext({});
  const conflicts = checkConflicts();

  return { team_activity, project_context, conflicts };
}
