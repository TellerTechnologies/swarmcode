/**
 * Extracts a Linear issue identifier from a git branch name.
 *
 * Matches patterns like:
 *   feat/ENG-123-auth-flow  → ENG-123
 *   fix/app-7-login-bug     → APP-7
 *   jared/core-999-refactor → CORE-999
 *   eng-1                   → ENG-1
 *   ENG-42                  → ENG-42
 *   feature/my-thing        → null (no issue ID)
 *
 * The pattern is: 1+ uppercase letters, a hyphen, 1+ digits.
 * Case insensitive on input, always returns uppercase.
 */

const ISSUE_ID_PATTERN = /\b([a-zA-Z]+-\d+)\b/;

/**
 * Extract a Linear issue identifier from a branch name.
 * Returns the identifier in uppercase (e.g. "ENG-123") or null if not found.
 */
export function extractIssueId(branchName: string): string | null {
  const match = branchName.match(ISSUE_ID_PATTERN);
  if (!match) return null;
  return match[1].toUpperCase();
}

/**
 * Check if a commit message already contains an issue identifier.
 */
export function messageHasIssueId(message: string): boolean {
  return ISSUE_ID_PATTERN.test(message);
}

/**
 * Prepend an issue identifier to a commit message if it doesn't already contain one.
 * Returns the (possibly modified) message.
 */
export function prependIssueId(message: string, issueId: string): string {
  if (messageHasIssueId(message)) return message;
  return `${issueId}: ${message}`;
}
