import type { Extension, ExtensionAPI, ExtensionFactory, LoadExtensionsResult, RegisteredTool, ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * `ob_*` tool names belong to OpenBuddy's built-ins (20261116-pii §5). Pi admits a tool by name,
 * keeps the first registration of a name (user extensions load before the app's inline factories)
 * and lets an extension register tools after load, so a name alone proves nothing: the permission
 * gate and the 想一想 / 问一问 tool set must know that `ob_todo` really is the enabled built-in.
 */
export const RESERVED_TOOL_PREFIX = "ob_";

/** Definitions registered by enabled built-ins; compared by identity with the session's tool. */
const builtinDefinitions = new WeakSet<object>();
export function isBuiltinToolDefinition(definition: unknown): boolean {
  return typeof definition === "object" && definition !== null && builtinDefinitions.has(definition);
}

/** A built-in's factory whose `registerTool` records the definition and admits only the declared names. */
export function trackBuiltinTools(id: string, declared: readonly string[], factory: ExtensionFactory): ExtensionFactory {
  return (pi) => factory(new Proxy(pi, {
    get(target, key, receiver) {
      if (key !== "registerTool") return Reflect.get(target, key, receiver);
      return ((tool: ToolDefinition) => {
        if (!tool.name.startsWith(RESERVED_TOOL_PREFIX) || !declared.includes(tool.name))
          throw Error(`built-in ${id} registers undeclared tool ${tool.name}`);
        builtinDefinitions.add(tool);
        return target.registerTool(tool);
      }) as ExtensionAPI["registerTool"];
    },
  }));
}

const reserved = (name: string) => name.startsWith(RESERVED_TOOL_PREFIX);
const message = (name: string) => `工具名 ${name} 保留给 OpenBuddy 内置扩展（${RESERVED_TOOL_PREFIX}*），扩展不能注册`;
/** A tool map that refuses reserved names, also for `registerTool` calls after load. */
class GuardedTools extends Map<string, RegisteredTool> {
  override set(name: string, tool: RegisteredTool): this {
    if (reserved(name)) throw Error(message(name));
    return super.set(name, tool);
  }
}

/**
 * `DefaultResourceLoader` `extensionsOverride`: extensions loaded from disk (user, project or
 * package paths — not the app's `<inline:…>` factories, nor Pi's own `builtin:` ones) lose any
 * `ob_*` tool, which is reported as that extension's load error, and cannot register one later.
 */
export function reserveBuiltinToolNames(result: LoadExtensionsResult): LoadExtensionsResult {
  const errors = [...result.errors];
  for (const extension of result.extensions as Extension[]) {
    if (extension.path.startsWith("<inline:") || extension.path.startsWith("builtin:")) continue;
    const guarded = new GuardedTools();
    for (const [name, tool] of extension.tools) {
      if (reserved(name)) errors.push({ path: extension.path, error: message(name) });
      else guarded.set(name, tool);
    }
    extension.tools = guarded;
  }
  return { ...result, errors };
}
