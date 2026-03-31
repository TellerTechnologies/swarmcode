/**
 * simulate-two-agents.ts
 *
 * A self-contained simulation that creates a temporary shared repo, sets up
 * two AI agents (Alice and Bob), and demonstrates how swarmcode's MCP tools
 * help them coordinate without conflicts.
 *
 * Unlike demo-two-agents.ts which is a quick walkthrough, this script shows
 * FULL tool output so you can see exactly what each agent sees.
 *
 * Run with: npx tsx scripts/simulate-two-agents.ts
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { checkAll } from '../src/tools/check-all.js';
import { checkPath } from '../src/tools/check-path.js';
import { searchTeamCode } from '../src/tools/search-team-code.js';
import { checkConflicts } from '../src/tools/check-conflicts.js';
import { getDeveloper } from '../src/tools/get-developer.js';

// ---------------------------------------------------------------------------
// ANSI Colors (no emoji per user preference)
// ---------------------------------------------------------------------------

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
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

function commitAs(
  dir: string,
  author: string,
  email: string,
  message: string,
  files: Record<string, string>,
): void {
  for (const [filePath, content] of Object.entries(files)) {
    writeFile(dir, filePath, content);
  }
  gitIn(dir, ['add', '-A']);
  gitIn(dir, [
    '-c', `user.name=${author}`,
    '-c', `user.email=${email}`,
    'commit', '-m', message,
  ]);
}

function banner(text: string): void {
  const line = '='.repeat(68);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  ${text}${RESET}`);
  console.log(`${BOLD}${line}${RESET}`);
}

function section(text: string): void {
  const line = '-'.repeat(68);
  console.log(`\n${BOLD}${line}${RESET}`);
  console.log(`${BOLD}  ${text}${RESET}`);
  console.log(`${BOLD}${line}${RESET}\n`);
}

function tool(name: string, detail?: string): void {
  const extra = detail ? ` ${detail}` : '';
  console.log(`  ${YELLOW}[${name}]${RESET}${extra}`);
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

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// File Contents
// ---------------------------------------------------------------------------

const PLAN_MD = `# TaskFlow Implementation Plan

## Assignments

### Alice -- Backend API
- \`src/types.ts\` -- shared Task type definition
- \`src/api/tasks.ts\` -- CRUD endpoints for tasks
- \`src/api/router.ts\` -- Express router setup

### Bob -- Frontend Dashboard
- \`src/components/TaskList.tsx\` -- displays list of tasks
- \`src/components/TaskForm.tsx\` -- form to create new tasks
- \`src/components/App.tsx\` -- main app component

## Shared Contract
The Task type must be defined in \`src/types.ts\` by Alice before Bob imports it.
Bob should import Task from \`src/types.ts\` -- do NOT redefine it.
`;

const CLAUDE_MD = `# CLAUDE.md

## Project: TaskFlow
A collaborative task management app.

## Rules
- Use TypeScript strict mode
- Coordinate via PLAN.md assignments
- Never redefine types that already exist in src/types.ts
`;

const README_MD = `# TaskFlow

A collaborative task management application built by two AI agents
coordinating through swarmcode.
`;

// Alice's files
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

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
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

export function deleteTask(id: string): boolean {
  return tasks.delete(id);
}
`;

const ROUTER_TS = `import { Router } from 'express';
import { getAllTasks, getTask, createTask, updateTask, deleteTask } from './tasks.js';

export function setupRoutes(): Router {
  const router = Router();

  router.get('/tasks', (_req, res) => {
    res.json(getAllTasks());
  });

  router.get('/tasks/:id', (req, res) => {
    const task = getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  });

  router.post('/tasks', (req, res) => {
    const { title, description } = req.body;
    const task = createTask(title, description);
    res.status(201).json(task);
  });

  router.patch('/tasks/:id', (req, res) => {
    const task = updateTask(req.params.id, req.body);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  });

  router.delete('/tasks/:id', (req, res) => {
    const deleted = deleteTask(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.status(204).send();
  });

  return router;
}
`;

// Bob's files -- note: imports Task from ../types.js, does NOT redefine it
const TASKLIST_TSX = `import type { Task } from '../types.js';

interface TaskListProps {
  tasks: Task[];
  onSelect: (task: Task) => void;
}

export function TaskList({ tasks, onSelect }: TaskListProps) {
  if (tasks.length === 0) {
    return <div className="task-list-empty">No tasks yet. Create one above.</div>;
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <li key={task.id} onClick={() => onSelect(task)} className={\`task-item task-\${task.status}\`}>
          <span className="task-title">{task.title}</span>
          <span className="task-status">{task.status}</span>
        </li>
      ))}
    </ul>
  );
}
`;

const TASKFORM_TSX = `import { useState } from 'react';
import type { Task } from '../types.js';

interface TaskFormProps {
  onSubmit: (title: string, description: string) => void;
}

export function TaskForm({ onSubmit }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title, description);
    setTitle('');
    setDescription('');
  }

  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button type="submit">Create Task</button>
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
  const [selected, setSelected] = useState<Task | null>(null);

  useEffect(() => {
    fetch('/api/tasks')
      .then((res) => res.json())
      .then(setTasks);
  }, []);

  async function handleCreate(title: string, description: string) {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
    });
    const task = await res.json();
    setTasks((prev) => [...prev, task]);
  }

  return (
    <div className="app">
      <h1>TaskFlow</h1>
      <TaskForm onSubmit={handleCreate} />
      <TaskList tasks={tasks} onSelect={setSelected} />
      {selected && (
        <div className="task-detail">
          <h2>{selected.title}</h2>
          <p>{selected.description}</p>
          <p>Status: {selected.status}</p>
        </div>
      )}
    </div>
  );
}
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const originalCwd = process.cwd();

  // Create temp directories
  const base = mkdtempSync(join(tmpdir(), 'swarmcode-sim-'));
  const bareDir = join(base, 'remote.git');
  const aliceDir = join(base, 'alice');
  const bobDir = join(base, 'bob');

  try {
    // =======================================================================
    // SETUP
    // =======================================================================

    banner('SWARMCODE LIVE SIMULATION: Two AI Agents, One Project, Zero Conflicts');

    console.log('\nSetting up shared repository...');

    // Create bare remote
    mkdirSync(bareDir);
    gitIn(bareDir, ['init', '--bare', '--initial-branch=main']);
    info(`Created bare remote at ${DIM}${bareDir}${RESET}`);

    // Initialize Alice's clone
    mkdirSync(aliceDir);
    gitIn(aliceDir, ['init', '-b', 'main']);
    gitIn(aliceDir, ['remote', 'add', 'origin', bareDir]);
    gitIn(aliceDir, ['config', 'user.name', 'Alice']);
    gitIn(aliceDir, ['config', 'user.email', 'alice@example.com']);

    // Initial commit with project files
    commitAs(aliceDir, 'Alice', 'alice@example.com', 'chore: initial project setup', {
      'README.md': README_MD,
      'PLAN.md': PLAN_MD,
      'CLAUDE.md': CLAUDE_MD,
    });
    gitIn(aliceDir, ['push', '-u', 'origin', 'main']);

    // Clone for Bob
    execFileSync('git', ['clone', bareDir, bobDir], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    gitIn(bobDir, ['config', 'user.name', 'Bob']);
    gitIn(bobDir, ['config', 'user.email', 'bob@example.com']);

    info('Cloned for Alice and Bob');
    info(`Initial commit with README.md, PLAN.md, CLAUDE.md`);
    console.log(`  ${GREEN}Done.${RESET}`);

    // =======================================================================
    // AGENT ALICE: Session Start
    // =======================================================================

    section(`AGENT ${CYAN}ALICE${RESET}: Session Start`);

    process.chdir(aliceDir);

    tool('check_all', 'Getting full project context...');
    console.log();
    const aliceCheckAll = checkAll({ since: '7d' });

    // Team Activity
    info('Team Activity:');
    if (aliceCheckAll.team_activity.length === 0) {
      result('No teammates yet');
    } else {
      for (const a of aliceCheckAll.team_activity) {
        result(`${a.name} -- last active ${timeAgo(a.last_active)}`);
      }
    }
    console.log();

    // Project Context
    info('Project Context:');
    for (const file of aliceCheckAll.project_context.files) {
      if (file.path === 'PLAN.md') {
        result(`${file.path}:`);
        // Show a summary of PLAN.md
        const lines = file.content.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            dim(line);
          }
        }
      } else {
        dim(`${file.path} (${file.content.length} bytes)`);
      }
    }
    console.log();

    // Conflicts
    info('Conflicts:');
    result(aliceCheckAll.conflicts.summary);
    console.log();

    // Alice creates her feature branch
    info(`${CYAN}Alice${RESET} creates branch: ${BOLD}feat/backend-api${RESET}`);
    gitIn(aliceDir, ['checkout', '-b', 'feat/backend-api']);
    console.log();

    // --- Alice writes src/types.ts ---
    info(`--- ${BOLD}src/types.ts${RESET} ---`);

    tool('check_path', 'path: src/types.ts');
    const alicePath1 = checkPath({ path: 'src/types.ts' });
    result(`risk: ${alicePath1.risk}, ${alicePath1.primary_owner ? `owner: ${alicePath1.primary_owner}` : 'no owner'}, ${alicePath1.pending_changes.length === 0 ? 'no pending changes' : `${alicePath1.pending_changes.length} pending`}`);

    tool('search_team_code', '"Task"');
    const aliceSearch1 = searchTeamCode({ query: 'Task' });
    if (aliceSearch1.length === 0) {
      result('No existing exports found');
    } else {
      for (const m of aliceSearch1) {
        result(`Found: ${m.name} in ${m.file}`);
      }
    }

    commitAs(aliceDir, 'Alice', 'alice@example.com', 'feat: add shared Task type definition', {
      'src/types.ts': TYPES_TS,
    });
    info(`Writing file... ${GREEN}committed.${RESET}`);
    console.log();

    // --- Alice writes src/api/tasks.ts ---
    info(`--- ${BOLD}src/api/tasks.ts${RESET} ---`);

    // Ensure directory exists before check_path so git doesn't warn on stderr
    mkdirSync(join(aliceDir, 'src', 'api'), { recursive: true });

    tool('check_path', 'path: src/api/tasks.ts');
    const alicePath2 = checkPath({ path: 'src/api/tasks.ts' });
    result(`risk: ${alicePath2.risk}`);

    tool('search_team_code', '"createTask"');
    const aliceSearch2 = searchTeamCode({ query: 'createTask' });
    if (aliceSearch2.length === 0) {
      result('No existing exports found');
    } else {
      for (const m of aliceSearch2) {
        result(`Found: ${m.name} in ${m.file}`);
      }
    }

    commitAs(aliceDir, 'Alice', 'alice@example.com', 'feat: add CRUD functions for tasks', {
      'src/api/tasks.ts': TASKS_TS,
    });
    info(`Writing file... ${GREEN}committed.${RESET}`);
    console.log();

    // --- Alice writes src/api/router.ts ---
    info(`--- ${BOLD}src/api/router.ts${RESET} ---`);

    tool('check_path', 'path: src/api/router.ts');
    const alicePath3 = checkPath({ path: 'src/api/router.ts' });
    result(`risk: ${alicePath3.risk}`);

    tool('search_team_code', '"setupRoutes"');
    const aliceSearch3 = searchTeamCode({ query: 'setupRoutes' });
    if (aliceSearch3.length === 0) {
      result('No existing exports found');
    } else {
      for (const m of aliceSearch3) {
        result(`Found: ${m.name} in ${m.file}`);
      }
    }

    commitAs(aliceDir, 'Alice', 'alice@example.com', 'feat: add Express route setup for task API', {
      'src/api/router.ts': ROUTER_TS,
    });
    info(`Writing file... ${GREEN}committed.${RESET}`);
    console.log();

    // Alice pushes
    info(`${CYAN}Alice${RESET} pushes ${BOLD}feat/backend-api${RESET} to origin.`);
    gitIn(aliceDir, ['push', '-u', 'origin', 'feat/backend-api']);

    // =======================================================================
    // AGENT BOB: Session Start
    // =======================================================================

    // Small delay so timestamps differ visibly
    await sleep(1500);

    section(`AGENT ${CYAN}BOB${RESET}: Session Start (a moment later)`);

    process.chdir(bobDir);

    info('Fetching from origin...');
    gitIn(bobDir, ['fetch', 'origin']);
    console.log();

    tool('check_all', 'Getting full project context...');
    console.log();
    const bobCheckAll = checkAll({ since: '7d' });

    // Team Activity
    info('Team Activity:');
    if (bobCheckAll.team_activity.length === 0) {
      result('No teammates found');
    } else {
      for (const a of bobCheckAll.team_activity) {
        result(`${a.name} -- last active ${timeAgo(a.last_active)}`);
        if (a.work_areas.length > 0) {
          dim(`Working in: ${a.work_areas.join(', ')}`);
        }
        if (a.active_branches.length > 0) {
          dim(`Branches: ${a.active_branches.join(', ')}`);
        }
        if (a.recent_commits.length > 0) {
          dim('Recent commits:');
          for (const c of a.recent_commits) {
            dim(`  - ${c.message}`);
          }
        }
      }
    }
    console.log();

    // Project Context
    info('Project Context:');
    for (const file of bobCheckAll.project_context.files) {
      if (file.path === 'PLAN.md') {
        result(`${file.path} -- Bob's assignment: src/components/TaskList.tsx, TaskForm.tsx, App.tsx`);
        dim(`PLAN.md says: "Import Task from src/types.ts -- do NOT redefine it"`);
      } else {
        dim(`${file.path} (${file.content.length} bytes)`);
      }
    }
    console.log();

    // Conflicts
    info('Conflicts:');
    result(bobCheckAll.conflicts.summary);
    console.log();

    // =======================================================================
    // KEY MOMENT: Bob searches for the Task type
    // =======================================================================

    const starLine = '*'.repeat(68);
    console.log(`  ${BOLD}${YELLOW}${starLine}${RESET}`);
    console.log(`  ${BOLD}${YELLOW}*  KEY MOMENT: Bob searches for the Task type before implementing  *${RESET}`);
    console.log(`  ${BOLD}${YELLOW}${starLine}${RESET}`);
    console.log();

    tool('search_team_code', '"Task"');
    const bobSearchTask = searchTeamCode({ query: 'Task' });
    if (bobSearchTask.length === 0) {
      result('No matching exports found');
    } else {
      for (const m of bobSearchTask) {
        const branchInfo = m.branch ? `Branch: ${m.branch}` : 'local';
        const authorInfo = m.last_modified_by ? `Last modified by: ${m.last_modified_by}` : '';
        result(`FOUND: ${m.name} (${m.signature.split('\n')[0].trim()}) in ${m.file}`);
        dim(`${branchInfo}${authorInfo ? '  ' + authorInfo : ''}`);
      }
    }
    console.log();
    info(`${GREEN}Bob will import Task from ../types.js -- NOT redefine it.${RESET}`);
    console.log();

    // Bob creates his feature branch
    info(`${CYAN}Bob${RESET} creates branch: ${BOLD}feat/frontend-dashboard${RESET}`);
    gitIn(bobDir, ['checkout', '-b', 'feat/frontend-dashboard']);
    console.log();

    // --- Bob writes src/components/TaskList.tsx ---
    info(`--- ${BOLD}src/components/TaskList.tsx${RESET} ---`);

    tool('check_path', 'path: src/components/TaskList.tsx');
    const bobPath1 = checkPath({ path: 'src/components/TaskList.tsx' });
    result(`risk: ${bobPath1.risk}`);

    tool('search_team_code', '"TaskList"');
    const bobSearch1 = searchTeamCode({ query: 'TaskList' });
    if (bobSearch1.length === 0) {
      result('No existing exports found');
    } else {
      for (const m of bobSearch1) {
        result(`Found: ${m.name} in ${m.file}`);
      }
    }

    commitAs(bobDir, 'Bob', 'bob@example.com', 'feat: add TaskList component', {
      'src/components/TaskList.tsx': TASKLIST_TSX,
    });
    info(`Writing file (imports Task from ../types.js)... ${GREEN}committed.${RESET}`);
    console.log();

    // --- Bob writes src/components/TaskForm.tsx ---
    info(`--- ${BOLD}src/components/TaskForm.tsx${RESET} ---`);

    tool('check_path', 'path: src/components/TaskForm.tsx');
    const bobPath2 = checkPath({ path: 'src/components/TaskForm.tsx' });
    result(`risk: ${bobPath2.risk}`);

    tool('search_team_code', '"TaskForm"');
    const bobSearch2 = searchTeamCode({ query: 'TaskForm' });
    if (bobSearch2.length === 0) {
      result('No existing exports found');
    } else {
      for (const m of bobSearch2) {
        result(`Found: ${m.name} in ${m.file}`);
      }
    }

    commitAs(bobDir, 'Bob', 'bob@example.com', 'feat: add TaskForm component', {
      'src/components/TaskForm.tsx': TASKFORM_TSX,
    });
    info(`Writing file (imports Task from ../types.js)... ${GREEN}committed.${RESET}`);
    console.log();

    // --- Bob writes src/components/App.tsx ---
    info(`--- ${BOLD}src/components/App.tsx${RESET} ---`);

    tool('check_path', 'path: src/components/App.tsx');
    const bobPath3 = checkPath({ path: 'src/components/App.tsx' });
    result(`risk: ${bobPath3.risk}`);

    tool('search_team_code', '"App"');
    const bobSearch3 = searchTeamCode({ query: 'App' });
    if (bobSearch3.length === 0) {
      result('No existing exports found');
    } else {
      for (const m of bobSearch3) {
        result(`Found: ${m.name} in ${m.file}`);
      }
    }

    commitAs(bobDir, 'Bob', 'bob@example.com', 'feat: add App component', {
      'src/components/App.tsx': APP_TSX,
    });
    info(`Writing file (imports Task from ../types.js)... ${GREEN}committed.${RESET}`);
    console.log();

    // Bob pushes
    info(`${CYAN}Bob${RESET} pushes ${BOLD}feat/frontend-dashboard${RESET} to origin.`);
    gitIn(bobDir, ['push', '-u', 'origin', 'feat/frontend-dashboard']);

    // =======================================================================
    // FINAL STATE
    // =======================================================================

    section('FINAL STATE');

    // Switch to Alice's clone to check conflicts from her perspective
    process.chdir(aliceDir);
    gitIn(aliceDir, ['fetch', 'origin']);

    tool('check_conflicts');
    const finalConflicts = checkConflicts();
    if (finalConflicts.conflicts.length === 0) {
      result('No conflicts detected across branches.');
    } else {
      for (const c of finalConflicts.conflicts) {
        console.log(`    ${RED}WARNING: ${c.file} modified on ${c.branches.length + (c.local ? 1 : 0)} branch(es)${RESET}`);
        for (const b of c.branches) {
          dim(`- ${b.branch} (${b.author})`);
        }
        console.log(`    ${RED}Severity: ${c.severity}${RESET}`);
      }
    }
    result(finalConflicts.summary);
    console.log();

    tool('get_developer', '"Bob"');
    const bobProfile = getDeveloper({ name: 'Bob' });
    result(`Name: ${bobProfile.name}`);
    if (bobProfile.recent_commits.length > 0) {
      result(`Recent commits: ${bobProfile.recent_commits.length}`);
      for (const c of bobProfile.recent_commits) {
        dim(`- ${c.message}`);
      }
    }
    if (bobProfile.work_areas.length > 0) {
      result(`Working in: ${bobProfile.work_areas.join(', ')}`);
    }
    if (bobProfile.active_branches.length > 0) {
      result(`Branches: ${bobProfile.active_branches.join(', ')}`);
    }
    console.log();

    // Git log across all branches
    info(`Git log (all branches):`);
    const logOutput = gitIn(aliceDir, [
      'log', '--all', '--oneline', '--format=%h %an %s', '--reverse', '--date-order',
    ]);
    for (const line of logOutput.split('\n')) {
      const parts = line.match(/^(\S+)\s+(\S+)\s+(.*)$/);
      if (parts) {
        const [, hash, author, message] = parts;
        const authorColor = author === 'Alice' ? CYAN : author === 'Bob' ? CYAN : '';
        dim(`${hash} (${authorColor}${author}${RESET}${DIM}) ${message}`);
      } else {
        dim(line);
      }
    }
    console.log();

    // Summary
    info('Result:');
    result('- 2 agents, 6 feature commits, 0 conflicts');
    result('- Bob found Alice\'s Task type via branch-aware search');
    result('- Bob imported it instead of redefining it');
    result('- No duplicate work, no file overlaps');

    banner('SIMULATION COMPLETE');
    console.log();

  } finally {
    // Always restore original cwd and clean up
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
