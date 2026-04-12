# Multi-Agent Test Harness Design

**Date:** 2026-04-12
**Status:** Approved

## Problem

Swarmcode coordinates AI agents via Linear + Git, but there's no way to prove it works under concurrent load. Nobody in the ecosystem has a battle-tested answer for "N AI agents, same repo, same hour, overlapping files." A test harness that orchestrates real concurrent agents and measures coordination quality is the differentiator that makes swarmcode the standard.

## Goals

1. Orchestrate N concurrent Claude Code agents on the same repo with real Linear tickets
2. Measure coordination quality: conflicts, duplication, merge success, throughput
3. Produce a scorecard that grades each run
4. Build a reusable scenario library for repeatable testing
5. Use swarmcode's own repo as the initial test target

## Non-Goals

- Agent presence protocol (defer until test data shows it's needed)
- Mock/simulation mode (real agents, real repo, real Linear — always)
- GitHub PR automation (out of scope for v1)
- Plugin architecture for non-Linear PM tools

## Design

### CLI Interface

```bash
swarmcode test run --scenario overlapping-files.yaml    # run a scenario
swarmcode test run --agents 3 --scenario basic.yaml     # override agent count
swarmcode test list                                      # list available scenarios
swarmcode test report <run-id>                           # reprint a past scorecard
swarmcode test cleanup                                   # remove orphaned worktrees + archive stale test issues
```

### Scenario Format

Scenarios are YAML files in `test/scenarios/`. Each defines the work to be done and the conditions being tested.

```yaml
name: overlapping-files
description: "3 agents modifying shared utility modules"
agents: 3
base_branch: main
test_command: "npm test"  # configurable per scenario, default: npm test
timeout_minutes: 30       # per-agent timeout

issues:
  - title: "Add input validation to user registration"
    description: |
      - [ ] Add email format validation to signup form
      - [ ] Add password strength check
      - [ ] Add unit tests
    labels: [frontend]

  - title: "Add rate limiting to auth endpoints"
    description: |
      - [ ] Add rate limiter middleware
      - [ ] Apply to login and signup routes
      - [ ] Add integration tests
    labels: [backend]

  - title: "Refactor auth error handling"
    description: |
      - [ ] Standardize error response format
      - [ ] Update signup and login error paths
      - [ ] Add error handling tests
    labels: [backend]

# Metadata for scorecard context
overlap_profile: high
expected_conflicts: 1-3
success_criteria:
  - all_issues_completed: true
  - merge_conflicts_resolved: true
  - no_duplicate_implementations: true
  - all_tests_pass: true
```

Key principles:
- Scenarios define the work, not the expected file changes. Overlap is emergent, not scripted.
- Agent count must equal issue count for v1. One agent, one issue.
- All test issues are labeled `swarmcode-test` + tagged with run ID for cleanup.

### Architecture

Four modules:

**1. Orchestrator (`src/test/orchestrator.ts`)**
The brain. Parses scenario YAML, sets up the environment, launches agents, monitors progress, triggers scorecard generation.

Execution flow:
1. Parse scenario, validate config
2. Create test branch from base
3. Create Linear issues from scenario definition (on TEL team)
4. Start event collector
5. Launch N agent subprocesses in parallel
6. Wait for all agents to complete (with configurable timeout, default 30min per agent)
7. Attempt merge of all agent branches into test branch
8. Run test suite on merged result
9. Generate scorecard
10. Cleanup worktrees, archive Linear issues

**2. Agent Launcher (`src/test/agent-launcher.ts`)**
For each agent:
- Creates a git worktree from the test branch
- Writes `.mcp.json` in the worktree pointing to swarmcode
- Spawns Claude Code in headless mode via: `claude -p "<prompt>" --dangerously-skip-permissions`
  - The prompt: "You have swarmcode available. Call start_session, look at available issues, pick one using pick_issue, then implement it. Commit and push your work. When done, call complete_issue."
  - All agents get the same prompt — no pre-assignment. This tests whether agents correctly skip In Progress issues claimed by other agents.
  - `--dangerously-skip-permissions` is required because agents can't approve tool calls interactively
  - Working directory is set to the agent's worktree
  - Agents are launched with a small stagger (5s between each) to create realistic race conditions without pure simultaneous API calls
- Captures stdout/stderr to `test/results/<run-id>/agent-<n>.log`
- Completion detection: poll Linear for all test issues state = Done as primary signal. Process exit is secondary. If all issues are Done but a process is still running, kill it. If process exits but its issue is not Done, mark as incomplete.
- On timeout: kill process, mark agent as timed-out in scorecard

**3. Event Collector (`src/test/event-collector.ts`)**
Watches in real-time:
- Polls git for new commits/pushes across all worktrees (every 10s)
- Polls Linear for state transitions on test issues (every 15s)
- Writes structured JSON event log to `test/results/<run-id>/events.json`

Note: MCP tool call interception is deferred for v1. Git + Linear polling gives 90% of the signal without the complexity of building a stdio proxy. If scorecard analysis reveals we need tool-call-level granularity, add `--event-log <path>` flag to swarmcode itself in v2.

Event schema:
```json
{
  "timestamp": "2026-04-12T14:32:01Z",
  "agent": "agent-1",
  "type": "git_commit | git_push | linear_state_change | mcp_tool_call",
  "data": { ... }
}
```

**4. Scorecard Generator (`src/test/scorecard.ts`)**
After all agents finish:
- Attempts merge of all agent branches into test branch, in chronological order by last commit timestamp (deterministic, reproducible)
- If a merge conflicts, record it, abort that merge, and continue with remaining branches
- Runs test suite on merged result (scenario's `test_command`, default `npm test`)
- Crunches event log into metrics
- Applies grading logic
- Outputs terminal report + saves JSON to `test/results/<run-id>/scorecard.json`

### Metrics Collected

**Git layer:**
- Total commits per agent
- Push count per agent
- Merge conflicts encountered (which files, which agents)
- Branches created
- Time from first commit to completion per agent

**Linear layer:**
- Issue state transitions with timestamps
- Checkbox completion order
- Comments posted
- Duplicate issue claims (two agents grabbing same issue — key coordination metric)
- Issue selection pattern: did each agent pick a unique issue? How long did selection take?

**Coordination layer (v1 — inferred from git/Linear, not direct MCP observation):**
- Files touched by multiple agents (derived from git log per branch)
- Time overlap: agents working on same files within same time window
- Whether agents pushed to branches that modify the same paths

**Outcome:**
- All branches merge cleanly?
- Tests pass on merged result?
- All issues marked Done?

### Scorecard Output

```
═══════════════════════════════════════════════
  SWARMCODE TEST: overlapping-files
  3 agents · 3 issues · 14m 32s total
═══════════════════════════════════════════════

  OUTCOME
  ✓ All issues completed
  ✓ All branches merged
  ✓ Tests pass on merged result
  ✗ 1 merge conflict (auth/middleware.ts)

  COORDINATION
  Issue deduplication:  ✓  (all agents picked unique issues)
  Check-path calls:     7  (agents looked before writing)
  Conflicts avoided:    2  (agent redirected after check_path)
  Conflicts hit:        1  (auth/middleware.ts — agents 1 & 3)
  Duplicate work:       0

  PER AGENT
  ┌─────────┬──────────┬─────────┬───────────┐
  │ Agent   │ Commits  │ Time    │ Issues    │
  ├─────────┼──────────┼─────────┼───────────┤
  │ agent-1 │ 6        │ 11m 20s │ ENG-401 ✓ │
  │ agent-2 │ 4        │ 8m 45s  │ ENG-402 ✓ │
  │ agent-3 │ 5        │ 14m 32s │ ENG-403 ✓ │
  └─────────┴──────────┴─────────┴───────────┘

  GRADE: B+
  Good coordination. 1 conflict on shared file.
  Recommendation: add path advisory for auth/
  when multiple agents are active.
═══════════════════════════════════════════════
```

### Grading Logic

- **A** — zero conflicts, zero duplication, all tests pass, all issues done
- **B** — minor conflicts resolved cleanly, no duplication
- **C** — conflicts requiring manual intervention, or some duplication
- **D** — agents blocked each other, incomplete issues, or broken merged result

### Timeout & Failure Handling

- Per-agent timeout: configurable, default 30 minutes
- If an agent stalls, harness kills the subprocess
- Run is graded with whatever completed — partial results are still valuable data
- Timed-out agents are marked in the scorecard

### Infrastructure

- **Linear team:** TEL (tellertechnologies-sandbox)
- **Test repo:** swarmcode itself (dog-fooding)
- **Linear API key:** stored in `.env` (gitignored), read by harness
- Issues are created per run with `swarmcode-test` label + run ID in metadata, archived after scorecard generation
- Worktrees are cleaned up after each run
- `swarmcode test cleanup` handles orphaned worktrees and stale test issues from interrupted runs

### Future Considerations (Not v1)

- **Agent presence protocol:** if scorecards consistently show file-level collisions, add real-time "I'm editing X" signaling. Deferred until data proves the need.
- **Scenario generator:** AI-assisted creation of scenarios from real project history.
- **CI integration:** run test harness in CI to catch coordination regressions.
- **Comparison mode:** run same scenario with/without swarmcode to measure coordination lift.

## File Structure

```
src/test/
  orchestrator.ts       — scenario parsing, lifecycle management
  agent-launcher.ts     — worktree creation, Claude Code subprocess
  event-collector.ts    — git/Linear polling, event logging
  scorecard.ts          — metrics crunching, grading, output

test/
  scenarios/
    overlapping-files.yaml
    independent-tasks.yaml
    shared-interface.yaml
  results/
    <run-id>/
      scorecard.json    — structured scorecard data
      events.json       — raw event log
      agent-1.log       — agent stdout/stderr
      agent-2.log
      agent-3.log
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Claude Code doesn't behave well in headless `-p` mode for multi-tool sessions | Test with a single agent first; if `-p` is too limited, investigate `--resume` or SDK-based spawning |
| API rate limits running 3+ Claude sessions simultaneously | Start with 2 agents, scale up; add staggered launch (5s delay between agents) |
| All agents are the same Linear user, `pick_issue` could race | This IS the test — we want to see if agents correctly skip claimed issues. Stagger launch by 5s to avoid pure API race. Scorecard tracks duplicate claims as a key metric. |
| Harness crashes mid-run, orphans worktrees + Linear issues | `swarmcode test cleanup` scans for `swarmcode-test` labeled issues and leftover worktrees |
| Merge order affects conflict results | Deterministic ordering by last commit timestamp; same scenario = same merge order |
