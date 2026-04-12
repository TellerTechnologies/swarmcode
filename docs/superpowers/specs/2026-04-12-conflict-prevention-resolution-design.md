# Conflict Prevention & Resolution Design

**Date:** 2026-04-12
**Status:** Approved

## Problem

When multiple AI agents work on the same codebase concurrently, they produce merge conflicts — our test harness measured a 1-conflict rate when 3 agents all touched `src/git.ts`. The AgenticFlict paper found a 27.67% conflict rate across 142K+ agentic PRs. Swarmcode needs both prevention (stop conflicts before they happen) and resolution (handle them gracefully when they do).

## Goals

1. Pre-write conflict detection: warn agents before they edit files that would conflict with other active branches
2. Auto-resolution in the test harness: attempt to merge conflicts automatically before grading as failures
3. Adjusted grading: distinguish between auto-resolved conflicts (B) and unresolvable conflicts (C/D)

## Non-Goals

- Full agent presence protocol (deferred — pre-write detection covers 90% of the value)
- File-level locking (too heavy — advisory warnings are sufficient)
- AST/symbol-level conflict detection (future enhancement)

## Prior Art

- **Clash** (github.com/clash-sh/clash): Pre-write conflict detection using `git merge-tree`. Hooks into Claude Code as PreToolUse on Write/Edit. We adopt the same `git merge-tree --write-tree` approach but integrate it into swarmcode's existing `check_path` tool.
- **AgenticFlict** (arxiv.org/html/2604.03551v1): First large-scale dataset confirming multi-agent merge conflicts are frequent (27.67% rate).

## Design

### Part A: Pre-Write Conflict Detection

Enhance `check_path` to run `git merge-tree --write-tree <current-branch> <other-branch>` against all active remote branches. If the target file appears in the conflict output, escalate the risk level.

**How `git merge-tree --write-tree` works:**
- Performs a three-way merge between two branches without modifying the working tree
- Returns exit code 0 if clean merge, exit code 1 if conflicts
- Outputs conflicting file paths on stderr
- Available since Git 2.38+

**Integration into `check_path`:**

Current `check_path` returns:
```json
{
  "recent_authors": [...],
  "primary_owner": "Alice",
  "pending_changes": [...],
  "locally_modified": false,
  "risk": "safe",
  "risk_reason": "No pending changes"
}
```

Enhanced response adds:
```json
{
  "merge_conflicts": [
    {
      "branch": "jared/tel-16-add-getmainbranch",
      "conflicting_files": ["src/git.ts"]
    }
  ],
  "risk": "conflict_likely",
  "risk_reason": "src/git.ts would conflict with branch jared/tel-16 — another agent is modifying the same lines"
}
```

**Detection logic:**

1. Get current branch name
2. Get all active remote branches (already available via `getActiveRemoteBranches()`)
3. For each active branch, run `git merge-tree --write-tree HEAD <other-branch>`
4. Parse output for the target path
5. If found in conflicts, add to `merge_conflicts` array and set risk to `conflict_likely`

**Performance:** `git merge-tree` is fast (pure git-object operation, no checkout). Running against 5-10 active branches adds ~100-500ms. Acceptable since `check_path` is called before edits, not in a hot loop.

### Part B: Auto-Resolution in Test Harness

When `mergeAgentBranches()` encounters a conflict, instead of immediately aborting:

1. **Try `git merge -X patience`** — patience diff algorithm is better at handling cases where both sides added content to the same area of a file (common with agents adding JSDoc, tests, etc.)
2. **If patience merge succeeds** — record as auto-resolved conflict, continue
3. **If patience merge fails** — abort, record as unresolvable conflict

**Updated merge flow:**
```
For each agent branch (chronological order):
  1. git merge <branch> --no-edit
  2. If clean → record success
  3. If conflict:
     a. git merge --abort
     b. git merge <branch> --no-edit -X patience
     c. If clean → record as auto-resolved
     d. If still conflict → git merge --abort, record as unresolvable
```

**Updated grading logic:**

| Scenario | Grade |
|----------|-------|
| Zero conflicts, all tests pass | A |
| Auto-resolved conflicts, all tests pass | B |
| Unresolvable conflicts (some branches couldn't merge) | C |
| Incomplete issues, test failures, or duplicate claims | D |

The existing `conflictsHit` metric splits into `conflictsAutoResolved` and `conflictsUnresolved`.

### Scorecard Updates

New fields in `Scorecard`:
```typescript
conflictsAutoResolved: number;   // conflicts fixed by patience merge
conflictsUnresolved: number;     // conflicts that couldn't be merged
```

Updated scorecard output:
```
COORDINATION
  Issue deduplication:  ✓
  Conflicts avoided:    0
  Conflicts resolved:   1  (auto-merged with patience strategy)
  Conflicts unresolved: 0
  Files touched by 2+:  2
```

## File Changes

```
src/tools/check-path.ts     — Add merge-tree conflict detection
src/test/types.ts            — Add conflictsAutoResolved/conflictsUnresolved to Scorecard
src/test/orchestrator.ts     — Update mergeAgentBranches with patience fallback
src/test/scorecard.ts        — Update grading logic and formatting
tests/tools/check-path.test.ts  — Test merge-tree integration
tests/test-harness/scorecard.test.ts — Test updated grading
```
