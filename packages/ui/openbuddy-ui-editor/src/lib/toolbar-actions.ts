/**
 * toolbar-actions —— 工具栏「插件按钮」的纯逻辑层。
 *
 * 为什么需要它:`editor.toolbar` 槽位声明在 ui-editor 里,但工具栏此前把所有
 * 按钮硬编码在 `EditorToolbar.tsx` 中 —— 插件注册进槽位的数据型贡献**没有任何
 * 消费者**,也就是"注册了看不见"。本模块负责把插件 payload 收敛成一个安全的
 * 按钮列表(去重 / 排序 / 丢弃坏数据),渲染与执行留在组件层。
 *
 * 三条防御规则(插件是第三方代码,不能让它拖垮编辑器):
 *   1. 没有 `run` 函数 → 丢弃(渲染出来点了没反应比不渲染更糟);
 *   2. id 与已有按钮重复 → 丢弃(内置按钮优先,避免同名覆盖出双份);
 *   3. `run` / `isActive` / `isDisabled` 抛错 → 吞掉,按钮退化为 no-op / 非激活,
 *      但工具栏依然可点其它按钮。
 */
import type { Editor } from "@tiptap/core";

/** 插件贡献的一个工具栏按钮。 */
export interface EditorToolbarAction {
  /** 唯一 id;与内置按钮 id(h1 / bullet / table ...)同名时以内置为准。 */
  id: string;
  /** 无障碍标签 + tooltip 主文本。 */
  label: string;
  /** 展示内容,默认 "◆"。 */
  icon?: string;
  /** 快捷键提示(只做展示,不注册真实快捷键)。 */
  shortcut?: string;
  /** 排序权重(小的靠前),默认 0。 */
  order?: number;
  /** 点击执行体。拿不到 run 的条目会被丢弃。 */
  run: (editor: Editor) => void;
  /** 是否处于激活态(可抛错,抛错按未激活处理)。 */
  isActive?: (editor: Editor) => boolean;
  /** 是否禁用(可抛错,抛错按启用处理 —— 宁可点了不生效,也不要整条工具栏瘫掉)。 */
  isDisabled?: (editor: Editor) => boolean;
}

/**
 * 把插件贡献合并成可渲染的按钮列表。
 *
 * @param actions 槽位里的原始 payload(可能含 null / 缺字段的脏数据)
 * @param hidden  宿主显式隐藏的 id;插件无法绕过宿主的隐藏名单
 */
export function mergeToolbarActions(
  actions: readonly (EditorToolbarAction | undefined | null)[] | undefined,
  hidden: readonly string[] = [],
): EditorToolbarAction[] {
  if (!actions || actions.length === 0) return [];
  const hiddenSet = new Set(hidden);
  const seen = new Set<string>();
  const merged: EditorToolbarAction[] = [];
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const { id, label, run } = action;
    if (typeof id !== "string" || id.length === 0) continue;
    if (typeof label !== "string" || label.length === 0) continue;
    if (typeof run !== "function") continue;
    if (hiddenSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    merged.push(action);
  }
  return merged
    .map((action, index) => ({ action, index }))
    .sort((a, b) => (a.action.order ?? 0) - (b.action.order ?? 0) || a.index - b.index)
    .map(({ action }) => action);
}

/** 安全执行:插件抛错不影响编辑器状态(异常不上抛,只返回 false)。 */
export function runToolbarAction(action: EditorToolbarAction, editor: Editor): boolean {
  try {
    action.run(editor);
    return true;
  } catch {
    return false;
  }
}

/** 安全查询激活态:抛错按"未激活"。 */
export function toolbarActionActive(action: EditorToolbarAction, editor: Editor): boolean {
  if (typeof action.isActive !== "function") return false;
  try {
    return action.isActive(editor) === true;
  } catch {
    return false;
  }
}

/** 安全查询禁用态:抛错按"可用"。 */
export function toolbarActionDisabled(action: EditorToolbarAction, editor: Editor): boolean {
  if (typeof action.isDisabled !== "function") return false;
  try {
    return action.isDisabled(editor) === true;
  } catch {
    return false;
  }
}
