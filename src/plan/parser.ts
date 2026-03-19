import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface PlanAssignment {
  feature: string;
  owner: string;
  details: string[];
}

export interface ProjectPlan {
  raw: string;
  assignments: PlanAssignment[];
  sharedContext: string;
}

// Matches assignment lines in multiple formats:
//   - **Feature** - Owner          (bold feature, hyphen)
//   - **Feature** — Owner          (bold feature, em-dash)
//   - Feature - Owner              (plain feature, hyphen)
//   - Feature — Owner              (plain feature, em-dash)
// Both "Feature - Owner" and "Owner — Role" patterns work (feature/owner are interchangeable labels)
const ASSIGNMENT_RE = /^- \*\*(.+?)\*\*\s+[-—–]\s+(.+?)$|^- ([^*\n]+?)\s+[-—–]\s+(.+?)$/;
// Matches indented sub-bullet items (with optional backtick-wrapped paths)
const DETAIL_RE = /^\s{2,}- (.+)/;

export function parsePlan(projectDir: string): ProjectPlan | null {
  const planPath = join(projectDir, 'PLAN.md');

  if (!existsSync(planPath)) {
    return null;
  }

  const raw = readFileSync(planPath, 'utf-8');
  const lines = raw.split('\n');

  const assignments: PlanAssignment[] = [];
  let sharedContext = '';
  let inSharedSection = false;
  let sharedLines: string[] = [];

  let currentAssignment: PlanAssignment | null = null;

  for (const line of lines) {
    // Detect "## Shared" heading
    if (/^##\s+Shared/.test(line)) {
      inSharedSection = true;
      // Finalize any open assignment
      if (currentAssignment) {
        assignments.push(currentAssignment);
        currentAssignment = null;
      }
      continue;
    }

    // If we hit another ## heading after entering shared, exit shared section
    if (inSharedSection && /^##\s+/.test(line)) {
      inSharedSection = false;
    }

    if (inSharedSection) {
      sharedLines.push(line);
      continue;
    }

    // Try to match an assignment line
    const assignMatch = ASSIGNMENT_RE.exec(line);
    if (assignMatch) {
      // Push any previous assignment
      if (currentAssignment) {
        assignments.push(currentAssignment);
      }
      // Bold form: groups 1 & 2; plain form: groups 3 & 4
      const feature = (assignMatch[1] ?? assignMatch[3]).trim();
      const owner = (assignMatch[2] ?? assignMatch[4]).trim();
      currentAssignment = { feature, owner, details: [] };
      continue;
    }

    // Try to match a detail (indented bullet) under the current assignment
    if (currentAssignment) {
      const detailMatch = DETAIL_RE.exec(line);
      if (detailMatch) {
        currentAssignment.details.push(detailMatch[1].trim());
        continue;
      }

      // A blank line or non-matching line ends the current assignment's detail block
      // but we don't close the assignment yet — only a new top-level item does
    }
  }

  // Flush last open assignment
  if (currentAssignment) {
    assignments.push(currentAssignment);
  }

  sharedContext = sharedLines.join('\n').trim();

  return { raw, assignments, sharedContext };
}
