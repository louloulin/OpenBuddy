/**
 * 导出路径审批 —— 「用户亲手在保存对话框里选过的路径」是唯一允许写入的目标。
 *
 * 为什么需要它:`export_text_file` / `audit:export` 这类通道会**把文件写到
 * 用户给的任意绝对路径**。如果只校验"是不是绝对路径",一个被攻破的渲染层就能
 * 往 ~/.zshrc、~/.ssh/authorized_keys 写东西。所以规则是:
 *
 *   1. `dialog:save` 弹出原生保存对话框,用户确认后主进程把该路径记进审批表
 *      (`approveSavePath`);
 *   2. 真正写入的通道必须拿路径来换一次放行(`requireApprovedSavePath`)——
 *      **一次性**:放行后立刻从表里删除,避免同一个路径被反复复用;
 *   3. 表容量 64,超出按写入顺序淘汰最旧的(用户不会在一分钟内选 64 个目标,
 *      但渲染层可以无限循环调用 —— 淘汰保证内存有上界)。
 *
 * R23 之前这段逻辑内联在 `registerMiscIpc` 里(只有 `export_text_file` 用得上)。
 * R41 把「审计导出」也接进来时它必须是同一份实现:安全不变式一旦被复制成两份,
 * 迟早有一份会漂移 —— 所以提到模块级,谁都能复用,不允许再各写一套。
 *
 * 注意:模块级单例 = 进程内共享(ipc 注册在同一个主进程),与原来 `registerMiscIpc`
 * 闭包里的 Set 行为一致;`registerMiscIpc` 在测试里可能被多次调用,提到模块级后
 * 多次注册也共享同一张表 —— 这正是我们想要的语义(审批的是"用户选过这个路径",
 * 与哪次注册无关)。
 */
import { resolve } from "node:path";

const MAX_APPROVED = 64;
const approvedSavePaths = new Set<string>();

/** `dialog:save` 的返回值:记录用户选定的目标路径,返回原值供渲染层使用。 */
export function approveSavePath(candidate: string | null): string | null {
  if (!candidate) return null;
  const resolved = resolve(candidate);
  approvedSavePaths.add(resolved);
  while (approvedSavePaths.size > MAX_APPROVED) {
    approvedSavePaths.delete(approvedSavePaths.values().next().value as string);
  }
  return candidate;
}

/**
 * 取一次放行:路径必须来自保存对话框,且**只能被用掉一次**。
 * 未审批 / 已用过 → 抛错(调用方把它转成用户可读的错误,不要静默写入别处)。
 */
export function requireApprovedSavePath(candidate: string): string {
  const resolved = resolve(candidate);
  if (!approvedSavePaths.has(resolved)) throw new Error("导出路径必须来自保存对话框");
  approvedSavePaths.delete(resolved);
  return resolved;
}

/** 仅供测试/诊断:当前审批表大小。 */
export function approvedSavePathCount(): number {
  return approvedSavePaths.size;
}

/** 仅供测试:清空审批表,避免用例之间互相影响。 */
export function resetApprovedSavePaths(): void {
  approvedSavePaths.clear();
}
