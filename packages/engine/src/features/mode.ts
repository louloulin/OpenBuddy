import type { EngineContext } from "../engine-context.js";
import { READ_ONLY_TOOLS, type AgentMode } from "../types.js";

export function setMode(engine: EngineContext, id: string, mode: AgentMode) {
  const slot = engine.slot(id);
  engine.modes.set(id, mode);
  slot.session.setActiveToolsByName(mode === "craft" ? slot.defaultTools : slot.defaultTools.filter((name) => READ_ONLY_TOOLS.includes(name)));
}
export function mode(engine: EngineContext, id: string): AgentMode { return engine.modes.get(id) ?? "craft"; }
