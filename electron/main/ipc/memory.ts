/**
 * IPC surface — memory domain(阶段 1.5 本地两层记忆)。
 *
 * 通道:`memory:list` / `memory:add` / `memory:update` / `memory:delete`。
 * 存储在 `../memory/memory-store`(agentHome/memory.json)。
 */
import { wrapIpcHandler } from "./_wrap";
import { recordValue, optionalString, requiredString, optionalStringArray } from "./validation";
import { addMemory, deleteMemory, listMemories, updateMemory, type MemoryScope } from "../memory/memory-store";

function memoryScope(value: unknown): MemoryScope | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "user" || value === "workspace") return value;
  throw new Error(`memory scope must be "user" or "workspace", got ${String(value)}`);
}

export function registerMemoryIpc(): void {
  wrapIpcHandler("memory:list", async (_e, args?: unknown) => {
    const input = args === undefined || args === null ? {} : recordValue(args, "memory:list payload");
    return listMemories({
      ...(memoryScope(input.scope) === undefined ? {} : { scope: memoryScope(input.scope) }),
      ...(input.cwd === undefined ? {} : { cwd: requiredString(input.cwd, "cwd") }),
      ...(input.query === undefined ? {} : { query: optionalString(input.query, "query") }),
      ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
    });
  });

  wrapIpcHandler("memory:add", async (_e, args: unknown) => {
    const input = recordValue(args, "memory:add payload");
    const scope = memoryScope(input.scope);
    return addMemory({
      ...(scope === undefined ? {} : { scope }),
      ...(input.cwd === undefined ? {} : { cwd: requiredString(input.cwd, "cwd") }),
      title: requiredString(input.title, "title"),
      body: requiredString(input.body, "body"),
      ...(input.tags === undefined ? {} : { tags: optionalStringArray(input.tags, "tags") }),
    });
  });

  wrapIpcHandler("memory:update", async (_e, args: unknown) => {
    const input = recordValue(args, "memory:update payload");
    const updated = await updateMemory(requiredString(input.id, "id"), {
      ...(input.title === undefined ? {} : { title: requiredString(input.title, "title") }),
      ...(input.body === undefined ? {} : { body: requiredString(input.body, "body") }),
      ...(input.tags === undefined ? {} : { tags: optionalStringArray(input.tags, "tags") }),
    });
    if (!updated) throw new Error(`memory not found: ${String(input.id)}`);
    return updated;
  });

  wrapIpcHandler("memory:delete", async (_e, args: unknown) => {
    const input = recordValue(args, "memory delete payload");
    return { deleted: await deleteMemory(requiredString(input.id, "id")) };
  });
}
