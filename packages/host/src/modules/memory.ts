import { text } from "@openbuddy/services/settings/settings";
import type { MemoryScope } from "@openbuddy/services/memory/memory";
import type { Handler, HostContext, HostModule } from "../module.js";

/**
 * `memory` module (20261116-pii W5.1–W5.3): the 资料库 panel's memory tab. Command names match
 * the wrappers the renderer already used, so only the main-process side was missing.
 * Workspace memory is gated on folder trust (the engine's `trusted`), never on the payload.
 */
const scope = (value: unknown): MemoryScope => {
  if (value !== "global" && value !== "workspace") throw Error("invalid_scope: 记忆范围必须是 global 或 workspace");
  return value;
};
const cwdOf = (p: Record<string, unknown>, fallback?: string) => (typeof p.cwd === "string" && p.cwd ? p.cwd : fallback);

export function memoryModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    memory_list: (p) => engine.memory.list(cwdOf(p, engine.currentCwd)),
    memory_get: (p) => engine.memory.get(scope(p.scope), text(p.path), cwdOf(p, engine.currentCwd)),
    memory_save: (p) =>
      engine.memory.save(scope(p.scope), text(p.path), typeof p.content === "string" ? p.content : "", cwdOf(p, engine.currentCwd)),
    memory_delete: (p) => engine.memory.delete(scope(p.scope), text(p.path), cwdOf(p, engine.currentCwd)),
    memory_rewrite: () => engine.memory.rewrite(),
  };
  return { id: "memory", commands };
}
