# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Branch Timeline and Linear Issues panels with a Linear kanban board and rebuilt Team Activity panel, add team filtering, and restyle Project Context.

**Architecture:** The dashboard is a single-file HTML frontend (`src/dashboard/index.html`) served by a Node HTTP server (`src/dashboard/server.ts`) with SSE updates every 30s. Backend gathers git data via `src/git.ts` and Linear data via `src/linear.ts`. All changes are in these 4 files plus `src/types.ts`.

**Tech Stack:** TypeScript, vanilla HTML/CSS/JS (no framework), SSE, Linear SDK

**Spec:** `docs/superpowers/specs/2026-04-12-dashboard-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/linear.ts` | Modify | Add `getLinearDataForDashboard()` that includes completed issues + label colors |
| `src/dashboard/server.ts` | Modify | Add team param to SSE, teams endpoint, status change detection, remove `getBranchTimeline()` |
| `src/dashboard/index.html` | Modify | Replace timeline+linear panels with kanban, rebuild activity, restyle context, add team dropdown |
| `src/types.ts` | Modify | Add `StatusChange` interface |

---

### Task 1: Extend Linear Data for Dashboard (Backend)

**Files:**
- Modify: `src/linear.ts:364-401` (getLinearData)
- Modify: `src/linear.ts:14-31` (LinearIssue interface)

- [ ] **Step 1: Add label colors to LinearIssue**

In `src/linear.ts`, update the `LinearIssue` interface to include label objects with colors instead of plain strings:

```typescript
export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  assignee: string | null;
  assigneeId: string | null;
  status: string;
  statusType: string;
  priority: number;
  branchName: string;
  url: string;
  labels: string[];
  labelDetails: Array<{ name: string; color: string }>;  // NEW
  dueDate: string | null;
  estimate: number | null;
  parentId: string | null;
}
```

Update `toLinearIssue()` to populate `labelDetails`:

```typescript
async function toLinearIssue(issue: Awaited<ReturnType<typeof lookupIssue>>): Promise<LinearIssue> {
  const [state, assignee, labelsConn] = await Promise.all([
    issue.state,
    issue.assignee,
    issue.labels(),
  ]);

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? null,
    assignee: assignee?.name ?? null,
    assigneeId: issue.assigneeId ?? null,
    status: state?.name ?? 'Unknown',
    statusType: state?.type ?? 'unstarted',
    priority: issue.priority ?? 0,
    branchName: issue.branchName ?? '',
    url: issue.url ?? '',
    labels: labelsConn.nodes.map(l => l.name),
    labelDetails: labelsConn.nodes.map(l => ({ name: l.name, color: l.color })),
    dueDate: issue.dueDate ?? null,
    estimate: issue.estimate ?? null,
    parentId: issue.parentId ?? null,
  };
}
```

- [ ] **Step 2: Create `getLinearDataForDashboard()` that includes completed issues**

Add a new function below `getLinearData()` in `src/linear.ts`:

```typescript
/** Fetch issues for dashboard — includes recently completed (last 7 days). */
export async function getLinearDataForDashboard(overrideTeamKey?: string): Promise<LinearData | null> {
  if (!process.env.SWARMCODE_LINEAR_API_KEY) return null;

  const client = getClient();
  const teamKey = overrideTeamKey ?? process.env.SWARMCODE_LINEAR_TEAM ?? null;

  // Open issues
  const openFilter: Record<string, unknown> = {
    state: { type: { in: ['triage', 'backlog', 'unstarted', 'started'] } },
  };
  if (teamKey) {
    openFilter.team = { key: { eq: teamKey } };
  }

  const openConn = await client.issues({
    filter: openFilter as never,
    first: 50,
    orderBy: 'updatedAt' as never,
  });

  // Recently completed issues (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const completedFilter: Record<string, unknown> = {
    state: { type: { eq: 'completed' } },
    completedAt: { gte: sevenDaysAgo },
  };
  if (teamKey) {
    completedFilter.team = { key: { eq: teamKey } };
  }

  const completedConn = await client.issues({
    filter: completedFilter as never,
    first: 20,
    orderBy: 'updatedAt' as never,
  });

  const allIssues = [...openConn.nodes, ...completedConn.nodes];
  const issues = await Promise.all(allIssues.map(toLinearIssue));

  // Fetch active cycle if team is specified
  let cycle: LinearCycle | null = null;
  if (teamKey) {
    try {
      const teams = await getTeams();
      const team = teams.find(t => t.key === teamKey);
      if (team) {
        const cycles = await getCycles(team.id);
        cycle = cycles.active;
      }
    } catch {
      // Cycle fetch is optional
    }
  }

  return { issues, cycle, team: teamKey };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to linear.ts changes.

- [ ] **Step 4: Commit**

```bash
git add src/linear.ts
git commit -m "feat(dashboard): extend Linear data with label colors and completed issues"
```

---

### Task 2: Add StatusChange Type and Backend Wiring (Server)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/dashboard/server.ts`

- [ ] **Step 1: Add StatusChange interface to types**

Add to `src/types.ts`:

```typescript
export interface StatusChange {
  issueIdentifier: string;
  issueTitle: string;
  fromStatus: string;
  toStatus: string;
  actor: string | null;
  timestamp: number;
}
```

- [ ] **Step 2: Update DashboardData interface in server.ts**

In `src/dashboard/server.ts`, update the imports and interfaces:

```typescript
import { getLinearDataForDashboard, getTeams, isConfigured as linearConfigured, type LinearData, type LinearTeam } from '../linear.js';
import type { ConflictReport, ProjectContextResult, GitCommit, StatusChange } from '../types.js';
```

Replace the `DashboardData` interface:

```typescript
export interface DashboardData {
  activity: DashboardAuthor[];
  conflicts: ConflictReport;
  context: ProjectContextResult;
  linear: LinearData | null;
  teams: LinearTeam[];
  statusChanges: StatusChange[];
  repo: string;
  timestamp: number;
}
```

Remove the `BranchTimelineEntry` interface entirely (lines 23-31) and the `getBranchTimeline()` function entirely (lines 119-166).

- [ ] **Step 3: Add status change detection**

Add above the `fetchLinearIfNeeded` function in `src/dashboard/server.ts`:

```typescript
// Track Linear issue statuses between ticks for change detection
let previousStatuses = new Map<string, string>();

function detectStatusChanges(issues: LinearData['issues']): StatusChange[] {
  const changes: StatusChange[] = [];
  const currentStatuses = new Map<string, string>();

  for (const issue of issues) {
    currentStatuses.set(issue.id, issue.status);

    const prev = previousStatuses.get(issue.id);
    if (prev && prev !== issue.status) {
      changes.push({
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        fromStatus: prev,
        toStatus: issue.status,
        actor: issue.assignee,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
  }

  previousStatuses = currentStatuses;
  return changes;
}
```

- [ ] **Step 4: Update `fetchLinearIfNeeded` to use dashboard variant and accept team param**

Replace the `fetchLinearIfNeeded` function:

```typescript
let cachedLinearTeam: string | undefined;

async function fetchLinearIfNeeded(teamKey?: string): Promise<LinearData | null> {
  if (!linearConfigured()) return null;

  const now = Date.now() / 1000;
  const teamChanged = teamKey !== cachedLinearTeam;
  if (!teamChanged && now - linearFetchedAt < LINEAR_STALENESS_SECS) return cachedLinear;

  try {
    cachedLinear = await getLinearDataForDashboard(teamKey);
    cachedLinearTeam = teamKey;
    linearFetchedAt = now;
  } catch (err: any) {
    console.error(`[swarmcode] Linear fetch failed: ${err.message}`);
  }

  return cachedLinear;
}
```

- [ ] **Step 5: Add teams caching**

Add below the Linear cache variables:

```typescript
let cachedTeams: LinearTeam[] = [];
let teamsFetchedAt = 0;

async function fetchTeamsIfNeeded(): Promise<LinearTeam[]> {
  if (!linearConfigured()) return [];

  const now = Date.now() / 1000;
  if (now - teamsFetchedAt < 300) return cachedTeams; // refresh every 5 min

  try {
    cachedTeams = await getTeams();
    teamsFetchedAt = now;
  } catch (err: any) {
    console.error(`[swarmcode] Teams fetch failed: ${err.message}`);
  }

  return cachedTeams;
}
```

- [ ] **Step 6: Update `getAllData` to accept team param and remove branches**

Replace the `getAllData` function:

```typescript
async function getAllData(teamKey?: string): Promise<DashboardData> {
  git.ensureFresh();

  const repoRoot = git.getRepoRoot() ?? process.cwd();
  const repo = repoRoot.split('/').pop() ?? 'unknown';

  const linear = await fetchLinearIfNeeded(teamKey);
  const teams = await fetchTeamsIfNeeded();
  const statusChanges = linear ? detectStatusChanges(linear.issues) : [];

  return {
    activity: getDashboardActivity(),
    conflicts: checkConflicts(),
    context: getProjectContext({}),
    linear,
    teams,
    statusChanges,
    repo,
    timestamp: Date.now(),
  };
}
```

- [ ] **Step 7: Update SSE endpoint to accept team query param**

Replace the `if (url === '/events')` block in `handleRequest`:

```typescript
  if (url.startsWith('/events')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const teamKey = params.get('team') || undefined;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial data
    const initial = await getAllData(teamKey);
    res.write(`data: ${JSON.stringify(initial)}\n\n`);

    // Push updates every 30 seconds
    const interval = setInterval(async () => {
      try {
        const data = await getAllData(teamKey);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        clearInterval(interval);
      }
    }, 30_000);

    req.on('close', () => clearInterval(interval));
    return;
  }
```

Also update the `/api/all` handler:

```typescript
  if (url.startsWith('/api/all')) {
    const params = new URL(url, 'http://localhost').searchParams;
    const teamKey = params.get('team') || undefined;
    sendJson(res, await getAllData(teamKey));
    return;
  }
```

- [ ] **Step 8: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/dashboard/server.ts
git commit -m "feat(dashboard): add team filtering, status detection, remove branch timeline backend"
```

---

### Task 3: Team Dropdown and SSE Reconnect (Frontend)

**Files:**
- Modify: `src/dashboard/index.html:654-660` (header HTML)
- Modify: `src/dashboard/index.html:1016-1035` (connect function)

- [ ] **Step 1: Add dropdown CSS**

In `src/dashboard/index.html`, add after the `.header-meta` CSS rule (after line 77):

```css
  .header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .team-select {
    font-family: var(--font);
    font-size: 13px;
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
    outline: none;
  }

  .team-select:hover { border-color: var(--text-dim); }
  .team-select:focus { border-color: var(--blue); }
```

- [ ] **Step 2: Add dropdown to header HTML**

Replace the header section (lines 654-660):

```html
<header>
  <h1>
    <span class="status-dot" id="statusDot"></span>
    <span id="repoName">swarmcode</span>
  </h1>
  <div class="header-right">
    <select class="team-select" id="teamSelect" style="display:none">
      <option value="">All Teams</option>
    </select>
    <span class="header-meta" id="lastUpdate">Connecting...</span>
  </div>
</header>
```

- [ ] **Step 3: Add team dropdown logic and SSE reconnect**

Replace the `connect()` function and everything after it (lines 1016-1036):

```javascript
let currentEventSource = null;

function getSelectedTeam() {
  return localStorage.getItem('swarmcode-dashboard-team') || '';
}

function populateTeams(teams) {
  const select = document.getElementById('teamSelect');
  if (!teams || teams.length === 0) {
    select.style.display = 'none';
    return;
  }

  select.style.display = '';
  const saved = getSelectedTeam();

  // Keep "All Teams" option, replace the rest
  select.innerHTML = '<option value="">All Teams</option>' +
    teams.map(t => `<option value="${escHtml(t.key)}" ${t.key === saved ? 'selected' : ''}>${escHtml(t.name)} (${escHtml(t.key)})</option>`).join('');
}

function connect() {
  if (currentEventSource) {
    currentEventSource.close();
  }

  const dot = document.getElementById('statusDot');
  const team = getSelectedTeam();
  const url = team ? `/events?team=${encodeURIComponent(team)}` : '/events';
  const es = new EventSource(url);
  currentEventSource = es;

  es.onmessage = (event) => {
    dot.classList.remove('disconnected');
    try {
      const data = JSON.parse(event.data);
      populateTeams(data.teams);
      render(data);
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
    }
  };

  es.onerror = () => {
    dot.classList.add('disconnected');
    document.getElementById('lastUpdate').textContent = 'Reconnecting...';
  };
}

document.getElementById('teamSelect').addEventListener('change', (e) => {
  const value = e.target.value;
  localStorage.setItem('swarmcode-dashboard-team', value);
  connect(); // reconnect SSE with new team param
});

connect();
```

- [ ] **Step 4: Test manually**

Run: `npx tsx src/cli.ts dashboard --port 3001`

Open http://localhost:3001 and verify:
- Team dropdown appears if Linear is configured with multiple teams
- Selecting a team reconnects SSE
- "All Teams" works as default

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/index.html
git commit -m "feat(dashboard): add team dropdown with SSE reconnect"
```

---

### Task 4: Kanban Board (Frontend)

**Files:**
- Modify: `src/dashboard/index.html` (CSS, HTML structure, JS render function)

- [ ] **Step 1: Remove Branch Timeline CSS and HTML**

In `src/dashboard/index.html`:

Delete all Branch Timeline CSS (lines 303-445, from `/* Panel: Branch Timeline */` through `.no-branches`).

Delete all Linear Issues CSS (lines 533-637, from `/* Panel: Linear Issues */` through `.linear-priority.p4`).

Replace the timeline and linear HTML sections (lines 673-683):

```html
  <section class="panel" id="kanban">
    <div class="panel-title">Board <span class="count" id="kanbanCount">0</span></div>
    <div class="kanban-cycle" id="kanbanCycle"></div>
    <div class="kanban-board" id="kanbanBoard"></div>
  </section>
```

- [ ] **Step 2: Add Kanban CSS**

Add after the Conflict Radar CSS section:

```css
  /* Panel: Kanban Board */
  #kanban {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .kanban-cycle {
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .kanban-cycle strong { color: var(--text); }

  .kanban-board {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    min-height: 200px;
  }

  .kanban-column {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px;
    max-height: 600px;
    overflow-y: auto;
  }

  .kanban-column-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    background: var(--surface);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .kanban-column-count {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
  }

  .kanban-card {
    display: block;
    padding: 10px 12px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 8px;
    text-decoration: none;
    color: var(--text);
    transition: border-color 0.15s;
    cursor: pointer;
  }

  .kanban-card:hover { border-color: var(--text-dim); }
  .kanban-card:last-child { margin-bottom: 0; }

  .kanban-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .kanban-card-id {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--purple);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .priority-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }

  .priority-dot.urgent { background: var(--red); }
  .priority-dot.high { background: var(--orange); }
  .priority-dot.medium { background: var(--yellow); }
  .priority-dot.low { background: var(--blue); }
  .priority-dot.none { background: var(--text-dim); }

  .kanban-card-title {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
    margin-bottom: 8px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .kanban-card-assignee {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }

  .kanban-card-labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .kanban-label {
    font-size: 10px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 3px;
    color: #fff;
  }

  .kanban-card-footer {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--text-dim);
    flex-wrap: wrap;
  }

  .kanban-card-footer .overdue { color: var(--red); }

  .kanban-card-branch {
    font-family: var(--mono);
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kanban-empty {
    text-align: center;
    color: var(--text-dim);
    font-size: 12px;
    padding: 24px 8px;
  }

  @media (max-width: 900px) {
    .kanban-board {
      grid-template-columns: 1fr;
    }
  }
```

- [ ] **Step 3: Add `renderKanban()` function**

Remove the `renderTimeline()` function (lines 831-900), `renderLinear()` function (lines 905-956), `renderLinearIssue()` function (lines 958-971), and the `PRIORITY_LABELS`/`PRIORITY_CLASSES` constants (lines 902-903).

Add the kanban render function:

```javascript
const PRIORITY_NAMES = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };

function getKanbanColumn(issue) {
  if (issue.statusType === 'completed') return 'done';
  if (issue.statusType === 'started') {
    // Check if status name indicates review
    if (issue.status.toLowerCase().includes('review')) return 'review';
    return 'progress';
  }
  return 'backlog'; // backlog, unstarted, triage
}

function renderKanbanCard(issue) {
  const priorityClass = PRIORITY_NAMES[issue.priority] || 'none';
  const isOverdue = issue.dueDate && new Date(issue.dueDate) < new Date();
  const labels = issue.labelDetails || [];

  const dueDateStr = issue.dueDate
    ? new Date(issue.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return `
    <a class="kanban-card" href="${escHtml(issue.url)}" target="_blank" title="${escHtml(issue.title)}">
      <div class="kanban-card-header">
        <span class="kanban-card-id">
          <span class="priority-dot ${priorityClass}"></span>
          ${escHtml(issue.identifier)}
        </span>
      </div>
      <div class="kanban-card-title">${escHtml(issue.title)}</div>
      <div class="kanban-card-assignee">${issue.assignee ? escHtml(issue.assignee) : '<span style="opacity:0.5">Unassigned</span>'}</div>
      ${labels.length ? `<div class="kanban-card-labels">${labels.map(l =>
        `<span class="kanban-label" style="background:${escHtml(l.color)}">${escHtml(l.name)}</span>`
      ).join('')}</div>` : ''}
      <div class="kanban-card-footer">
        ${dueDateStr ? `<span class="${isOverdue ? 'overdue' : ''}">Due: ${dueDateStr}</span>` : ''}
        ${issue.estimate ? `<span>${issue.estimate}pts</span>` : ''}
        ${issue.branchName ? `<span class="kanban-card-branch">${escHtml(issue.branchName)}</span>` : ''}
      </div>
    </a>
  `;
}

function renderKanban(data) {
  const board = document.getElementById('kanbanBoard');
  const cycleEl = document.getElementById('kanbanCycle');

  if (!data || !data.issues || data.issues.length === 0) {
    document.getElementById('kanbanCount').textContent = '0';
    board.innerHTML = '<div class="kanban-empty" style="grid-column:1/-1;padding:48px">No issues found</div>';
    cycleEl.innerHTML = '';
    return;
  }

  document.getElementById('kanbanCount').textContent = data.issues.length;

  // Cycle info
  if (data.cycle) {
    const endDate = data.cycle.endsAt
      ? new Date(data.cycle.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    cycleEl.innerHTML = `<div class="kanban-cycle"><strong>${escHtml(data.cycle.name || 'Current Cycle')}</strong>${endDate ? ` — ends ${endDate}` : ''}</div>`;
  } else {
    cycleEl.innerHTML = '';
  }

  // Sort issues by priority (1=urgent first) then by updated
  const sorted = [...data.issues].sort((a, b) => {
    const pa = a.priority || 5;
    const pb = b.priority || 5;
    return pa - pb;
  });

  const columns = {
    backlog: sorted.filter(i => getKanbanColumn(i) === 'backlog'),
    progress: sorted.filter(i => getKanbanColumn(i) === 'progress'),
    review: sorted.filter(i => getKanbanColumn(i) === 'review'),
    done: sorted.filter(i => getKanbanColumn(i) === 'done'),
  };

  function renderColumn(title, issues) {
    return `
      <div class="kanban-column">
        <div class="kanban-column-header">
          ${title}
          <span class="kanban-column-count">${issues.length}</span>
        </div>
        ${issues.length ? issues.map(renderKanbanCard).join('') : '<div class="kanban-empty">No issues</div>'}
      </div>
    `;
  }

  board.innerHTML =
    renderColumn('Backlog', columns.backlog) +
    renderColumn('In Progress', columns.progress) +
    renderColumn('In Review', columns.review) +
    renderColumn('Done', columns.done);
}
```

- [ ] **Step 4: Update `render()` function**

Replace the `render()` function:

```javascript
function render(data) {
  window._lastData = data;
  document.getElementById('repoName').textContent = data.repo;
  document.getElementById('lastUpdate').textContent =
    'Updated ' + new Date(data.timestamp).toLocaleTimeString();

  renderKanban(data.linear);
  renderActivity(data.activity, data.linear, data.statusChanges);
  renderConflicts(data.conflicts);
  renderContext(data.context);
}
```

(The `renderActivity` signature change will be implemented in Task 5.)

- [ ] **Step 5: Update grid layout CSS**

Update the `.grid` CSS and panel grid positions. Replace:

```css
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto;
    gap: 1px;
    background: var(--border);
    min-height: calc(100vh - 57px);
  }
```

With:

```css
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto auto auto;
    gap: 1px;
    background: var(--border);
    min-height: calc(100vh - 57px);
  }
```

Update panel positions:

```css
  /* Panel: Team Activity */
  #activity { grid-column: 1 / -1; grid-row: 3; }

  /* Panel: Conflict Radar */
  #conflicts { grid-column: 1 / -1; grid-row: 4; }
```

Remove the separate `#context` grid-row override (the one at line 539-541 that sets `grid-row: 4`) and update the main `#context` rule:

```css
  /* Panel: Project Context */
  #context {
    grid-column: 1 / -1;
    grid-row: 5;
    max-height: 500px;
  }
```

Also update the responsive media query to include the new `#kanban` panel:

```css
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
    }
    #kanban, #activity, #conflicts, #context {
      grid-column: 1;
      grid-row: auto;
    }
    .kanban-board {
      grid-template-columns: 1fr;
    }
  }
```

- [ ] **Step 6: Remove the old `#linear` HTML section**

Ensure the old `<section class="panel" id="linear">` block is fully removed (it was replaced in Step 1 of this task by the kanban section).

- [ ] **Step 7: Test manually**

Run: `npx tsx src/cli.ts dashboard --port 3001`

Open http://localhost:3001 and verify:
- Kanban board renders with 4 columns
- Cards show all fields (identifier, priority dot, title, assignee, labels with colors, due date, estimate, branch)
- Cards are clickable and open Linear
- Overdue dates show in red
- Empty columns show "No issues"
- Board is responsive on narrow screens

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/index.html
git commit -m "feat(dashboard): replace branch timeline and linear list with kanban board"
```

---

### Task 5: Rebuild Team Activity Panel (Frontend)

**Files:**
- Modify: `src/dashboard/index.html` (CSS, HTML, JS)

- [ ] **Step 1: Replace Team Activity CSS**

Remove the old dev-card CSS (lines 116-218, from `/* Panel: Team Activity */` through `.dev-commits .commit-time`).

Add new Team Activity CSS:

```css
  /* Panel: Team Activity */
  #activity {
    grid-column: 1 / -1;
    grid-row: 3;
  }

  .activity-section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 16px 0 8px;
  }

  .activity-section-title:first-of-type { margin-top: 0; }

  /* People Grid */
  .people-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }

  .person-card {
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .person-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }

  .person-name {
    font-weight: 600;
    font-size: 14px;
  }

  .person-status {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 8px;
    border-radius: 10px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .person-status.active {
    background: rgba(63, 185, 80, 0.15);
    color: var(--green);
  }

  .person-status.idle {
    background: rgba(210, 153, 34, 0.15);
    color: var(--yellow);
  }

  .person-status.offline {
    background: rgba(139, 148, 158, 0.1);
    color: var(--text-dim);
  }

  .person-issue {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .person-issue .issue-id {
    font-family: var(--mono);
    color: var(--purple);
  }

  .person-commit-time {
    font-size: 11px;
    color: var(--text-dim);
  }

  /* Event Feed */
  .event-feed {
    max-height: 300px;
    overflow-y: auto;
  }

  .event-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
  }

  .event-item:last-child { border-bottom: none; }

  .event-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    font-size: 11px;
  }

  .event-icon.commit { color: var(--green); }
  .event-icon.merge { color: var(--purple); }
  .event-icon.branch { color: var(--blue); }
  .event-icon.status { color: var(--orange); }

  .event-text {
    flex: 1;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-text strong { color: var(--text); font-weight: 600; }

  .event-time {
    flex-shrink: 0;
    color: var(--text-dim);
    font-size: 11px;
  }
```

- [ ] **Step 2: Update the activity HTML section**

Replace the `<section class="panel" id="activity">` block:

```html
  <section class="panel" id="activity">
    <div class="panel-title">Team Activity <span class="count" id="activityCount">0</span></div>
    <div class="activity-section-title">People</div>
    <div class="people-grid" id="peopleGrid"></div>
    <div class="activity-section-title">Recent Events</div>
    <div class="event-feed" id="eventFeed"></div>
  </section>
```

- [ ] **Step 3: Replace `renderActivity()` function**

Remove the old `renderActivity()` function and replace with:

```javascript
function isBot(name) {
  return /\[bot\]|dependabot/i.test(name);
}

function getPresenceStatus(dev, linearIssues) {
  const now = Date.now() / 1000;
  const lastCommit = dev.last_active || 0;
  const timeSinceCommit = now - lastCommit;

  // Find their in-progress Linear issue
  const activeIssue = linearIssues.find(i =>
    i.statusType === 'started' &&
    !i.status.toLowerCase().includes('review') &&
    i.assignee === dev.name
  );

  if (timeSinceCommit < 1800 || (activeIssue && timeSinceCommit < 7200)) {
    return { status: 'active', issue: activeIssue };
  }
  if (activeIssue) {
    return { status: 'idle', issue: activeIssue };
  }
  return { status: 'offline', issue: null };
}

function renderActivity(activity, linear, statusChanges) {
  const issues = (linear && linear.issues) ? linear.issues : [];
  const peopleEl = document.getElementById('peopleGrid');
  const feedEl = document.getElementById('eventFeed');

  // Filter out bots
  const humans = activity.filter(d => !isBot(d.name));
  document.getElementById('activityCount').textContent = humans.length;

  if (humans.length === 0) {
    peopleEl.innerHTML = '<div class="empty-state">No team activity in the last 7 days</div>';
    feedEl.innerHTML = '';
    return;
  }

  // Build people cards with presence
  const people = humans.map(dev => ({
    ...dev,
    ...getPresenceStatus(dev, issues),
  }));

  // Sort: active > idle > offline, then by last_active
  const statusOrder = { active: 0, idle: 1, offline: 2 };
  people.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.last_active - a.last_active);

  peopleEl.innerHTML = people.map(p => `
    <div class="person-card">
      <div class="person-header">
        <span class="person-name">${escHtml(p.name)}</span>
        <span class="person-status ${p.status}">${p.status}</span>
      </div>
      <div class="person-issue">
        ${p.issue
          ? `<span class="issue-id">${escHtml(p.issue.identifier)}</span>: ${escHtml(p.issue.title)}`
          : '<span style="opacity:0.5">No active issue</span>'}
      </div>
      <div class="person-commit-time">Last commit: ${p.last_active ? timeAgo(p.last_active) : 'none'}</div>
    </div>
  `).join('');

  // Build event feed
  const events = [];

  // Git events from all humans
  for (const dev of humans) {
    for (const commit of (dev.recent_commits || [])) {
      // Detect merges to main
      const isMerge = /^Merge (branch|pull request)/i.test(commit.message);
      events.push({
        type: isMerge ? 'merge' : 'commit',
        actor: dev.name,
        text: isMerge
          ? `merged into main — "${escHtml(commit.message.slice(0, 60))}"`
          : `pushed <code>${commit.hash}</code> — "${escHtml(commit.message.slice(0, 60))}"`,
        timestamp: commit.timestamp,
      });
    }
  }

  // Linear status changes
  for (const change of (statusChanges || [])) {
    events.push({
      type: 'status',
      actor: change.actor || 'Someone',
      text: `<strong>${escHtml(change.issueIdentifier)}</strong> moved to <strong>${escHtml(change.toStatus)}</strong>`,
      timestamp: change.timestamp,
    });
  }

  // Sort by timestamp descending, cap at 25
  events.sort((a, b) => b.timestamp - a.timestamp);
  const recentEvents = events.slice(0, 25);

  const iconMap = {
    commit: '<span class="event-icon commit">&#9679;</span>',
    merge: '<span class="event-icon merge">&#8634;</span>',
    branch: '<span class="event-icon branch">&#9745;</span>',
    status: '<span class="event-icon status">&#8594;</span>',
  };

  feedEl.innerHTML = recentEvents.length
    ? recentEvents.map(e => `
      <div class="event-item">
        ${iconMap[e.type] || ''}
        <span class="event-text"><strong>${escHtml(e.actor)}</strong> ${e.text}</span>
        <span class="event-time">${timeAgo(e.timestamp)}</span>
      </div>
    `).join('')
    : '<div class="empty-state">No recent events</div>';
}
```

- [ ] **Step 4: Test manually**

Run: `npx tsx src/cli.ts dashboard --port 3001`

Open http://localhost:3001 and verify:
- People grid shows developer cards with active/idle/offline status
- Bots (dependabot) are filtered out
- Each card shows current Linear issue if applicable
- Event feed shows commits chronologically
- Status change events appear when Linear issues move between states

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/index.html
git commit -m "feat(dashboard): rebuild team activity as people grid + event feed"
```

---

### Task 6: Restyle Project Context (Frontend)

**Files:**
- Modify: `src/dashboard/index.html` (CSS, JS)

- [ ] **Step 1: Update Project Context CSS**

Replace the existing context CSS (from `/* Panel: Project Context */` through `.context-content input[type="checkbox"]`):

```css
  /* Panel: Project Context */
  #context {
    grid-column: 1 / -1;
    grid-row: 5;
    max-height: 600px;
  }

  .context-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    background: var(--surface);
    border-radius: var(--radius);
    padding: 4px;
    border: 1px solid var(--border);
  }

  .context-tab {
    font-family: var(--mono);
    font-size: 12px;
    padding: 6px 14px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .context-tab:hover { background: var(--bg); color: var(--text); }
  .context-tab.active {
    background: var(--blue);
    color: #fff;
    font-weight: 600;
  }

  .context-content {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px 32px;
    font-size: 14px;
    line-height: 1.8;
    overflow: auto;
    max-height: 450px;
  }

  /* Markdown rendering — improved typography */
  .context-content h1 {
    font-size: 22px;
    font-weight: 700;
    margin: 20px 0 10px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--border);
  }
  .context-content h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 18px 0 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .context-content h3 { font-size: 15px; font-weight: 600; margin: 14px 0 6px; }
  .context-content h1:first-child, .context-content h2:first-child { margin-top: 0; }
  .context-content p { margin: 10px 0; }
  .context-content ul, .context-content ol { margin: 10px 0; padding-left: 28px; }
  .context-content li { margin: 4px 0; }
  .context-content code {
    font-family: var(--mono);
    font-size: 13px;
    background: var(--bg);
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  .context-content pre {
    background: var(--bg);
    padding: 16px 20px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 12px 0;
    border: 1px solid var(--border);
  }
  .context-content pre code { background: none; padding: 0; border: none; }
  .context-content a { color: var(--blue); text-decoration: none; }
  .context-content a:hover { text-decoration: underline; }
  .context-content table { border-collapse: collapse; margin: 12px 0; width: 100%; }
  .context-content th, .context-content td {
    border: 1px solid var(--border);
    padding: 8px 14px;
    text-align: left;
    font-size: 13px;
  }
  .context-content th { background: var(--bg); font-weight: 600; }
  .context-content input[type="checkbox"] { margin-right: 6px; }

  /* Collapsible sections */
  .context-content details {
    margin: 12px 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .context-content details summary {
    padding: 10px 16px;
    background: var(--bg);
    cursor: pointer;
    font-weight: 600;
    font-size: 16px;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .context-content details summary::before {
    content: '▶';
    font-size: 10px;
    transition: transform 0.15s;
  }

  .context-content details[open] summary::before {
    transform: rotate(90deg);
  }

  .context-content details > :not(summary) {
    padding: 0 16px;
  }
```

- [ ] **Step 2: Update `renderMarkdown()` to generate collapsible sections**

Replace the `renderMarkdown()` function:

```javascript
function renderMarkdown(md) {
  let html = md
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code>${escHtml(code.trim())}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers — h2s become collapsible sections
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<!--H2_SPLIT--><details open><summary>$1</summary>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold & italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Checkboxes
    .replace(/^- \[x\] (.+)$/gm, '<li><input type="checkbox" checked disabled> $1</li>')
    .replace(/^- \[ \] (.+)$/gm, '<li><input type="checkbox" disabled> $1</li>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Table rows
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      const cells = row.split('|').map(c => c.trim());
      return '<tr>' + cells.map(c =>
        /^[-:]+$/.test(c) ? '' : `<td>${c}</td>`
      ).join('') + '</tr>';
    })
    // Paragraphs (double newline)
    .replace(/\n\n+/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br>');

  // Close open details sections
  const splitParts = html.split('<!--H2_SPLIT-->');
  if (splitParts.length > 1) {
    // First part is before any h2
    html = splitParts[0];
    for (let i = 1; i < splitParts.length; i++) {
      // Close previous details if not the first
      if (i > 1) html += '</details>';
      html += splitParts[i];
    }
    html += '</details>';
  }

  // Wrap lists
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/g, '');
  // Wrap tables
  html = html.replace(/(<tr>[\s\S]*?<\/tr>)/g, '<table>$1</table>');
  html = html.replace(/<\/table>\s*<table>/g, '');
  // Remove empty separator rows
  html = html.replace(/<tr><\/tr>/g, '');

  return `<p>${html}</p>`;
}
```

- [ ] **Step 3: Test manually**

Run: `npx tsx src/cli.ts dashboard --port 3001`

Open http://localhost:3001 and verify:
- Project Context has improved typography (bigger headings, better spacing)
- Tabs have a more polished pill-style look
- Code blocks have visible borders
- H2 sections are collapsible with triangle indicators
- Sections expand/collapse on click

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/index.html
git commit -m "feat(dashboard): restyle project context with better typography and collapsible sections"
```

---

### Task 7: Final Cleanup and Integration Testing

**Files:**
- Modify: `src/dashboard/index.html` (if needed)
- Modify: `src/dashboard/server.ts` (if needed)

- [ ] **Step 1: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Full integration test**

Run: `npx tsx src/cli.ts dashboard --port 3001`

Test the complete flow:
1. Dashboard loads with all 4 panels (Kanban, Team Activity, Conflict Radar, Project Context)
2. Team dropdown appears and filters data on change
3. Kanban cards are clickable and show all fields
4. People grid shows correct presence status
5. Event feed updates every 30s
6. Project Context sections are collapsible
7. Responsive layout works on narrow screens

- [ ] **Step 3: Remove any dead CSS or JS references**

Search `index.html` for any remaining references to `timeline`, `renderTimeline`, `renderLinear`, `#linear`, `branchCount`, `.dev-card`, etc. Remove any stale references.

- [ ] **Step 4: Commit cleanup**

```bash
git add -A
git commit -m "chore(dashboard): clean up dead timeline and linear list references"
```
