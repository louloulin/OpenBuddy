import { isAbsolute } from "node:path";
import type { EngineContext } from "../engine-context.js";

export async function exportHtml(engine: EngineContext, id: string, outputPath: string) {
  if (!isAbsolute(outputPath)) throw Error("invalid_payload: outputPath");
  return engine.live(id).exportToHtml(outputPath);
}
