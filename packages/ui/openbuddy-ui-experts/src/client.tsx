/**
 * @openbuddy/ui-experts/client — apply() 注册 expert 面板到 placeholder.* slot。
 *
 * ThumbImg / MarketHeader / 等由消费方直接 import;本 apply 把 ExpertsTab 注册成
 * `placeholder.experts` 的默认实现(消费方:`ExpertsPanel` 的 `ExpertsTabContent`)。
 * 这样第三方插件可以注册更高优先级实现替换专家页,而默认体验不变。
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
