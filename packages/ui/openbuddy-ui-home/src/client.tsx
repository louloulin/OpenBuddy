/**
 * @openbuddy/ui-home/client — React provider + apply().
 *
 * The home package doesn't own any global React state. The home page
 * pieces are mounted by their consumers. The apply() body is reserved
 * for future slot registration.
 */

import type { ReactNode } from "react";
import type { SlotMap, UiRuntimeContext } from "@openbuddy/ui-slots";

export interface HomeProviderProps {
  children: ReactNode;
}

/** No-op provider kept for parity with sibling packages. */
export function HomeProvider({ children }: HomeProviderProps) {
  return <>{children}</>;
}

declare module "@openbuddy/ui-slots" {
  interface SlotMap {
    /**
     * @deprecated 用 `home`(single, session-maybe)—— 本产品外壳走的是那一个。
     *
     * 首页整页已经有 `home` 槽(`AppShell` 消费,`@openbuddy/ui-settings` 的
     * `HomePage` 注册为默认实现)。`home.page` 描述的是同一块 UI,但本仓里
     * **没有任何消费者** —— 两个名字描述同一块区域,只会让插件作者注册到一个
     * 永远不渲染的槽上。保留声明只是为了不破坏已有第三方插件的类型引用。
     */
    "home.page": {
      kind: "single";
      scope: "root";
      owner: object;
    };
    // `home.scene-tabs` / `home.practice-cases` 的契约声明**已移到**
    // `@openbuddy/ui-settings/src/index.ts`:那两个槽的消费者是 ui-settings 的
    // `HomePage`(本产品真正渲染的首页),owner 类型应该跟消费者放在一起。
    // 这里删掉重复声明而不是留一份 `owner: object` 的空壳 —— 同名 SlotMap 条目
    // 必须类型一致(TS2717),两处声明迟早漂移。
  }
}

export function apply(ctx: UiRuntimeContext): () => void {
  const disposers: Array<() => void> = [];
  void ctx;
  return () => {
    for (const d of disposers) d();
  };
}
