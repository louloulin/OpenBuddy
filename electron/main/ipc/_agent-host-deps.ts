/**
 * _agent-host-deps.ts — shared deps type for capability IPC modules.
 *
 * Phase B.1 round 3 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Each per-capability
 * IPC module under electron/main/ipc/<capability>.ts accepts the same deps
 * bundle so they can be registered standalone in the microkernel boot.
 *
 * Why this exists (the architectural story):
 *   The legacy `registerAgentIpc()` closes over `agentHost`, `ensureAgentHost`,
 *   `inflightAbortControllers`, `awaitExtensionsBound`, `casdoorAuth` and
 *   other module-level state. Splitting handlers out one-by-one requires
 *   those state fragments to be passed as parameters. The deps bag below
 *   captures the most commonly-needed subset; capability modules that need
 *   additional state can extend it.
 */
import type { BrowserWindow } from "electron";
import type { AgentHostFacade } from "../agent/host-modules/bootstrap/build-agent-host-facade";
import type { CasdoorAuthService } from "../casdoor/casdoor-auth";

/**
 * The shape of the agentHost facade. We import AgentHostFacade directly
 * (the same type that `agentHost` in agent-host-proxy.ts is typed as)
 * so deps bags can be passed by-reference without re-narrowing.
 */
export type AgentHostShape = AgentHostFacade;

/**
 * Minimum surface of the CasdoorAuthService that capability modules need.
 * Using the concrete type (not a structural stub) preserves narrowing.
 */
export type CasdoorAuthShape = CasdoorAuthService;

export interface AgentHostIpcDeps {
  /** Resolves the agentHost facade (lazy). */
  ensureAgentHost: () => Promise<void>;
  /** Direct handle to the agent host for synchronous helpers (after ensure). */
  agentHost: AgentHostShape;
  /** Casdoor authorization facade. The current microkernel boot
   * contract always provides one (legacy import from casdoor-auth.ts),
   * so this is non-optional at the type level. Optionals would risk
   * dropping the call site silently. */
  casdoorAuth: CasdoorAuthShape;
  /** AbortController registry for in-flight prompt / steer / follow-up calls. */
  inflightAbortControllers?: Map<string, AbortController>;
  /** Resolves when the extension host has finished binding. */
  awaitExtensionsBound?: () => Promise<void>;
  /** Window provider for renderer event emits. */
  getWindow: () => BrowserWindow | null;
}