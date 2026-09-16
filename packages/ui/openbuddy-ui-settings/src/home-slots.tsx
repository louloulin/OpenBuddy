/**
 * home-slots — 首页子区域的内核出口。
 *
 * `home` 槽(整页替换,consumed by `AppShell`)之外,首页还有两块**子区域**被人
 * 声明过、却一直没人消费:`home.scene-tabs`(场景行)与 `home.practice-cases`
 * (最佳实践案例条)。声明在 `@openbuddy/ui-home`,而实际渲染首页的是本包 ——
 * 于是插件按契约注册后"注册成功、界面没变"。
 *
 * 这里把两块接上真实消费者,并导出 props 契约。回退语义与其它微内核出口一致:
 * 内核里没有实现时渲染的 `fallback` 就是接线前的 JSX,**逐字不变**。
 *
 * 注:`home.page`(整页)没有在这里接线 —— 它与 `home` 槽描述的是同一块 UI,
 * 两个名字会误导插件作者。它已在 `@openbuddy/ui-home` 标记为 deprecated。
 */
import type { ComponentType, ReactNode } from "react";
import { useSlotComponents } from "@openbuddy/ui-runtime/client";
import type { HomeModeId } from "@openbuddy/ui-shared";

// ─── home.scene-tabs ────────────────────────────────────────────────

export type HomeSceneTabsProps = {
  /** 宿主内置的场景(日常办公 / 代码开发 / 设计创意)。 */
  modes: readonly { id: HomeModeId; label: string }[];
  /** 当前选中的场景 id。 */
  activeMode: HomeModeId;
  /** 场景切换回调 —— 插件替换整行时调它,下方的能力 chip / 模板行会跟着换。 */
  onSelect: (id: HomeModeId) => void;
};

/** 场景行出口(single)。 */
export function HomeSceneTabs({
  fallback,
  ...props
}: HomeSceneTabsProps & { fallback: ReactNode }): ReactNode {
  const impls = useSlotComponents("home.scene-tabs");
  const Impl = impls[0] as ComponentType<HomeSceneTabsProps> | undefined;
  if (!Impl) return fallback;
  return <Impl {...props} />;
}

// ─── home.practice-cases ────────────────────────────────────────────

export type HomePracticeCasesProps = {
  /**
   * 把一段 prompt 灌进输入框(不直接发送)。
   *
   * 这是插件替换案例条时真正需要的那一个入口 —— 无论是内置案例还是插件自带的
   * 企业模板,点下去都走同一条"填进输入框让用户先改再发"的路径。
   */
  onSelect: (prompt: string) => void;
};

/** 最佳实践案例条出口(single)。 */
export function HomePracticeCases({
  fallback,
  ...props
}: HomePracticeCasesProps & { fallback: ReactNode }): ReactNode {
  const impls = useSlotComponents("home.practice-cases");
  const Impl = impls[0] as ComponentType<HomePracticeCasesProps> | undefined;
  if (!Impl) return fallback;
  return <Impl {...props} />;
}
