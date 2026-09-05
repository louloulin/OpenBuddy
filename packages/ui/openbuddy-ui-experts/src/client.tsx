/**
 * @openbuddy/ui-experts/client — apply() 注册 expert 面板到 placeholder.* slot。
 *
 * ThumbImg / MarketHeader / 等由消费方直接 import;本 apply 注册 slot 让 PlaceholderPage
 * 通过 placeholder.experts 调度 ExpertsTab。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { ExpertsTab } from "./experts/ExpertsTab";

export function apply(ctx: UiRuntimeContext): () => void {
  const dispose = ctx.slots.register(
    { name: "placeholder.experts", kind: "single", scope: "root", registrant: "@openbuddy/ui-experts" },
    ExpertsTab as never
  );
  return dispose;
}
