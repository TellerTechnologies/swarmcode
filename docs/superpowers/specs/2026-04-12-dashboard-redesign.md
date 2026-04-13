# Dashboard Redesign: Kanban Board, Team Activity & Team Filtering

**Date**: 2026-04-12
**Status**: Draft

## Problem

The current Branch Timeline panel shows a 48-hour window of commit dots per branch. In practice this is dominated by dependabot dependency bumps and provides no actionable information. The existing Team Activity panel is a basic list of developers and their recent commits. The Linear Issues panel is a flat grouped list. None of these panels answer the two key dashboard questions: "who's actively working right now?" and "what meaningful progress happened recently?"

Additionally, the dashboard mixes all Linear teams together with no way to filter by team.

## Goals

1. Replace the Branch Timeline with a **Linear kanban board** — the primary dashboard panel
2. Rebuild Team Activity as a **people grid + event feed** combining git and Linear signals
3. Add a **team dropdown** in the header to filter Linear data across the dashboard
4. Restyle **Project Context** with better typography and collapsible sections
5. Remove the standalone Linear Issues panel (subsumed by the kanban)

## Non-Goals

- Drag-and-drop card movement on the kanban (read-only view of Linear state)
- Real-time websocket connections to Linear (continue polling via SSE at 30s intervals)
- Modifying the Conflict Radar panel

---

## Dashboard Layout

All panels are full-width, stacked vertically:

```
+------------------------------------------------------------------+
| Header: status dot | repo name | last updated    [Team: ENG v]  |
+------------------------------------------------------------------+
| KANBAN BOARD                                                      |
| Backlog      | In Progress  | In Review    | Done                |
| [card]       | [card]       | [card]       | [card]              |
| [card]       | [card]       |              | [card]              |
| [card]       |              |              |                     |
+------------------------------------------------------------------+
| TEAM ACTIVITY                                                     |
| People Grid:  [Alex: Active] [Sam: Idle] [Bot: Offline]          |
| Event Feed:   commit, merge, status change, commit, ...          |
+------------------------------------------------------------------+
| CONFLICT RADAR                                                    |
| (unchanged)                                                       |
+------------------------------------------------------------------+
| PROJECT CONTEXT                                                   |
| (restyled: better typography, collapsible sections, syntax hl)    |
+------------------------------------------------------------------+
```

### Removed Panels

- **Branch Timeline** — replaced by Kanban Board
- **Linear Issues** — replaced by Kanban Board

---

## 1. Team Dropdown

**Location**: Right side of the header bar, inline with existing status/repo info.

**Behavior**:
- Populated from `getTeams()` on initial load
- Default option: "All Teams" (no filter)
- Selection persisted in `localStorage` under key `swarmcode-dashboard-team`
- On change: reconnects SSE with `?team=<key>` query param
- Filters: kanban board issues, Linear-linked data in the activity feed
- Does NOT filter: git-only events in the activity feed, conflict radar, project context

**Backend**:
- SSE endpoint accepts optional `team` query param: `GET /events?team=ENG`
- Passed through to `getLinearData(teamKey)` which already supports `overrideTeamKey`
- Teams list included in the SSE payload (or fetched once via `/api/teams`)

---

## 2. Kanban Board

### Columns

| Column | Linear Status Types | Notes |
|--------|-------------------|-------|
| Backlog | `backlog`, `unstarted` | Default landing for new issues |
| In Progress | `started` | Actively being worked on |
| In Review | Status name contains "review" (case-insensitive) | Covers custom workflow states |
| Done | `completed` | Limited to last 7 days |

### Card Layout (Rich)

```
+----------------------------------------+
| [priority dot] ENG-142           [>]   |
| Fix auth token refresh on expiry       |
|                                        |
| @Alex Johnson                          |
| [bug] [auth]                           |
| Due: Apr 15  |  Est: 3pts  | feat/... |
+----------------------------------------+
```

**Card fields**:
- **Priority indicator**: colored dot (urgent=red, high=orange, medium=yellow, low=blue, none=gray)
- **Identifier**: e.g. `ENG-142`, displayed prominently
- **Title**: issue title, truncated with ellipsis after 2 lines
- **Assignee**: name, or "Unassigned" in muted text
- **Labels**: rendered as small colored pills (use label color from Linear if available)
- **Due date**: displayed if set, red text if overdue
- **Estimate**: displayed if set, as points
- **Branch name**: displayed if set, truncated, monospace font
- **Click action**: entire card is clickable, opens `issue.url` in a new tab

### Card Sorting

Within each column, cards are sorted by:
1. Priority (urgent first, descending)
2. Updated date (most recent first)

### Column Behavior

- Each column shows a count badge in the header: "In Progress (4)"
- Columns have a max visible height with vertical scroll if overflow
- Done column only shows issues completed within the last 7 days

### Data Source Changes

Current `getLinearData()` filter excludes `completed` status. This needs to change:

```typescript
// Add completed issues from last 7 days
const completedFilter = {
  state: { type: { eq: 'completed' } },
  completedAt: { gte: sevenDaysAgo.toISOString() },
};
```

The `statusType` field on `LinearIssue` already exists and maps directly to column assignment. For "In Review" detection, use `issue.status` (the human-readable name) since this is a custom workflow state name, not a status type.

---

## 3. Team Activity (Rebuilt)

Replaces the old Team Activity panel. Two sections stacked vertically.

### People Grid (Top)

One compact card per developer. Developers included if they have commits in the last 7 days OR an "In Progress" Linear issue.

```
+---------------------------+
| Alex Johnson       Active |
| ENG-142: Fix auth token.. |
| Last commit: 3m ago       |
+---------------------------+
```

**Card fields**:
- **Name**: developer name
- **Status indicator**: colored badge
  - **Active** (green): commit within 30 minutes OR in-progress Linear issue with commit within 2 hours
  - **Idle** (yellow): in-progress Linear issue but no recent commits (>2 hours)
  - **Offline** (gray): no in-progress issue and no recent commits
- **Current issue**: identifier + title of their "In Progress" Linear issue, or "No active issue" in muted text
- **Last commit**: relative timestamp of most recent commit ("3m ago", "2h ago", "yesterday")

**Sorting**: Active first, then Idle, then Offline. Within each group, by last commit time (most recent first).

**Filtering by dependabot**: Exclude bot accounts (author containing `[bot]` or `dependabot`) from the people grid.

### Event Feed (Bottom)

Chronological list of recent events, newest first.

**Event types**:

| Event | Icon | Format |
|-------|------|--------|
| Commit pushed | `git-commit` | **Alex** pushed `a1b2c3d` to `feat/auth` — "Fix token refresh" |
| Branch created | `git-branch` | **Alex** created branch `feat/auth` |
| Merge to main | `git-merge` | **Alex** merged `feat/auth` into `main` |
| Linear status change | `arrow-right` | **ENG-142** moved to **In Review** by **Alex** |

**Constraints**:
- Last 48 hours
- Capped at 25 most recent events
- Exclude dependabot/bot events
- Git events always shown; Linear events filtered by team dropdown

**Data source**:
- Git events: derived from existing `getDashboardActivity()` data (commits, branches)
- Linear events: not currently tracked. Two options:
  - **Option A**: Diff Linear issue statuses between SSE ticks (lightweight, no new API calls, but misses changes between ticks)
  - **Option B**: Query Linear activity log API (accurate, but additional API call)
  - **Recommendation**: Option A for v1. Compare current issue statuses against previous tick's snapshot. If an issue's status changed, emit a status-change event. Simple and free.

---

## 4. Project Context (Restyled)

Same tabbed content, improved presentation:

- **Typography**: Use a readable sans-serif for prose, monospace for code. Increase line height. Add comfortable padding.
- **Headings**: Styled with clear visual hierarchy (size, weight, subtle bottom border)
- **Code blocks**: Syntax-highlighted using a dark theme consistent with the dashboard. Language detection from fenced code block markers.
- **Collapsible sections**: Each H2 section within a doc becomes collapsible (click to toggle). Default: expanded for short docs, collapsed for docs over ~50 lines.
- **Tab styling**: More prominent active tab indicator, muted inactive tabs

Implementation: Apply CSS-only improvements to the existing markdown rendering. Use a lightweight syntax highlighter (e.g., Prism.js via CDN or inline a minimal highlighter). Collapsible sections via `<details>`/`<summary>` elements generated during markdown-to-HTML conversion.

---

## 5. Backend Changes Summary

### SSE Endpoint (`/events`)

- Accept `?team=<key>` query parameter
- Pass team key through to `getLinearData(teamKey)`
- Include `teams` list in initial SSE payload for dropdown population

### Data Shape Changes

```typescript
interface DashboardData {
  activity: DeveloperActivity[];    // existing, used for people grid + event feed
  conflicts: ConflictEntry[];       // unchanged
  branches: BranchTimelineEntry[];  // REMOVED
  linear: LinearData | null;        // existing, now includes completed issues
  context: ProjectContext;          // unchanged
  teams: LinearTeam[];              // NEW: for dropdown
  previousLinearSnapshot?: Map<string, string>; // internal: for status diff
}
```

### New: Completed Issues Fetch

Extend `getLinearData()` to also fetch recently completed issues (last 7 days) for the Done column. This requires a second query with `state: { type: { eq: 'completed' } }` filter plus a `completedAt` date filter.

### New: Status Change Detection

Server-side: maintain a `Map<issueId, statusName>` from the previous tick. On each tick, diff against current statuses. Include detected changes as a `statusChanges` array in the SSE payload:

```typescript
interface StatusChange {
  issueIdentifier: string;
  issueTitle: string;
  fromStatus: string;
  toStatus: string;
  actor: string | null;  // assignee as proxy if Linear activity API not used
  timestamp: number;
}
```

---

## 6. Frontend Changes Summary

### Removed
- `renderTimeline()` function and all Branch Timeline CSS
- `renderLinear()` function and all Linear Issues CSS

### Modified
- `renderActivity()` → complete rewrite as people grid + event feed
- `renderContext()` → add collapsible sections, syntax highlighting, improved typography
- Header → add team dropdown element and change handler

### Added
- `renderKanban()` — new function for the kanban board
- Team dropdown logic (localStorage persistence, SSE reconnect on change)
- Status change event rendering in event feed

---

## 7. Testing

- Verify kanban columns correctly map Linear status types
- Verify team dropdown filters kanban and Linear activity events
- Verify Done column only shows last 7 days
- Verify people grid correctly calculates active/idle/offline from git + Linear signals
- Verify event feed excludes bot accounts
- Verify project context collapsible sections and syntax highlighting render correctly
- Verify `localStorage` persistence of team selection across page refreshes
- Verify SSE reconnects with correct team param on dropdown change
