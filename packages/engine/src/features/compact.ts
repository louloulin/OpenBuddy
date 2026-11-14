import type { EngineContext } from "../engine-context.js";

/** /compact: summarise older history into a compaction entry to free context. */
export async function compact(engine: EngineContext, id: string, instructions?: string) {
  const slot = engine.slot(id);
  if (slot.busy) throw Error("会话忙碌");
  const generation = slot.generation;
  slot.busy = true;
  engine.emitStatus(slot);
  try {
    const result = await slot.session.compact(instructions?.trim() || undefined);
    engine.invalidateList();
    return { tokensBefore: result.tokensBefore, tokensAfter: result.estimatedTokensAfter };
  } finally {
    if (generation === slot.generation) {
      slot.busy = false;
      engine.emitStatus(slot);
      if (slot.stale && engine.slots.get(id) === slot) void engine.rebuild(slot).catch(() => {});
    }
  }
}
