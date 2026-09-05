/**
 * pi-service-keys.ts — typed registry of every Cordis service key the Pi
 * compatibility adapter resolves through `state.context.get(...)`.
 *
 * Stage D Friction #5: the legacy `serviceKey: string` field lets the adapter
 * table drift away from the actual Cordis service identifiers silently — a
 * typo in either the adapter declaration or the Cordis plugin mount key
 * surfaces only at runtime as a "service not found" notification. Promoting
 * the union to a typed literal constrains both ends to one source of truth
 * and lets `resolveService` accept a `ServiceKey` instead of an `unknown`
 * string.
 */
export const PI_SERVICE_KEYS = [
  "mcpClient",
  "webSearch",
  "permission",
  "memory",
  "team",
  "plan",
  "task",
  "automation",
  "folder-trust",
  "notification",
  "sessions",
  "fsLocal",
  "lens",
  "simplify",
  "hashline",
  "worktree",
] as const;

export type ServiceKey = (typeof PI_SERVICE_KEYS)[number];

export type ServiceKeyResolver = (key: ServiceKey) => unknown;

export function isServiceKey(value: string): value is ServiceKey {
  return (PI_SERVICE_KEYS as readonly string[]).includes(value);
}
