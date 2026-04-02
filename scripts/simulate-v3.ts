/**
 * simulate-v3.ts
 *
 * Full v3 simulation: two AI agents coordinate on a project using swarmcode's
 * git tools and Linear-style branch naming conventions with hooks.
 *
 * Demonstrates:
 * 1. start_session (combined check_all + auto-push)
 * 2. Branch naming convention (feat/eng-XXX-description)
 * 3. prepare-commit-msg hook (auto-prepends issue ID)
 * 4. post-commit hook (first commit → moves issue to In Progress)
 * 5. check_path / search_code coordination
 * 6. Conflict detection
 * 7. Agent completing work (complete_issue)
 *
 * Since we can't call the real Linear API in a simulation, we mock the
 * Linear parts and focus on the git coordination + hook behavior.
 *
 * Run with: npx tsx scripts/simulate-v3.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { checkAll } from '../src/tools/check-all.js';
import { checkPath } from '../src/tools/check-path.js';
import { searchTeamCode } from '../src/tools/search-team-code.js';
import { checkConflicts } from '../src/tools/check-conflicts.js';
import { getDeveloper } from '../src/tools/get-developer.js';
import { enableAutoPush, disableAutoPush } from '../src/tools/auto-push.js';
import { extractIssueId, prependIssueId, messageHasIssueId } from '../src/branch-parser.js';

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function writeFile(repoDir: string, filePath: string, content: string): void {
  const fullPath = join(repoDir, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

/**
 * Commit with automatic issue ID prepending (simulates prepare-commit-msg hook).
 */
function commitAs(
  dir: string,
  author: string,
  email: string,
  message: string,
  files: Record<string, string>,
): string {
  for (const [filePath, content] of Object.entries(files)) {
    writeFile(dir, filePath, content);
  }
  gitIn(dir, ['add', '-A']);

  // Simulate prepare-commit-msg hook: prepend issue ID from branch name
  let finalMessage = message;
  try {
    const branch = gitIn(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const issueId = extractIssueId(branch);
    if (issueId && !messageHasIssueId(message)) {
      finalMessage = prependIssueId(message, issueId);
    }
  } catch {
    // No HEAD yet (initial commit) — skip hook
  }

  gitIn(dir, [
    '-c', `user.name=${author}`,
    '-c', `user.email=${email}`,
    'commit', '-m', finalMessage,
  ]);

  return finalMessage;
}

/**
 * Simulate the post-commit hook: on first commit to a branch, report Linear would be updated.
 */
function simulatePostCommitHook(dir: string, mainBranch: string): string | null {
  const branch = gitIn(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const issueId = extractIssueId(branch);
  if (!issueId) return null;

  try {
    const count = gitIn(dir, ['rev-list', '--count', `origin/${mainBranch}..HEAD`]);
    if (parseInt(count, 10) === 1) {
      return issueId;
    }
  } catch {
    // No upstream yet
  }
  return null;
}

function banner(text: string): void {
  const line = '='.repeat(72);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  ${text}${RESET}`);
  console.log(`${BOLD}${line}${RESET}`);
}

function section(text: string): void {
  const line = '-'.repeat(72);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  ${text}${RESET}`);
  console.log(`${BOLD}${line}${RESET}\n`);
}

function tool(name: string, detail?: string): void {
  const extra = detail ? ` ${DIM}${detail}${RESET}` : '';
  console.log(`  ${YELLOW}[${name}]${RESET}${extra}`);
}

function hook(name: string, detail: string): void {
  console.log(`  ${MAGENTA}[hook: ${name}]${RESET} ${detail}`);
}

function info(msg: string): void {
  console.log(`  ${msg}`);
}

function result(msg: string): void {
  console.log(`    ${GREEN}${msg}${RESET}`);
}

function dim(msg: string): void {
  console.log(`    ${DIM}${msg}${RESET}`);
}

function warn(msg: string): void {
  console.log(`    ${RED}${msg}${RESET}`);
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Simulated Linear state (since we can't hit the real API)
// ---------------------------------------------------------------------------

interface SimIssue {
  identifier: string;
  title: string;
  status: string;
  assignee: string | null;
  branchName: string;
}

const linearState: SimIssue[] = [
  { identifier: 'TF-1', title: 'Define shared Task type', status: 'Todo', assignee: null, branchName: 'feat/tf-1-shared-task-type' },
  { identifier: 'TF-2', title: 'Build CRUD API for tasks', status: 'Todo', assignee: null, branchName: 'feat/tf-2-crud-api' },
  { identifier: 'TF-3', title: 'Build TaskList component', status: 'Todo', assignee: null, branchName: 'feat/tf-3-task-list' },
  { identifier: 'TF-4', title: 'Build TaskForm component', status: 'Todo', assignee: null, branchName: 'feat/tf-4-task-form' },
  { identifier: 'TF-5', title: 'Build App component', status: 'Todo', assignee: null, branchName: 'feat/tf-5-app-component' },
];

function simLinearGetIssues(): SimIssue[] {
  return linearState.filter(i => i.status !== 'Done');
}

function simLinearPickIssue(identifier: string, agent: string): SimIssue | null {
  const issue = linearState.find(i => i.identifier === identifier);
  if (!issue) return null;
  issue.status = 'In Progress';
  issue.assignee = agent;
  return issue;
}

function simLinearComplete(identifier: string): SimIssue | null {
  const issue = linearState.find(i => i.identifier === identifier);
  if (!issue) return null;
  issue.status = 'Done';
  return issue;
}

// ---------------------------------------------------------------------------
// File contents
// ---------------------------------------------------------------------------

const PLAN_MD = `# TaskFlow

## Team
- Alice: Backend (TF-1, TF-2)
- Bob: Frontend (TF-3, TF-4, TF-5)

## Rule
Bob imports Task from src/types.ts -- do NOT redefine it.
`;

const TYPES_TS = `export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done';
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
}
`;

const TASKS_TS = `import type { Task } from '../types.js';

const tasks: Map<string, Task> = new Map();

export function getAllTasks(): Task[] {
  return [...tasks.values()];
}

export function createTask(title: string, description: string): Task {
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    description,
    status: 'todo',
    assignee: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  tasks.set(task.id, task);
  return task;
}

export function updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Task | null {
  const task = tasks.get(id);
  if (!task) return null;
  Object.assign(task, updates, { updatedAt: Date.now() });
  return task;
}
`;

const ROUTER_TS = `import { Router } from 'express';
import { getAllTasks, createTask, updateTask } from './tasks.js';

export function setupRoutes(): Router {
  const router = Router();
  router.get('/tasks', (_req, res) => res.json(getAllTasks()));
  router.post('/tasks', (req, res) => {
    const task = createTask(req.body.title, req.body.description);
    res.status(201).json(task);
  });
  router.patch('/tasks/:id', (req, res) => {
    const task = updateTask(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  });
  return router;
}
`;

const TASKLIST_TSX = `import type { Task } from '../types.js';

interface TaskListProps {
  tasks: Task[];
  onSelect: (task: Task) => void;
}

export function TaskList({ tasks, onSelect }: TaskListProps) {
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <li key={task.id} onClick={() => onSelect(task)}>
          <span>{task.title}</span>
          <span>{task.status}</span>
        </li>
      ))}
    </ul>
  );
}
`;

const TASKFORM_TSX = `import { useState } from 'react';

interface TaskFormProps {
  onSubmit: (title: string, description: string) => void;
}

export function TaskForm({ onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(title, desc); setTitle(''); setDesc(''); }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" />
      <button type="submit">Create</button>
    </form>
  );
}
`;

const APP_TSX = `import { useState, useEffect } from 'react';
import type { Task } from '../types.js';
import { TaskList } from './TaskList.js';
import { TaskForm } from './TaskForm.js';

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    fetch('/api/tasks').then(r => r.json()).then(setTasks);
  }, []);

  async function handleCreate(title: string, description: string) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    });
    const task = await res.json();
    setTasks(prev => [...prev, task]);
  }

  return (
    <div>
      <h1>TaskFlow</h1>
      <TaskForm onSubmit={handleCreate} />
      <TaskList tasks={tasks} onSelect={() => {}} />
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const originalCwd = process.cwd();
  const base = mkdtempSync(join(tmpdir(), 'swarmcode-v3-sim-'));
  const bareDir = join(base, 'remote.git');
  const aliceDir = join(base, 'alice');
  const bobDir = join(base, 'bob');

  try {
    banner('SWARMCODE v3 SIMULATION');
    info('Two agents, five tickets, hooks + coordination, zero conflicts');
    console.log();

    // --- Setup ---
    info('Setting up shared repository...');
    mkdirSync(bareDir);
    gitIn(bareDir, ['init', '--bare', '--initial-branch=main']);
    mkdirSync(aliceDir);
    gitIn(aliceDir, ['init', '-b', 'main']);
    gitIn(aliceDir, ['remote', 'add', 'origin', bareDir]);
    gitIn(aliceDir, ['config', 'user.name', 'Alice']);
    gitIn(aliceDir, ['config', 'user.email', 'alice@example.com']);

    commitAs(aliceDir, 'Alice', 'alice@example.com', 'chore: initial project setup', {
      'README.md': '# TaskFlow\nA task management app built by AI agents.\n',
      'PLAN.md': PLAN_MD,
      'CLAUDE.md': '# CLAUDE.md\nUse swarmcode tools for coordination.\n',
    });
    gitIn(aliceDir, ['push', '-u', 'origin', 'main']);

    execFileSync('git', ['clone', bareDir, bobDir], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    gitIn(bobDir, ['config', 'user.name', 'Bob']);
    gitIn(bobDir, ['config', 'user.email', 'bob@example.com']);

    result('Repository ready (Alice + Bob clones)');

    // =====================================================================
    // ALICE: Session Start
    // =====================================================================

    section(`AGENT ${CYAN}ALICE${RESET}: Session Start`);

    process.chdir(aliceDir);

    tool('start_session');
    const aliceSession = checkAll({ since: '7d' });
    result(`Team: ${aliceSession.team_activity.length} teammate(s)`);
    result(`Context: ${aliceSession.project_context.total_files} doc(s)`);
    result(`Conflicts: ${aliceSession.conflicts.summary}`);
    console.log();

    // Alice checks Linear
    tool('linear_get_issues', '(simulated)');
    const aliceIssues = simLinearGetIssues();
    for (const issue of aliceIssues) {
      dim(`${issue.identifier}: ${issue.title} [${issue.status}]`);
    }
    console.log();

    // =====================================================================
    // ALICE: Pick TF-1 (shared types)
    // =====================================================================

    section(`AGENT ${CYAN}ALICE${RESET}: Pick TF-1 "Define shared Task type"`);

    tool('pick_issue', 'TF-1 (simulated)');
    const picked1 = simLinearPickIssue('TF-1', 'Alice');
    result(`${picked1!.identifier} -> ${picked1!.status}, assigned to ${picked1!.assignee}`);
    result(`Branch: ${picked1!.branchName}`);
    console.log();

    info(`${CYAN}Alice${RESET} creates branch: ${BOLD}${picked1!.branchName}${RESET}`);
    gitIn(aliceDir, ['checkout', '-b', picked1!.branchName]);
    console.log();

    tool('check_path', 'src/types.ts');
    const cp1 = checkPath({ path: 'src/types.ts' });
    result(`risk: ${cp1.risk} -- ${cp1.risk_reason}`);
    console.log();

    const msg1 = commitAs(aliceDir, 'Alice', 'alice@example.com', 'add shared Task interface', {
      'src/types.ts': TYPES_TS,
    });
    hook('prepare-commit-msg', `"add shared Task interface" -> "${msg1}"`);

    const hookResult1 = simulatePostCommitHook(aliceDir, 'main');
    if (hookResult1) {
      hook('post-commit', `First commit on branch! ${hookResult1} -> In Progress`);
    }
    console.log();

    info(`${CYAN}Alice${RESET} pushes.`);
    gitIn(aliceDir, ['push', '-u', 'origin', picked1!.branchName]);

    tool('log_progress', 'TF-1 (simulated)');
    result('Comment: "Defined Task interface with id, title, description, status, assignee, timestamps"');

    tool('complete_issue', 'TF-1 (simulated)');
    simLinearComplete('TF-1');
    result('TF-1 -> Done');

    // =====================================================================
    // ALICE: Pick TF-2 (CRUD API)
    // =====================================================================

    section(`AGENT ${CYAN}ALICE${RESET}: Pick TF-2 "Build CRUD API"`);

    tool('pick_issue', 'TF-2 (simulated)');
    const picked2 = simLinearPickIssue('TF-2', 'Alice');
    result(`${picked2!.identifier} -> ${picked2!.status}, branch: ${picked2!.branchName}`);
    console.log();

    gitIn(aliceDir, ['checkout', 'main']);
    gitIn(aliceDir, ['checkout', '-b', picked2!.branchName]);

    tool('search_code', '"Task"');
    const search1 = searchTeamCode({ query: 'Task' });
    if (search1.length > 0) {
      for (const m of search1) {
        result(`Found: ${m.name} in ${m.file}${m.branch ? ` (${m.branch})` : ''}`);
      }
    }
    console.log();

    const msg2 = commitAs(aliceDir, 'Alice', 'alice@example.com', 'add task CRUD functions', {
      'src/api/tasks.ts': TASKS_TS,
    });
    hook('prepare-commit-msg', `-> "${msg2}"`);

    const hookResult2 = simulatePostCommitHook(aliceDir, 'main');
    if (hookResult2) {
      hook('post-commit', `First commit! ${hookResult2} -> In Progress`);
    }

    const msg3 = commitAs(aliceDir, 'Alice', 'alice@example.com', 'add Express router', {
      'src/api/router.ts': ROUTER_TS,
    });
    hook('prepare-commit-msg', `-> "${msg3}"`);

    const hookResult3 = simulatePostCommitHook(aliceDir, 'main');
    if (!hookResult3) {
      hook('post-commit', '(not first commit -- silent)');
    }
    console.log();

    gitIn(aliceDir, ['push', '-u', 'origin', picked2!.branchName]);
    info(`${CYAN}Alice${RESET} pushes ${BOLD}${picked2!.branchName}${RESET}`);

    tool('log_progress', 'TF-2 (simulated)');
    result('Comment: "CRUD API done: getAllTasks, createTask, updateTask + Express routes"');

    tool('complete_issue', 'TF-2 (simulated)');
    simLinearComplete('TF-2');
    result('TF-2 -> Done');

    // =====================================================================
    // BOB: Session Start (a moment later)
    // =====================================================================

    await sleep(1500);

    section(`AGENT ${CYAN}BOB${RESET}: Session Start`);

    process.chdir(bobDir);
    gitIn(bobDir, ['fetch', 'origin']);

    tool('start_session');
    const bobSession = checkAll({ since: '7d' });
    result(`Team: ${bobSession.team_activity.length} teammate(s)`);
    for (const a of bobSession.team_activity) {
      dim(`${a.name} -- ${a.work_areas.join(', ')} -- ${a.active_branches.map(b => b.replace('origin/', '')).join(', ')}`);
    }
    result(`Conflicts: ${bobSession.conflicts.summary}`);
    console.log();

    tool('linear_get_issues', '(simulated)');
    const bobIssues = simLinearGetIssues();
    for (const issue of bobIssues) {
      const assignee = issue.assignee ? ` (${issue.assignee})` : '';
      dim(`${issue.identifier}: ${issue.title} [${issue.status}]${assignee}`);
    }
    console.log();

    // =====================================================================
    // KEY MOMENT: Bob searches for Task type
    // =====================================================================

    const starLine = '*'.repeat(72);
    console.log(`  ${BOLD}${YELLOW}${starLine}${RESET}`);
    console.log(`  ${BOLD}${YELLOW}*  KEY MOMENT: Bob searches for Task type before implementing       *${RESET}`);
    console.log(`  ${BOLD}${YELLOW}${starLine}${RESET}`);
    console.log();

    tool('search_code', '"Task"');
    const bobSearch = searchTeamCode({ query: 'Task' });
    if (bobSearch.length > 0) {
      for (const m of bobSearch) {
        const where = m.branch ? `on ${m.branch}` : 'local';
        result(`FOUND: ${m.name} (${m.signature.split('\n')[0].trim()}) in ${m.file} [${where}]`);
      }
      info(`${GREEN}Bob imports Task from ../types.js -- does NOT redefine it${RESET}`);
    } else {
      warn('No Task type found -- Bob would need to define it');
    }
    console.log();

    // =====================================================================
    // BOB: Pick TF-3, TF-4, TF-5
    // =====================================================================

    section(`AGENT ${CYAN}BOB${RESET}: Pick TF-3 "Build TaskList component"`);

    tool('pick_issue', 'TF-3 (simulated)');
    const picked3 = simLinearPickIssue('TF-3', 'Bob');
    result(`${picked3!.identifier} -> ${picked3!.status}, branch: ${picked3!.branchName}`);

    gitIn(bobDir, ['checkout', '-b', picked3!.branchName]);

    tool('check_path', 'src/components/TaskList.tsx');
    const cp3 = checkPath({ path: 'src/components/TaskList.tsx' });
    result(`risk: ${cp3.risk}`);

    const msg4 = commitAs(bobDir, 'Bob', 'bob@example.com', 'add TaskList component', {
      'src/components/TaskList.tsx': TASKLIST_TSX,
    });
    hook('prepare-commit-msg', `-> "${msg4}"`);
    const hookResult4 = simulatePostCommitHook(bobDir, 'main');
    if (hookResult4) hook('post-commit', `First commit! ${hookResult4} -> In Progress`);

    gitIn(bobDir, ['push', '-u', 'origin', picked3!.branchName]);
    tool('complete_issue', 'TF-3 (simulated)');
    simLinearComplete('TF-3');
    result('TF-3 -> Done');
    console.log();

    // TF-4
    info(`${CYAN}Bob${RESET} picks TF-4, creates ${BOLD}feat/tf-4-task-form${RESET}`);
    simLinearPickIssue('TF-4', 'Bob');
    gitIn(bobDir, ['checkout', 'main']);
    gitIn(bobDir, ['checkout', '-b', 'feat/tf-4-task-form']);

    const msg5 = commitAs(bobDir, 'Bob', 'bob@example.com', 'add TaskForm component', {
      'src/components/TaskForm.tsx': TASKFORM_TSX,
    });
    hook('prepare-commit-msg', `-> "${msg5}"`);
    gitIn(bobDir, ['push', '-u', 'origin', 'feat/tf-4-task-form']);
    simLinearComplete('TF-4');
    result('TF-4 -> Done');
    console.log();

    // TF-5
    info(`${CYAN}Bob${RESET} picks TF-5, creates ${BOLD}feat/tf-5-app-component${RESET}`);
    simLinearPickIssue('TF-5', 'Bob');
    gitIn(bobDir, ['checkout', 'main']);
    gitIn(bobDir, ['checkout', '-b', 'feat/tf-5-app-component']);

    const msg6 = commitAs(bobDir, 'Bob', 'bob@example.com', 'add App component', {
      'src/components/App.tsx': APP_TSX,
    });
    hook('prepare-commit-msg', `-> "${msg6}"`);
    gitIn(bobDir, ['push', '-u', 'origin', 'feat/tf-5-app-component']);
    simLinearComplete('TF-5');
    result('TF-5 -> Done');

    // =====================================================================
    // FINAL STATE
    // =====================================================================

    section('FINAL STATE');

    process.chdir(aliceDir);
    gitIn(aliceDir, ['fetch', 'origin']);

    // Conflicts
    tool('check_conflicts');
    const finalConflicts = checkConflicts();
    if (finalConflicts.conflicts.length === 0) {
      result('No conflicts detected across branches');
    } else {
      for (const c of finalConflicts.conflicts) {
        warn(`CONFLICT: ${c.file} -- ${c.branches.map(b => b.branch).join(' vs ')}`);
      }
    }
    result(finalConflicts.summary);
    console.log();

    // Linear state
    info('Linear:');
    for (const issue of linearState) {
      const color = issue.status === 'Done' ? GREEN : issue.status === 'In Progress' ? YELLOW : '';
      dim(`${issue.identifier}: ${issue.title} [${color}${issue.status}${DIM}] ${issue.assignee ?? ''}`);
    }
    console.log();

    // Git log
    info('Git log (all branches):');
    const logOutput = gitIn(aliceDir, [
      'log', '--all', '--oneline', '--format=%h %an: %s', '--reverse', '--date-order',
    ]);
    for (const line of logOutput.split('\n')) {
      dim(line);
    }
    console.log();

    // Branch list
    info('Branches:');
    const branches = gitIn(aliceDir, ['branch', '-r', '--sort=-committerdate']).split('\n');
    for (const b of branches) {
      const name = b.trim();
      if (!name || name.includes('->')) continue;
      const issueId = extractIssueId(name);
      const issueInfo = issueId
        ? linearState.find(i => i.identifier === issueId)
        : null;
      const status = issueInfo ? ` [${issueInfo.status}]` : '';
      dim(`${name}${status}`);
    }
    console.log();

    // Summary
    info('Summary:');
    result('- 2 agents, 5 tickets, 7 commits, 0 conflicts');
    result('- All commit messages auto-prefixed with issue IDs (hooks)');
    result('- Linear issues moved to In Progress on first commit (hooks)');
    result('- Bob found Alice\'s Task type via branch-aware search');
    result('- Bob imported it instead of redefining it');
    result('- All 5 tickets marked Done in Linear');

    banner('SIMULATION COMPLETE');
    console.log();

  } finally {
    process.chdir(originalCwd);
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

main().catch((err) => {
  console.error(`${RED}Simulation failed:${RESET}`, err);
  process.exit(1);
});
