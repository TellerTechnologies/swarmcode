# get_project_context Tool Design

## Overview

A new MCP tool that scans the repo for planning docs, specs, READMEs, and AI context files, returning their content so the AI understands the project plan, assignments, and architecture before starting work.

## Motivation

When a team lead writes a spec and assigns sections to different developers, each AI agent needs to read that plan before starting. Without this, agents work blind — they only see git history, not the project's intent, assignments, or architecture decisions documented in markdown.

## What it scans

### Root-level files (always checked)

| File | Purpose |
|------|---------|
| `README.md` | Project overview |
| `CLAUDE.md` | Claude Code instructions and coordination rules |
| `.cursorrules` | Cursor AI instructions |
| `.github/copilot-instructions.md` | GitHub Copilot instructions |
| `AGENTS.md` | Multi-agent instructions |
| `PLAN.md` / `plan.md` | Project plan |
| Any other `*.md` in repo root | Catch-all for root-level docs |

### Directories (recursively scanned)

| Directory | Purpose |
|-----------|---------|
| `docs/` | Architecture, design decisions, development guides |
| `plan/` / `plans/` | Implementation plans |
| `spec/` / `specs/` | Design specifications |

### File types included

- `.md` (Markdown)
- `.txt` (Plain text)

### Excluded

- Files over 50KB (not planning docs)
- `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `target/`
- Total output capped at 200KB to avoid flooding AI context

## Tool interface

```
Tool name: get_project_context

Input: {
  path?: string    // Narrow to a specific directory (e.g. "specs/")
  query?: string   // Only return files whose path or content matches (substring, case-insensitive)
}

Output: {
  files: Array<{
    path: string,
    content: string
  }>,
  total_files: number,
  truncated: boolean   // true if 200KB cap was hit
}
```

## Server instructions

Add to the existing MCP server instructions:

```
- At the start of a session → call get_project_context to understand the project plan and assignments
```

## CLAUDE.md snippet update

Update the `swarmcode init` snippet to include:

```
- At the start of every session, call `get_project_context` to understand the project plan
```

## Implementation

### Files to create/modify

| File | Action |
|------|--------|
| `src/tools/get-project-context.ts` | Create — scans directories, reads files, applies filters |
| `tests/tools/get-project-context.test.ts` | Create — unit tests with temp directories |
| `src/types.ts` | Modify — add `ProjectContextResult` type |
| `src/index.ts` | Modify — export new type |
| `src/server.ts` | Modify — register tool, update instructions |
| `src/cli.ts` | Modify — update init snippet |
| `README.md` | Modify — add tool to table, update init snippet |
| `docs/architecture.md` | Modify — add to module map and tool table |
