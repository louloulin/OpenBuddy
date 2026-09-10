import type { AgentHostState } from "./_state-shape";

/**
 * Cancel UI requests owned by an older Pi generation.
 *
 * A session reload invalidates all pending select/confirm/input/editor
 * promises. Keeping this policy outside the coordinator makes the IPC
 * contract deterministic and prevents stale renderer answers from resolving
 * a newly-created session request.
 */
export function cancelStaleUiRequests(
  state: Pick<AgentHostState, "pendingUiRequests">,
  generation: number,
  emitPluginEvent: (type: string, payload: unknown) => void,
  previousGeneration?: number,
  reason = "pi-reload",
): number {
  let cancelled = 0;
  for (const [requestId, request] of state.pendingUiRequests) {
    if (request.generation === undefined || request.generation === generation) continue;
    state.pendingUiRequests.delete(requestId);
    request.resolve(undefined);
    emitPluginEvent("pi/ui-request-cancelled", {
      requestId,
      sessionId: request.sessionId,
      ...(previousGeneration === undefined ? {} : { previousGeneration }),
      generation,
      reason,
      diagnostic: "stale-generation",
    });
    cancelled += 1;
  }
  return cancelled;
}
