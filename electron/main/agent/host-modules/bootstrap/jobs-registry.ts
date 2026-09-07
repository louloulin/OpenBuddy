/**
 * bootstrap/jobs-registry.ts — host-scoped jobs registry factory.
 *
 * Phase 8.3 Batch D-7: split `agent-host.ts:initialize()` so the final
 * composition root reads as 8-10 stages of orchestration, not a wall of
 * inline closures. This stage owns:
 *   - the canonical jobs registry facade (register / update / list / get)
 *   - the `session/jobs` plugin event emission per mutation
 *   - returning the finished jobs object so wireContextServices can
 *     `context.provide("jobs", jobs)` in the next stage
 *
 * Why this stage exists:
 *   Pre-Batch-D-7 the 22-line jobs object literal lived inline between
 *   `createToolRegistry` and `wireContextServices` in `initialize()`.
 *   Moving it here gives `wireContextServices` a clean `jobs` dep and
 *   lets the registry be tested without standing up the full context.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are passed in.
 */

import { type AgentHostState } from "../_state-shape";
import type { HostJobRecord } from "../_state-shape";

/**
 * Dependencies required to build the jobs registry.
 */
export interface CreateJobsRegistryDeps {
  state: AgentHostState;
  emitPluginEvent: (type: string, payload: unknown) => void;
}

/**
 * Build the jobs registry facade. Caller passes the result into
 * `wireContextServices({ jobs, ... })` so `context.provide("jobs", jobs)`
 * exposes it to plugins.
 */
export function createJobsRegistry(deps: CreateJobsRegistryDeps) {
  const { state, emitPluginEvent } = deps;

  return {
    register: (job: Omit<HostJobRecord, "finishedAt">) => {
      state.jobsRegistry.set(job.id, { ...job });
      if (job.sessionId) emitPluginEvent("session/jobs", { sessionId: job.sessionId });
      return () => {
        state.jobsRegistry.delete(job.id);
        if (job.sessionId) emitPluginEvent("session/jobs", { sessionId: job.sessionId });
      };
    },
    update: (id: string, patch: Partial<HostJobRecord>) => {
      const current = state.jobsRegistry.get(id);
      if (!current) return;
      Object.assign(current, patch);
      if (current.sessionId) emitPluginEvent("session/jobs", { sessionId: current.sessionId });
    },
    list: (sessionId?: string) => [...state.jobsRegistry.values()]
      .filter((job) => sessionId === undefined || job.sessionId === sessionId)
      .map(({ controller, stop, output, error, ...job }) => job),
    get: (id: string) => state.jobsRegistry.get(id),
  };
}
