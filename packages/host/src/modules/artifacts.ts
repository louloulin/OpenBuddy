import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";
/** §5.3 `artifacts` module. Session artifacts, checkpoints and turn revert. */
export function artifactsModule(ctx: HostContext): HostModule {
  const { engine } = ctx;
  const commands: Record<string, Handler> = {
    artifacts_list: (p) => engine.artifacts(text(p.sessionId)),
    checkpoint_list: (p) => engine.checkpointList(text(p.sessionId), typeof p.path === "string" ? p.path : undefined),
    checkpoint_read: (p) => engine.checkpointRead(text(p.sessionId), text(p.hash)),
    checkpoint_restore: (p) => engine.checkpointRestore(text(p.sessionId), text(p.path), typeof p.hash === "string" ? p.hash : null),
    turn_revert: (p) => engine.turnRevert(text(p.sessionId), p.toolCallIds as string[], { skip: Array.isArray(p.skip) ? (p.skip as string[]) : undefined, force: p.force === true }),
    artifact_save: (p) => engine.artifactSave(text(p.sessionId), text(p.path), String(p.content), p.origin === "apply" ? "apply" : "user"),
  };
  return { id: "artifacts", commands };
}
