/**
 * section-contract —— 「资料库」分区的数据契约(宿主侧)。
 *
 * 为什么分区要有元数据:
 *   资料库页 = 左导航(分区列表)+ 右内容(当前分区)。分区由插件通过
 *   `library.section` **list** 槽追加,所以宿主必须先知道「这一段叫什么、
 *   排第几、用什么图标」才能画导航列 —— 而这些信息不属于渲染结果,
 *   无法从组件本身推导出来。
 *
 * 约定(与 `composer.toolbar.action` 的"宿主提供外观、插件只给数据"同构):
 *   - 注册值仍然是**组件**(AGENTS.md:槽位注册值必须是组件);
 *   - 元数据挂在组件上,由 `defineLibrarySection(meta, Component)` 一次性完成;
 *   - 图标只给 **id**,宿主按 id 取图标 —— 插件不必依赖 ui-primitives 的图标表,
 *     也让"分区"这份数据保持可序列化。
 */
import type { ComponentType } from "react";
import type { AgentEntry } from "@openbuddy/shared-types";

/** 分区图标 id(宿主渲染;未知 id 回落到通用图标)。 */
export type LibrarySectionIconId =
  | "files"
  | "artifacts"
  | "knowledge"
  | "cloud"
  | "inspiration"
  | "generic";

/** 宿主交给每个分区组件的 props。分区自己负责标题与空态,宿主不重复渲染标题。 */
export interface LibrarySectionProps {
  /** 当前分区是否可见。非激活分区不会被挂载。 */
  active: boolean;
  /** 当前工作区目录(文件类分区需要)。 */
  cwd?: string;
  /** 当前会话 id(需要上下文的动作,如「在此会话里打开」)。 */
  sessionId?: string;
  /** 瞬时反馈(错误 / 成功提示)。 */
  onToast?: (message: string) => void;
  /** 用一段 prompt 起一个新会话(灵感分区)。 */
  onLaunch?: (prompt: string, agent?: AgentEntry) => void;
  /** 打开一条知识条目:有 url 时宿主负责用系统打开,否则退化为提示。 */
  onOpenKnowledge?: (id: string, url?: string) => void;
}

/** 分区元数据。 */
export interface LibrarySectionMeta {
  /** 稳定 id,同时是 URL/深链与测试锚点(`initialSection`)。 */
  id: string;
  /** 导航列文案。 */
  label: string;
  /** 图标 id(见 `LibrarySectionIconId`)。 */
  icon?: LibrarySectionIconId;
  /** 排序权重,小的靠前;缺省 0。 */
  order?: number;
  /** 导航列 title(hover 说明)。 */
  hint?: string;
}

/** 带元数据的分区组件(组件本身 + 挂在它上面的元数据)。 */
export type LibrarySectionComponent = ComponentType<LibrarySectionProps> & {
  readonly librarySection: LibrarySectionMeta;
};

/**
 * 给分区组件挂上元数据 —— 注册到 `library.section` 前必须调用。
 *
 * ```tsx
 * export const MySection = defineLibrarySection(
 *   { id: "my-section", label: "我的分区", icon: "generic", order: 100 },
 *   function MySection({ onToast }) { ... },
 * );
 * ```
 */
export function defineLibrarySection(
  meta: LibrarySectionMeta,
  Component: ComponentType<LibrarySectionProps>,
): LibrarySectionComponent {
  Object.defineProperty(Component, "librarySection", {
    value: meta,
    enumerable: true,
    configurable: true,
  });
  return Component as unknown as LibrarySectionComponent;
}

/** 从槽位注册值里读出分区元数据;不是分区组件时返回 null(宿主会跳过它)。 */
export function readLibrarySectionMeta(value: unknown): LibrarySectionMeta | null {
  if (typeof value !== "function") return null;
  const meta = (value as Partial<LibrarySectionComponent>).librarySection;
  if (!meta || typeof meta.id !== "string" || typeof meta.label !== "string") {
    return null;
  }
  // 空 id / 空 label 等于"没有导航项":id 是深链与测试锚点,label 是唯一可见文案,
  // 缺任何一个都不该画出来。
  if (meta.id.length === 0 || meta.label.length === 0) return null;
  return meta;
}

/** 资料库页 props —— 同时是 `placeholder.library` 单例槽的 owner props。 */
export interface LibraryPageProps {
  /** 首次渲染时激活的分区 id(深链用:`灵感` 入口 → "inspiration")。 */
  initialSection?: string;
  cwd?: string;
  sessionId?: string;
  onToast?: (message: string) => void;
  onLaunch?: (prompt: string, agent?: AgentEntry) => void;
  onOpenKnowledge?: (id: string, url?: string) => void;
}

/** 内置分区的 id 常量(宿主与测试共用的单一来源)。 */
export const LIBRARY_SECTION_IDS = {
  files: "my-files",
  knowledge: "knowledge",
  cloud: "cloud-storage",
  inspiration: "inspiration",
} as const;
