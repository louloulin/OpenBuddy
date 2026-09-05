import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BuddyCapability } from "@openbuddy/collaboration-protocol";

/**
 * OpenBuddy ↔ MCP server adapter.
 *
 * Exposes the runtime's locally-registered BuddyCapability cards as MCP tools
 * so external MCP-compatible agents (other OpenBuddy instances, Claude
 * Desktop, custom scripts, etc.) can invoke them via the standard Model
 * Context Protocol. The adapter is a thin transport: it does NOT execute
 * capabilities itself; the caller wires `listCapabilities` and
 * `invokeCapability` to the existing PersonalProviderRegistry /
 * OrganizationProviderRegistry / EventStore pipeline. This keeps authorization,
 * redacted projections, evidence and audit chains on the OpenBuddy side.
 *
 * Design notes:
 * - `listCapabilities` is called on every `tools/list` so capability cards
 *   added after start become discoverable without a restart.
 * - `invokeCapability` receives the raw MCP args object; the caller is
 *   responsible for wrapping it into a BuddyTaskEnvelope, applying the
 *   effective policy, and producing artifacts/evidence.
 * - Errors are returned as MCP tool results with `isError: true` and a
 *   human-readable text payload; thrown exceptions from the transport are
 *   caught and surfaced as protocol-level errors.
 */
export interface McpServerAdapterOptions {
  serverName: string;
  serverVersion: string;
  /**
   * Return the currently available capabilities. Called on every
   * `tools/list` request so capability cards added after start become
   * discoverable.
   */
  listCapabilities: () => Promise<readonly BuddyCapability[]> | readonly BuddyCapability[];
  /**
   * Optional list of per-package MCP exporters (see
   * `capability-mcp-exporters.ts`). When provided, the adapter combines
   * the collaboration runtime's BuddyCapabilities with the exporter
   * projection and routes `invokeCapability` to whichever side owns the
   * id. Default: empty array.
   */
  exporters?: readonly { packageId: string; capabilities: ReadonlyArray<{ id: string; invoke: (args: Record<string, unknown>) => Promise<unknown> | unknown }> }[];
  /**
   * Invoke a single capability by id with the given JSON args. Return value
   * is serialized to MCP tool content (text or image). The contract is
   * intentionally tiny so the same adapter works for personal, organization
   * and network capabilities.
   */
  invokeCapability: (input: { capability: BuddyCapability; args: Record<string, unknown> }) => Promise<McpInvokeResult>;
}

export interface McpInvokeResult {
  /** Text or structured content blocks returned to the MCP client. */
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}

export interface McpServerAdapter {
  serverName(): string;
  serverVersion(): string;
  listToolCount(): number;
  start(transport: StdioServerTransport): Promise<void>;
  stop(): Promise<void>;
}

interface JsonSchemaObject {
  readonly type?: "object";
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | Record<string, unknown>;
}

/**
 * Coerce a BuddyCapability's `inputSchema` (which is `{}` for untyped
 * capabilities) into a valid JSON-Schema object that MCP can advertise. The
 * empty schema is treated as a free-form object so we never expose
 * `additionalProperties: false` by accident.
 */
function toMcpInputSchema(schema: unknown): JsonSchemaObject {
  if (schema && typeof schema === "object" && !Array.isArray(schema)) {
    const candidate = schema as JsonSchemaObject;
    if (candidate.type === "object" && candidate.properties && typeof candidate.properties === "object") {
      return candidate;
    }
  }
  return { type: "object", additionalProperties: true };
}

/**
 * Convert an arbitrary value to a JSON string suitable for MCP text content.
 * Falls back to `String(value)` when the value is not JSON-serializable.
 */
function toJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Pure handler used by both the MCP Server and the unit tests. */
export async function buildListToolsResponse(options: McpServerAdapterOptions): Promise<{ tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }> {
  const capabilities = await Promise.resolve(options.listCapabilities());
  const exporterCapabilities = (options.exporters ?? []).flatMap((exp) => exp.capabilities.map((cap) => ({
    id: cap.id,
    description: cap.id,
    inputSchema: {},
  })));
  return {
    tools: [
      ...capabilities.map((capability) => ({
        name: capability.id,
        description: capability.description || `Invoke Buddy capability ${capability.id}.`,
        inputSchema: toMcpInputSchema(capability.inputSchema) as Record<string, unknown>,
      })),
      ...exporterCapabilities.map((cap) => ({
        name: cap.id,
        description: cap.description,
        inputSchema: toMcpInputSchema(cap.inputSchema) as Record<string, unknown>,
      })),
    ],
  };
}

/** Pure handler used by both the MCP Server and the unit tests. */
export async function buildCallToolResponse(
  options: McpServerAdapterOptions,
  params: { name: string; arguments?: Record<string, unknown> },
): Promise<CallToolResult> {
  const toolName = params.name;
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  // Check per-package exporters first — they have their own invoke handler.
  for (const exporter of options.exporters ?? []) {
    const exporterCap = exporter.capabilities.find((c) => c.id === toolName);
    if (exporterCap) {
      try {
        const result = await exporterCap.invoke(args);
        return {
          content: [{ type: "text", text: toJsonText(result) }],
        } satisfies CallToolResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `capability ${toolName} failed: ${message}` }],
          isError: true,
        } satisfies CallToolResult;
      }
    }
  }
  const capabilities = await Promise.resolve(options.listCapabilities());
  const capability = capabilities.find((candidate) => candidate.id === toolName);
  if (!capability) {
    return {
      content: [{ type: "text", text: `unknown capability: ${toolName}` }],
      isError: true,
    };
  }
  try {
    const invocation = await options.invokeCapability({ capability, args });
    return {
      content: invocation.content,
      ...(invocation.isError ? { isError: true } : {}),
    } satisfies CallToolResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `capability ${toolName} failed: ${message}` }],
      isError: true,
    } satisfies CallToolResult;
  }
}

export function createMcpServerAdapter(options: McpServerAdapterOptions): McpServerAdapter {
  const server = new Server(
    { name: options.serverName, version: options.serverVersion },
    { capabilities: { tools: {} } },
  );

  let toolCount = 0;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const response = await buildListToolsResponse(options);
    toolCount = response.tools.length;
    return response;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const params = { name: request.params.name, ...(request.params.arguments ? { arguments: request.params.arguments as Record<string, unknown> } : {}) };
    return buildCallToolResponse(options, params);
  });

  return {
    serverName: () => options.serverName,
    serverVersion: () => options.serverVersion,
    listToolCount: () => toolCount,
    async start(transport) {
      await server.connect(transport);
    },
    async stop() {
      try { await server.close(); } catch { /* ignore */ }
    },
  };
}

/**
 * Wire an MCP server adapter to a CollaborationRuntime.
 *
 * The runtime owns the local BuddyCapability cards, the personal/organization
 * providers, the EventStore and the authorization pipeline. The adapter is
 * transport-only; this helper bridges the two by delegating list/invoke to
 * the runtime's `listMcpCapabilities` and `invokeMcpCapability` methods.
 *
 * @param runtime The local CollaborationRuntime to expose via MCP.
 * @param options Optional overrides for server name/version and invocation
 *   timeout. The defaults match the runtime's identity id and a 30s
 *   server-side timeout to prevent runaway tool calls from blocking the
 *   transport.
 */
export function createMcpServerAdapterForRuntime(
  runtime: {
    serverName?: string;
    serverVersion?: string;
    listMcpCapabilities(): unknown;
    invokeMcpCapability(input: { capabilityId: string; args: Record<string, unknown> }): Promise<unknown>;
  },
  options: { serverName?: string; serverVersion?: string } = {},
): McpServerAdapter {
  return createMcpServerAdapter({
    serverName: options.serverName ?? runtime.serverName ?? "openbuddy",
    serverVersion: options.serverVersion ?? runtime.serverVersion ?? "0.0.0",
    listCapabilities: () => runtime.listMcpCapabilities() as readonly BuddyCapability[],
    invokeCapability: async ({ capability, args }) => {
      const result = await runtime.invokeMcpCapability({ capabilityId: capability.id, args });
      return {
        content: [{ type: "text", text: toJsonText(result) }],
      };
    },
  });
}

/** Re-export the schema coercion helper for tests and external adapters. */
export { toMcpInputSchema, toJsonText };
