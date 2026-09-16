/**
 * plugin-commands.ts — 插件命令(⌘K 命令面板)的纯模型。
 *
 * 微内核里 `plugin.command` 是**数据型**槽位:插件通过 Plugin SDK 的
 * `api.registerCommand(id, label, onExecute)` 只贡献一条描述,UI 由宿主提供。
 * 本模块承担这份描述的全部转换规则(展示名 / `/` 前缀解析 / 过滤 / 执行兜底),
 * 组件层只负责渲染 —— 与 `marketplace-model.ts` / `artifact-view-model.ts` 同一种
 * 分层:规则可单测,组件不含判断。
 *
 * 命令数据由宿主通过 props 注入,本包因此对微内核零依赖。
 */

/**
 * 一条插件命令的数据契约。
 *
 * 与 `@openbuddy/ui-runtime` 的 `plugin.command` entry payload 对齐:Plugin SDK
 * 的 `registerCommand(id, label, onExecute)` 会把这三件事原样带过来。
 */
export interface PluginCommandPayload {
  id: string;
  label?: string;
  onExecute?(ctx?: { args?: string }): void;
}

/** 命令展示名:label 优先,缺失时退化成 `/id`。 */
export function pluginCommandLabel(command: PluginCommandPayload): string {
  const label = typeof command.label === "string" ? command.label.trim() : "";
  return label || "/" + command.id;
}

/**
 * `/cmd 参数…` 的解析。
 *
 * 只有以 `/` 开头才算命令调用;返回的命令 id 与 args 都做过去空白处理,
 * 这样 `/greet  Alice` 与 `/greet Alice` 等价。
 */
export function parseSlashQuery(query: string): { commandId: string; args: string } | null {
  const trimmed = query.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const sep = body.search(/\s/);
  if (sep < 0) return { commandId: body, args: "" };
  return { commandId: body.slice(0, sep), args: body.slice(sep + 1).trim() };
}

/**
 * 过滤出当前查询下应该显示的命令。
 *
 *   - 查询为空        → 全部命令(命令面板:打开就能看到插件贡献了什么)
 *   - 查询以 `/` 开头 → 按命令 id 前缀匹配(`/gr` 命中 `greet`)
 *   - 其它            → 按 id / label 子串匹配(可以用中文描述搜到命令)
 */
export function filterPluginCommands(
  commands: readonly PluginCommandPayload[],
  query: string,
): PluginCommandPayload[] {
  const valid = commands.filter((c) => c && typeof c.id === "string" && c.id.length > 0);
  const slash = parseSlashQuery(query);
  if (slash) {
    if (!slash.commandId) return valid;
    const needle = slash.commandId.toLowerCase();
    return valid.filter((c) => c.id.toLowerCase().startsWith(needle));
  }
  const needle = query.trim().toLowerCase();
  if (!needle) return valid;
  return valid.filter(
    (c) =>
      c.id.toLowerCase().includes(needle) ||
      pluginCommandLabel(c).toLowerCase().includes(needle),
  );
}

/**
 * 执行一条插件命令。
 *
 * 命令面板里的回车/点击是「用户明确要求执行」,所以这里统一兜住插件回调抛出的
 * 异常 —— 一个坏插件不能让整个 ⌘K 面板崩掉。
 */
export function runPluginCommand(
  command: PluginCommandPayload,
  args = "",
  onError?: (error: unknown) => void,
): void {
  try {
    command.onExecute?.({ args });
  } catch (error) {
    onError?.(error);
  }
}
