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
 * Extract a Linear issue identifier from a git branch name.
 *
 * Matches patterns like `feat/ENG-123-auth-flow` or `jared/core-999-refactor`.
 * The identifier must contain one or more letters, a hyphen, and one or more digits.
 *
 * @param branchName - The git branch name to parse
 * @returns The issue identifier in uppercase (e.g. `"ENG-123"`), or `null` if none is found
 *
 * @example
 * ```ts
 * extractIssueId("feat/eng-123-auth-flow"); // "ENG-123"
 * extractIssueId("feature/my-thing");       // null
 * ```
 */
export function extractIssueId(branchName: string): string | null {
  const match = branchName.match(ISSUE_ID_PATTERN);
  if (!match) return null;
  return match[1].toUpperCase();
}

/**
 * Check whether a commit message already contains an issue identifier.
 *
 * Uses the same pattern as {@link extractIssueId} to detect identifiers
 * anywhere in the message text.
 *
 * @param message - The commit message to check
 * @returns `true` if the message contains an issue identifier, `false` otherwise
 *
 * @example
 * ```ts
 * messageHasIssueId("ENG-123: fix login");  // true
 * messageHasIssueId("fix login bug");        // false
 * ```
 */
export function messageHasIssueId(message: string): boolean {
  return ISSUE_ID_PATTERN.test(message);
}

/**
 * Prepend an issue identifier to a commit message if it doesn't already contain one.
 *
 * If the message already includes an issue identifier (detected via
 * {@link messageHasIssueId}), it is returned unchanged. Otherwise the
 * identifier is prepended in the format `"ISSUE-ID: message"`.
 *
 * @param message - The original commit message
 * @param issueId - The issue identifier to prepend (e.g. `"ENG-123"`)
 * @returns The original message if it already contains an identifier, or the
 *   message with the identifier prepended
 *
 * @example
 * ```ts
 * prependIssueId("fix login", "ENG-123");          // "ENG-123: fix login"
 * prependIssueId("ENG-123: fix login", "ENG-123"); // "ENG-123: fix login"
 * ```
 */
export function prependIssueId(message: string, issueId: string): string {
  if (messageHasIssueId(message)) return message;
  return `${issueId}: ${message}`;
}
