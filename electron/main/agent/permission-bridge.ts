/**
 * Host-core permission gateway implementation.
 *
 * Bridges `PermissionGateway` (electron/main/agent/pi-market-bridge.ts) to the
 * Rust host-core via the existing `HostProcess` stdio JSON-RPC channel. After a
 * plugin is installed, every non-high-risk capability is registered as an
 * `allow` rule tagged with `plugin:<id>:*` so it can be cleanly revoked on
 * uninstall.
 *
 * The TS layer (this file) owns the rule-shaping logic so the Rust side keeps
 * its single-responsibility `permissions.writeRules` surface. Failures here
 * are logged and surfaced to the bridge as a rejected promise; the bridge
 * already swallows them and continues the install.
 */
import type { PermissionGateway } from "../agent/pi-market-bridge.js";

export interface HostCallLike {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  notify?(method: string, params?: unknown): void;
}

export interface HostPermissionGatewayOptions {
  host: HostCallLike;
  logger?: { warn: (target: string, message: string, fields?: Record<string, unknown>) => void };
}

/** Compact-form encoding that mirrors Pi-Desktop's `parseCompact` semantics. */
function compactRule(tool: string, pattern?: string): string {
  return pattern ? `${tool}(${pattern})` : tool;
}

/**
 * Build the rule list that should be persisted after a plugin install. Rules
 * tagged `plugin:<id>` so uninstall can remove them in one atomic write.
 */
function buildGrantPayload(
  id: string,
  capabilities: readonly { id: string }[],
): Array<{ action: "allow"; tool: string; pattern: string }> {
  return capabilities.map((c) => ({
    action: "allow" as const,
    tool: c.id,
    pattern: `plugin:${id}`,
  }));
}

/**
 * Strip every rule whose `pattern` is `plugin:<id>` so uninstall cleanly
 * revokes the permission surface for that plugin without touching other rules.
 */
async function readAndFilterRules(host: HostCallLike, id: string): Promise<unknown[]> {
  const rules = (await host.call<unknown[]>("permissions.readRules")) ?? [];
  const prefix = `plugin:${id}`;
  return (rules as Array<{ pattern?: string; tool?: string }>).filter(
    (rule) => !(rule?.pattern === prefix || rule?.tool?.endsWith(`(${prefix})`)),
  );
}

export class HostPermissionGateway implements PermissionGateway {
  private readonly host: HostCallLike;
  private readonly logger: HostPermissionGatewayOptions["logger"];

  constructor(opts: HostPermissionGatewayOptions) {
    this.host = opts.host;
    this.logger = opts.logger;
  }

  async grantPlugin(input: {
    id: string;
    version: string;
    capabilities: readonly { id: string; risk?: "low" | "medium" | "high" }[];
  }): Promise<void> {
    const grantable = input.capabilities.filter((c) => c.risk !== "high");
    if (grantable.length === 0) return;
    const existing = await readAndFilterRules(this.host, input.id);
    const next = [
      ...(existing as Array<{ action: "allow" | "ask" | "deny"; tool: string; pattern?: string }>),
      ...buildGrantPayload(input.id, grantable),
    ];
    await this.host.call("permissions.writeRules", { rules: next });
  }

  async revokePlugin(id: string): Promise<void> {
    const next = await readAndFilterRules(this.host, id);
    await this.host.call("permissions.writeRules", { rules: next });
  }
}

/**
 * Lightweight in-memory fallback used in tests / when host-core is not yet
 * ready. It maintains its own rule list and never throws.
 */
export class InMemoryPermissionGateway implements PermissionGateway {
  private readonly rules = new Map<string, { action: "allow" | "ask" | "deny"; tool: string; pattern?: string }[]>();
  readonly grantCalls: Array<{ id: string; version: string; capabilities: readonly { id: string }[] }> = [];
  readonly revokeCalls: string[] = [];

  async grantPlugin(input: { id: string; version: string; capabilities: readonly { id: string }[] }): Promise<void> {
    this.grantCalls.push({ ...input, capabilities: [...input.capabilities] });
    const current = this.rules.get(input.id) ?? [];
    this.rules.set(
      input.id,
      [
        ...current,
        ...input.capabilities.map((c) => ({
          action: "allow" as const,
          tool: c.id,
          pattern: `plugin:${input.id}`,
        })),
      ],
    );
  }

  async revokePlugin(id: string): Promise<void> {
    this.revokeCalls.push(id);
    this.rules.delete(id);
  }

  /** Test helper. */
  rulesFor(id: string) {
    return this.rules.get(id) ?? [];
  }
}

/** Compact-form encoding helper exposed for tests + UI consumers. */
export { compactRule };
