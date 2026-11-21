import { collectArtifacts } from "../artifacts/collect.js";
import type { EngineContext } from "../engine-context.js";

// ---- 产物 / 快照 (20261115-ui §5.5–5.6) ----
/** Files this session created or modified (write/edit), from its full history. */
export async function artifacts(engine: EngineContext, id: string) {
  const slot = engine.slot(id);
  const entries = slot.session.sessionManager.getEntries() as unknown as Parameters<typeof collectArtifacts>[0];
  return collectArtifacts(entries, slot.session.sessionManager.getCwd(), await engine.checkpoints.list(id));
}
