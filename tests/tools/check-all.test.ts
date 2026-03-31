import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../src/tools/get-team-activity.js');
vi.mock('../../src/tools/get-project-context.js');
vi.mock('../../src/tools/check-conflicts.js');

import { getTeamActivity } from '../../src/tools/get-team-activity.js';
import { getProjectContext } from '../../src/tools/get-project-context.js';
import { checkConflicts } from '../../src/tools/check-conflicts.js';
import { checkAll } from '../../src/tools/check-all.js';

const mockGetTeamActivity = vi.mocked(getTeamActivity);
const mockGetProjectContext = vi.mocked(getProjectContext);
const mockCheckConflicts = vi.mocked(checkConflicts);

beforeEach(() => {
  vi.resetAllMocks();

  mockGetTeamActivity.mockReturnValue([]);
  mockGetProjectContext.mockReturnValue({ files: [], total_files: 0, truncated: false });
  mockCheckConflicts.mockReturnValue({ conflicts: [], summary: 'No potential conflicts detected across active branches.' });
});

describe('checkAll', () => {
  it('returns combined results from all three tools', () => {
    const activity = [
      {
        name: 'Alice',
        active_branches: ['origin/feat/auth'],
        work_areas: ['src/auth'],
        recent_files: ['src/auth/login.ts'],
        last_active: 1000,
        recent_commits: [{ message: 'feat: login', timestamp: 1000 }],
      },
    ];
    const context = {
      files: [{ path: 'README.md', content: '# Hello' }],
      total_files: 1,
      truncated: false,
    };
    const conflicts = {
      conflicts: [
        {
          file: 'src/shared.ts',
          branches: [{ branch: 'origin/feat/a', author: 'Alice' }],
          local: true,
          severity: 'low' as const,
        },
      ],
      summary: '1 file(s) at risk of conflict (0 high severity).',
    };

    mockGetTeamActivity.mockReturnValue(activity);
    mockGetProjectContext.mockReturnValue(context);
    mockCheckConflicts.mockReturnValue(conflicts);

    const result = checkAll({});

    expect(result.team_activity).toEqual(activity);
    expect(result.project_context).toEqual(context);
    expect(result.conflicts).toEqual(conflicts);
  });

  it('passes since param to getTeamActivity, defaults to 24h', () => {
    checkAll({});
    expect(mockGetTeamActivity).toHaveBeenCalledWith({ since: '24h' });

    checkAll({ since: '7d' });
    expect(mockGetTeamActivity).toHaveBeenCalledWith({ since: '7d' });
  });

  it('calls getProjectContext with no arguments', () => {
    checkAll({});
    expect(mockGetProjectContext).toHaveBeenCalledWith({});
  });

  it('calls checkConflicts with no arguments', () => {
    checkAll({});
    expect(mockCheckConflicts).toHaveBeenCalledWith();
  });

  it('returns empty results when all tools return empty', () => {
    const result = checkAll({});

    expect(result.team_activity).toEqual([]);
    expect(result.project_context.files).toEqual([]);
    expect(result.project_context.total_files).toBe(0);
    expect(result.conflicts.conflicts).toEqual([]);
  });
});
