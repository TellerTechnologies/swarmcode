import { writeFileSync } from 'node:fs';
import type { Scorecard } from './types.js';

export function computeGrade(card: Scorecard): { grade: Scorecard['grade']; gradeReason: string } {
  const allCompleted = card.agents.every(a => a.issueCompleted);
  const anyTimedOut = card.agents.some(a => a.timedOut);
  const mergeFailures = card.mergeResults.filter(m => !m.success).length;

  // D: fundamental failures
  if (!card.issueDeduplication) {
    return { grade: 'D', gradeReason: 'Agents claimed the same issue. Issue deduplication failed.' };
  }
  if (!allCompleted || anyTimedOut) {
    return { grade: 'D', gradeReason: `Agents failed to complete work. ${card.agents.filter(a => !a.issueCompleted).length} issue(s) incomplete.` };
  }
  if (!card.testsPass) {
    return { grade: 'D', gradeReason: 'Tests fail on merged result. Agents produced incompatible code.' };
  }
  if (card.duplicateWork > 0) {
    return { grade: 'D', gradeReason: `Duplicate work detected: ${card.duplicateWork} instance(s).` };
  }

  // C: unresolvable merge problems
  if (mergeFailures > 0) {
    return { grade: 'C', gradeReason: `${mergeFailures} branch(es) failed to merge. Conflicts require manual resolution.` };
  }

  // B: conflicts that were auto-resolved
  const autoResolved = card.conflictsAutoResolved ?? 0;
  if (autoResolved > 0) {
    return { grade: 'B', gradeReason: `Good coordination. ${autoResolved} conflict(s) auto-resolved with patience merge strategy.` };
  }

  // A: perfect
  return { grade: 'A', gradeReason: 'Perfect run, zero conflicts, zero duplication, all tests pass.' };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function formatScorecard(card: Scorecard): string {
  const sep = '═'.repeat(50);
  const allIssuesCompleted = card.agents.every(a => a.issueCompleted);
  const allMerged = card.mergeResults.every(m => m.success);
  const conflictFiles = card.mergeResults.flatMap(m => m.conflictFiles);

  const lines: string[] = [
    sep,
    `  SWARMCODE TEST: ${card.scenarioName}`,
    `  ${card.totalAgents} agents · ${card.agents.length} issues · ${formatDuration(card.totalDurationSeconds)} total`,
    sep,
    '',
    '  OUTCOME',
    `  ${allIssuesCompleted ? '✓' : '✗'} All issues completed`,
    `  ${allMerged ? '✓' : '✗'} All branches merged`,
    `  ${card.testsPass ? '✓' : '✗'} Tests pass on merged result`,
  ];

  if (conflictFiles.length > 0) {
    lines.push(`  ✗ ${conflictFiles.length} conflict(s) (${conflictFiles.join(', ')})`);
  }

  lines.push('');
  lines.push('  COORDINATION');
  lines.push(`  Issue deduplication:  ${card.issueDeduplication ? '✓' : '✗'}  (${card.issueDeduplication ? 'all agents picked unique issues' : 'DUPLICATE CLAIMS'})`);
  lines.push(`  Conflicts resolved:   ${card.conflictsAutoResolved}${card.conflictsAutoResolved > 0 ? '  (auto-merged with patience strategy)' : ''}`);
  lines.push(`  Conflicts unresolved: ${card.conflictsUnresolved}`);
  lines.push(`  Duplicate work:       ${card.duplicateWork}`);
  lines.push(`  Files touched by 2+:  ${card.filesOverlap.length}`);

  const hasAgentTypes = card.agents.some(a => a.agentType);

  lines.push('');
  lines.push('  PER AGENT');
  if (hasAgentTypes) {
    lines.push('  ┌──────────┬────────────────────┬──────────┬──────────┬────────────┐');
    lines.push('  │ Agent    │ Type               │ Commits  │ Time     │ Issue      │');
    lines.push('  ├──────────┼────────────────────┼──────────┼──────────┼────────────┤');
    for (const a of card.agents) {
      const status = a.timedOut ? '⏱' : a.issueCompleted ? '✓' : '✗';
      const type = (a.agentType ?? 'default').padEnd(18);
      lines.push(`  │ ${a.agentId.padEnd(8)} │ ${type} │ ${String(a.commits).padEnd(8)} │ ${formatDuration(a.durationSeconds).padEnd(8)} │ ${a.issueIdentifier} ${status} │`);
    }
    lines.push('  └──────────┴────────────────────┴──────────┴──────────┴────────────┘');
  } else {
    lines.push('  ┌──────────┬──────────┬──────────┬────────────┐');
    lines.push('  │ Agent    │ Commits  │ Time     │ Issue      │');
    lines.push('  ├──────────┼──────────┼──────────┼────────────┤');
    for (const a of card.agents) {
      const status = a.timedOut ? '⏱' : a.issueCompleted ? '✓' : '✗';
      lines.push(`  │ ${a.agentId.padEnd(8)} │ ${String(a.commits).padEnd(8)} │ ${formatDuration(a.durationSeconds).padEnd(8)} │ ${a.issueIdentifier} ${status} │`);
    }
    lines.push('  └──────────┴──────────┴──────────┴────────────┘');
  }

  lines.push('');
  lines.push(`  GRADE: ${card.grade}`);
  lines.push(`  ${card.gradeReason}`);
  lines.push(sep);

  return lines.join('\n');
}

export function saveScorecard(card: Scorecard, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(card, null, 2) + '\n');
}
