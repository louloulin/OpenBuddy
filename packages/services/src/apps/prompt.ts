import type { AppEntry } from "./manifest.js";

/**
 * 应用级根 prompt (20261127-upup §4 U4 / 20261126-upup UP-4.2)。
 *
 * 场景 prompt 只描述"这一次要做什么"；应用身份与边界属于更稳定的上下文，
 * 应进入会话的 system prompt，而不是每次拼在用户消息里。
 * 这里只生成**声明式**文本，不执行任何工具，也不覆盖用户指令。
 */
export function buildAppPrompt(entry: AppEntry): string {
  const head = entry.tagline ? `当前应用：${entry.name} — ${entry.tagline}。` : `当前应用：${entry.name}。`;
  const lines = [head];
  if (entry.kind === "app") {
    lines.push("优先使用该应用声明的场景与工具完成任务；工具不可用时先说明原因，再给替代方案。");
  }
  const denied = entry.toolPolicy?.deny ?? [];
  if (denied.length) lines.push(`本应用禁用以下工具：${denied.join("、")}。不要尝试绕过或模拟这些操作。`);
  const readonly = entry.toolPolicy?.readonly ?? [];
  if (readonly.length) lines.push(`以下工具为只读：${readonly.join("、")}。`);
  return lines.join("\n");
}
