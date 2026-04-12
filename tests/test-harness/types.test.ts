import { describe, it, expect } from 'vitest';
import { parseScenario } from '../../src/test/types.js';

const VALID_YAML = `
name: test-scenario
description: "Two agents on independent tasks"
agents: 2
base_branch: main
test_command: "npm test"
timeout_minutes: 30

issues:
  - title: "Add feature A"
    description: |
      - [ ] Implement feature A
      - [ ] Add tests
    labels: [backend]
  - title: "Add feature B"
    description: |
      - [ ] Implement feature B
      - [ ] Add tests
    labels: [frontend]

overlap_profile: low
expected_conflicts: 0
success_criteria:
  - all_issues_completed: true
  - no_duplicate_implementations: true
`;

describe('parseScenario', () => {
  it('parses valid scenario YAML', () => {
    const scenario = parseScenario(VALID_YAML);
    expect(scenario.name).toBe('test-scenario');
    expect(scenario.agents).toBe(2);
    expect(scenario.issues).toHaveLength(2);
    expect(scenario.issues[0].title).toBe('Add feature A');
    expect(scenario.issues[0].labels).toEqual(['backend']);
    expect(scenario.test_command).toBe('npm test');
    expect(scenario.timeout_minutes).toBe(30);
  });

  it('defaults test_command to npm test', () => {
    const minimal = `
name: minimal
description: "test"
agents: 1
base_branch: main
issues:
  - title: "Do a thing"
    description: "desc"
`;
    const scenario = parseScenario(minimal);
    expect(scenario.test_command).toBe('npm test');
    expect(scenario.timeout_minutes).toBe(30);
  });

  it('throws if agents count does not match issue count', () => {
    const mismatch = `
name: bad
description: "mismatch"
agents: 3
base_branch: main
issues:
  - title: "Only one issue"
    description: "desc"
`;
    expect(() => parseScenario(mismatch)).toThrow('agents count (3) must match issue count (1)');
  });

  it('throws if name is missing', () => {
    const noName = `
description: "no name"
agents: 1
base_branch: main
issues:
  - title: "Task"
    description: "desc"
`;
    expect(() => parseScenario(noName)).toThrow();
  });
});
