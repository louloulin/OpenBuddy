import type { AppEntry, AppScene } from "./manifest.js";

/**
 * OpenBuddy 内置通用应用 (2026-11-27)。
 *
 * 无论有没有安装 UpUp，OpenBuddy 自己始终是应用列表里的第一个应用，并被默认选中：
 * WorkBuddy 的标题永远跟随「当前应用」，如果没装第三方应用就没有可跟随的对象。
 * 内置应用没有 Pi 包、不能启停（它就是这个宿主本身），所以 `source: "builtin"`。
 */
export const BUILTIN_APP_ID = "openbuddy";

/** 通用场景：不依赖任何外部包，点一下就是把 prompt 填进输入框。 */
const GENERAL_SCENES: AppScene[] = [
  {
    id: "general-doc",
    name: "文档处理",
    group: "通用",
    prompt: "请帮我把这份材料整理成结构清晰的文档：提炼要点、补齐层级、统一术语，并给出可直接使用的正文。",
  },
  {
    id: "general-data",
    name: "数据分析",
    group: "通用",
    prompt: "请分析我提供的数据：先说明指标口径，再做趋势与对比，指出异常点，最后给出可执行结论。",
  },
  {
    id: "general-research",
    name: "深度研究",
    group: "通用",
    prompt: "请围绕这个主题做一次深度研究：给出关键事实、数据来源与日期、主要分歧，以及对你决策的影响。",
  },
];

export function builtinApp(): AppEntry {
  return {
    id: BUILTIN_APP_ID,
    name: "OpenBuddy",
    kind: "app",
    source: "builtin",
    tagline: "通用智能助手",
    category: "general",
    sceneList: GENERAL_SCENES.map((scene) => ({ ...scene })),
  };
}

export const isBuiltinApp = (entry: { source?: string; id?: string }): boolean =>
  entry.source === "builtin" || entry.id === BUILTIN_APP_ID;
