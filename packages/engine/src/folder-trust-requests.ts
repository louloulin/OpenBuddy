import type { Settings } from "@openbuddy/services/settings/settings";

/**
 * Untrusted folders a session was opened in (20261117-mobile.md §2.4 path 3).
 *
 * `openSlot` emits `agent://folder-trust` exactly once, at open time. A phone
 * that was backgrounded then never hears about it, so the request is kept here
 * until answered and replayed by the `trust_pending` command.
 *
 * Lives outside `PiEngine` so that file stays within the boundary size budget.
 */
export class FolderTrustRequests {
  private requests = new Map<string, { cwd: string; sessionId: string }>();
  constructor(
    private settings: Settings,
    private trusted: (cwd: string) => boolean,
  ) {}
  /** Record an untrusted, undecided folder. Idempotent per session. */
  record(cwd: string, sessionId: string) {
    if (this.trusted(cwd) || this.settings.config.read().folderTrustDecisions?.[cwd] !== undefined) return;
    this.requests.set(sessionId, { cwd, sessionId });
  }
  /** Cards a reconnecting client can rebuild, isomorphic to `agent://folder-trust`. */
  pending(sessionId?: string) {
    return [...this.requests.values()].filter((request) => !sessionId || request.sessionId === sessionId);
  }
  /** The folder was answered (trusted or not): no client should be offered it again. */
  forget(cwd: string) {
    for (const [id, request] of this.requests) if (request.cwd === cwd) this.requests.delete(id);
  }
  forgetSession(sessionId: string) {
    this.requests.delete(sessionId);
  }
}
