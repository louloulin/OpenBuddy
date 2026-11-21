import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import type { EngineContext } from "../engine-context.js";

/** A path this session may write: inside its workspace. */
export function writablePath(engine: EngineContext, id: string, path: string) {
  const cwd = engine.slot(id).session.sessionManager.getCwd();
  const target = resolvePath(cwd, path);
  const rel = relative(resolvePath(cwd), target);
  if (!isAbsolute(path) || rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw Error("path_outside_workspace: 只能修改工作区内的文件");
  return target;
}
export function checkpointList(engine: EngineContext, id: string, path?: string) { return engine.checkpoints.list(id, path); }
export function checkpointRead(engine: EngineContext, id: string, hash: string) { return engine.checkpoints.read(id, hash); }
export async function checkpointRestore(engine: EngineContext, id: string, path: string, hash: string | null) {
  await engine.checkpoints.restore(id, engine.writablePath(id, path), hash);
  engine.emit("agent://artifacts", { sessionId: id });
}
export async function turnRevert(engine: EngineContext, id: string, toolCallIds: string[], opts: { skip?: string[]; force?: boolean } = {}) {
  if (engine.slot(id).busy) throw Error("会话忙碌");
  const result = await engine.checkpoints.revert(id, toolCallIds, opts);
  if (result.restored.length) engine.emit("agent://artifacts", { sessionId: id });
  return result;
}
export async function artifactSave(engine: EngineContext, id: string, path: string, content: string, origin: "user" | "apply" = "user") {
  await engine.checkpoints.userSave(id, engine.writablePath(id, path), content, origin);
  engine.emit("agent://artifacts", { sessionId: id });
}
