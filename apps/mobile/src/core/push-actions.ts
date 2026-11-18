/**
 * Answering an approval from the notification itself (20261117-mobile.md E4).
 *
 * iOS renders the registered `approval` category's buttons; a press arrives as
 * a notification response, not a tap. The mapping lives here so the root
 * layout stays a wiring file and the decision is testable without a device.
 */

/** Category and action identifiers, shared by the register call and this parser. */
export const APPROVAL_CATEGORY = 'approval'
export const APPROVE_ACTION = 'approve'
export const DENY_ACTION = 'deny'

export type NotificationDecision = { requestId: string; approved: boolean }

/**
 * The approval a response answers, or null when the response is an ordinary
 * open (default action). `DEFAULT_ACTION_IDENTIFIER` is Expo's own constant;
 * the string is repeated here so the core module has no native import.
 */
export function decisionForResponse(
  actionIdentifier: string,
  data: Record<string, unknown> | null | undefined,
): NotificationDecision | null {
  if (actionIdentifier !== APPROVE_ACTION && actionIdentifier !== DENY_ACTION) return null
  const requestId = typeof data?.requestId === 'string' ? data.requestId : ''
  if (!requestId) return null
  return { requestId, approved: actionIdentifier === APPROVE_ACTION }
}
