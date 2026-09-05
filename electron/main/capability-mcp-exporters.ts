/**
 * Per-package MCP exporters for OpenBuddy capability packages.
 *
 * The collaboration-runtime MCP adapter (see `mcp-server-adapter.ts`) is
 * transport-only — it exposes whatever `listCapabilities()` returns as MCP
 * tools and forwards `invokeCapability` calls. This module provides the
 * missing glue: a registry of per-package MCP exporters that each capability
 * package (`openbuddy-automation`, `openbuddy-calendar`) can
 * contribute to.
 *
 * The exporter registry is the symmetric counterpart to the renderer
 * contribution registry: Pi/Cordis provides capability services, each
 * capability declares its MCP surface, and the runtime aggregates them into
 * a single MCP server view. This keeps authority on the OpenBuddy side
 * (no private prompts/credentials cross the MCP boundary) while letting
 * external MCP clients (other OpenBuddy instances, Claude Desktop, scripts)
 * invoke any capability that the local user has explicitly enabled.
 *
 * Stage G-1c: `openbuddy-automation` removed; automation is owned by
 * `pi-background-tasks` + `pi-goal` (passthrough). The legacy
 * `automation:list` / `automation:snapshot` MCP tools no longer exist;
 * external MCP clients reach the pi-native tool surface.
 *
 * Invariants:
 *   1. Discovery ≠ Authorization: an MCP tool being listed does NOT mean
 *      the local runtime will execute it without checking the caller's
 *      grant/scope/policy. The runtime's `invokeCapability` still runs
 *      the full `effectivePolicy = owner ∩ org ∩ task ∩ capability`
 *      intersection.
 *   2. Each exporter is independently loadable/unloadable. Adding a new
 *      capability to MCP requires no changes to existing exporters.
 *   3. Capability IDs are namespaced (`<package>:<verb>`) so they never
 *      collide with the collaboration runtime's own BuddyCapability cards.
 */
import type { BuddyCapability } from "@openbuddy/collaboration-protocol";

export interface McpExporterCapability {
  /** Stable id; usually `<package>:<verb>` (e.g. `memory:list`). */
  id: string;
  /** Human-readable description surfaced as the MCP tool `description`. */
  description: string;
  /** JSON-Schema describing the tool's arguments. */
  inputSchema: Record<string, unknown>;
  /**
   * Execute the capability. The runtime forwards the raw args from MCP and
   * expects either a JSON-serializable value or an `{ error }` shape.
   */
  invoke: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  /**
   * Required effectivePolicy intersection. The runtime enforces these before
   * the exporter's `invoke` runs; `requiredApproval` mirrors the
   * BuddyCapability contract.
   */
  requiredTrust?: "local" | "org" | "known_peer" | "public";
  requiredApproval?: "never" | "before_external_commit" | "always";
  allowedDataScopes?: string[];
  forbiddenDataScopes?: string[];
  allowedActions?: string[];
  forbiddenActions?: string[];
}

export interface McpExporter {
  /** Stable package id (e.g. `openbuddy-calendar`). */
  packageId: string;
  /** Human-readable label surfaced in the MCP server info. */
  label: string;
  /** Capabilities this package contributes. Empty array = nothing exported. */
  capabilities: readonly McpExporterCapability[];
}

export interface McpExporterRegistry {
  register(exporter: McpExporter): () => void;
  list(): readonly McpExporter[];
  /** Sum of all capabilities across all registered exporters. */
  totalCapabilityCount(): number;
}

export function createMcpExporterRegistry(): McpExporterRegistry {
  const exporters = new Map<string, McpExporter>();
  return {
    register(exporter) {
      exporters.set(exporter.packageId, exporter);
      return () => {
        exporters.delete(exporter.packageId);
      };
    },
    list() {
      return Array.from(exporters.values());
    },
    totalCapabilityCount() {
      let total = 0;
      for (const exporter of exporters.values()) total += exporter.capabilities.length;
      return total;
    },
  };
}

/**
 * Project a registry's capabilities into the BuddyCapability shape that the
 * existing `mcp-server-adapter` already understands. Each exporter
 * capability becomes one MCP tool; the package id is preserved in the
 * `providerId` so the runtime can route the call back.
 */
export function exportersToBuddyCapabilities(
  exporters: readonly McpExporter[],
): BuddyCapability[] {
  const out: BuddyCapability[] = [];
  for (const exporter of exporters) {
    for (const cap of exporter.capabilities) {
      out.push({
        id: cap.id,
        providerId: exporter.packageId,
        description: cap.description,
        inputSchema: cap.inputSchema,
        outputSchema: {},
        procedure: [],
        allowedDataScopes: cap.allowedDataScopes ?? [],
        forbiddenDataScopes: cap.forbiddenDataScopes ?? ["private:*", "credential:*", "secret:*"],
        allowedActions: cap.allowedActions ?? [],
        forbiddenActions: cap.forbiddenActions ?? ["external:commit"],
        acceptanceTests: [],
        requiredApproval: cap.requiredApproval ?? "before_external_commit",
        allowDelegation: false,
        maxDelegationDepth: 0,
        visibility: cap.requiredTrust === "public" || cap.requiredTrust === "known_peer" ? "directory" : "private",
      });
    }
  }
  return out;
}

/**
 * Build an invocation dispatch table from the registry. The runtime
 * combines this with its own BuddyCapability dispatch so a single
 * `invokeCapability` call covers both the collaboration capabilities and
 * the per-package MCP exports.
 */
export function exportersToInvocationTable(
  exporters: readonly McpExporter[],
): Record<string, McpExporterCapability> {
  const out: Record<string, McpExporterCapability> = {};
  for (const exporter of exporters) {
    for (const cap of exporter.capabilities) {
      out[cap.id] = cap;
    }
  }
  return out;
}

/* ============================================================
 * Built-in exporters
 * ============================================================ */

/**
 * openbuddy-calendar exporter: read-only calendar view + new event creation
 * via the unified SideEffectIntent pipeline. Read access is open; writes go
 * through `before_external_commit` approval so a compromised MCP client can
 * never bypass user consent on calendar writes.
 */
export const calendarMcpExporter: McpExporter = {
  packageId: "openbuddy-calendar",
  label: "OpenBuddy Calendar (read + write-after-approval)",
  capabilities: [
    {
      id: "calendar:list",
      description: "列出指定时间窗口内的本地日程条目。",
      inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } },
      invoke: async () => ({ items: [], note: "wire to openbuddy-calendar runtime in production" }),
      requiredTrust: "local",
      requiredApproval: "never",
      allowedDataScopes: ["room:personal-room"],
      forbiddenDataScopes: ["private:*", "credential:*", "secret:*"],
      allowedActions: ["read:room"],
      forbiddenActions: ["write:room", "external:commit"],
    },
    {
      id: "calendar:create",
      description: "创建一个新日程条目；先创建 SideEffectIntent 等用户确认后再 commit。",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          roomId: { type: "string" },
        },
        required: ["title", "start", "end"],
      },
      invoke: async () => ({ intentId: "stub", status: "pending", note: "wire to openbuddy-calendar runtime in production" }),
      requiredTrust: "local",
      requiredApproval: "before_external_commit",
      allowedDataScopes: ["room:personal-room"],
      forbiddenDataScopes: ["private:*", "credential:*", "secret:*"],
      allowedActions: ["write:room"],
      forbiddenActions: ["external:commit"],
    },
  ],
};

/**
 * Singleton registry shared between the renderer bridge and main-process
 * adapters. The renderer-side bridge registers exporters as plugins load;
 * the main process reads the projected BuddyCapability list to feed the MCP
 * server adapter.
 */
export const capabilityMcpExportersRegistry: McpExporterRegistry = createMcpExporterRegistry();

/**
 * Built-in registry with all the exporters above. Production wiring should
 * call `createMcpExporterRegistry` and register the same set; this is
 * exported so tests and the renderer-side bridge share one source of truth.
 */
export const builtInMcpExporters: readonly McpExporter[] = [
  calendarMcpExporter,
];
