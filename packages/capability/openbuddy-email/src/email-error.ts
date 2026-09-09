/**
 * @openbuddy/capability-email/email-error — Email error class.
 *
 * Phase H.2 of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v22 §42.5):
 *   Extract the `EmailError` class out of index.ts as the first
 *   piece of the larger email-class split. EmailError is a typed
 *   Error subclass used by the Email Cordis service + the IPC
 *   layer to signal capability-level failures.
 *
 * 5 code literals: provider_unavailable / confirmation_required /
 * invalid_input / operation_failed / operation_not_supported.
 * `retryAfterMs` is optional and exposed to the renderer so the
 * UI can show a "retry in N seconds" hint.
 *
 * Reverse-dep invariant:
 *   imports nothing from electron/main/ and nothing from index.ts.
 */

export type EmailErrorCode =
  | "provider_unavailable"
  | "confirmation_required"
  | "invalid_input"
  | "operation_failed"
  | "operation_not_supported";

export class EmailError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "EmailError";
  }
}