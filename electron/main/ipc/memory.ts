/**
 * IPC surface — memory domain(阶段 1.5 本地两层记忆)。
 *
 * 通道:本地存储走 `memory-store:list/add/update/delete`,存储在
 * `../memory/memory-store`(agentHome/memory.json)。
 *
 * `memory:save/list/get/rewrite/delete` 五个名字是 pi-hermes-memory
 * (passthrough)的保留命名空间(surface-regression 的 memory legacy
 * boundary 契约):这里注册守卫桩,调用一律以所有权错误拒绝,防止本地
 * 存储或旧渲染端悄悄占用/复活这些名字。真要接 pi-hermes-memory 时,
 * 由它的适配器替换这五个桩。
 */
import { wrapIpcHandler } from "./_wrap";
import { recordValue, optionalString, requiredString, optionalStringArray } from "./validation";
import { addMemory, deleteMemory, listMemories, updateMemory, type MemoryScope } from "../memory/memory-store";

function memoryScope(value: unknown): MemoryScope | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "user" || value === "workspace") return value;
  throw new Error(`memory scope must be "user" or "workspace", got ${String(value)}`);
}

/** pi-hermes-memory 保留通道的守卫桩:无论参数是什么,一律拒绝。 */
function memoryOwnershipGuard(channel: string) {
  return async () => {
    throw new Error(`${channel} is owned by pi-hermes-memory; the local memory store lives under memory-store:*`);
  };
}

export function registerMemoryIpc(): void {
  wrapIpcHandler("memory-store:list", async (_e, args?: unknown) => {
    const input = args === undefined || args === null ? {} : recordValue(args, "memory-store:list payload");
    return listMemories({
      ...(memoryScope(input.scope) === undefined ? {} : { scope: memoryScope(input.scope) }),
      ...(input.cwd === undefined ? {} : { cwd: requiredString(input.cwd, "cwd") }),
      ...(input.query === undefined ? {} : { query: optionalString(input.query, "query") }),
      ...(input.limit === undefined ? {} : { limit: Number(input.limit) }),
    });
  });

  wrapIpcHandler("memory-store:add", async (_e, args: unknown) => {
    const input = recordValue(args, "memory-store:add payload");
    const scope = memoryScope(input.scope);
    return addMemory({
      ...(scope === undefined ? {} : { scope }),
      ...(input.cwd === undefined ? {} : { cwd: requiredString(input.cwd, "cwd") }),
      title: requiredString(input.title, "title"),
      body: requiredString(input.body, "body"),
      ...(input.tags === undefined ? {} : { tags: optionalStringArray(input.tags, "tags") }),
    });
  });

  wrapIpcHandler("memory-store:update", async (_e, args: unknown) => {
    const input = recordValue(args, "memory-store:update payload");
    const updated = await updateMemory(requiredString(input.id, "id"), {
      ...(input.title === undefined ? {} : { title: requiredString(input.title, "title") }),
      ...(input.body === undefined ? {} : { body: requiredString(input.body, "body") }),
      ...(input.tags === undefined ? {} : { tags: optionalStringArray(input.tags, "tags") }),
    });
    if (!updated) throw new Error(`memory not found: ${String(input.id)}`);
    return updated;
  });

  wrapIpcHandler("memory-store:delete", async (_e, args: unknown) => {
    const input = recordValue(args, "memory-store:delete payload");
    return { deleted: await deleteMemory(requiredString(input.id, "id")) };
  });

  // 通道名写成字面量:channel-allowlist-parity 守卫按注册调用的字面量
  // 扫描通道名,变量形式会让守卫盲区。
  wrapIpcHandler("memory:save", memoryOwnershipGuard("memory:save"));
  wrapIpcHandler("memory:list", memoryOwnershipGuard("memory:list"));
  wrapIpcHandler("memory:get", memoryOwnershipGuard("memory:get"));
  wrapIpcHandler("memory:rewrite", memoryOwnershipGuard("memory:rewrite"));
  wrapIpcHandler("memory:delete", memoryOwnershipGuard("memory:delete"));
}
