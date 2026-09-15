/**
 * src/App.tsx
 *
 * 入口（Phase K.3 微内核接线后只剩三件事）：
 *   1. 装载 ui-runtime 的 `<SlotProvider>` —— 它负责把 21 个内置 ui-* 包
 *      的 apply() 全部装进内核（见 SlotProvider 里的 registerAllBuiltinUis）。
 *   2. 在 provider 内部调用 useAppShellRuntime()（它依赖 Theme/Runtime Context）。
 *   3. 渲染 <AppShell />。
 *
 * 历史包袱：这里曾经额外挂了一个 `BuiltinUiPlugins` 组件再调一次
 * registerAllBuiltinUis()。SlotProvider 内部已经有幂等守卫，但那个组件没有 ——
 * 结果是 21 个包被 apply 两次：single slot 变成"栈里两条"（读取时赢家还是对的，
 * 但 entriesOfSlot 翻倍），list slot 因为 id 相同被覆盖而**静默丢失**
 * （shell.overlay 从 5 条降到 0 条）。该组件已删除。
 */

import { SlotProvider } from "@openbuddy/ui-runtime/client";
import { AppShell } from "@/features/app/AppShell";
import { useAppShellRuntime } from "@/features/app/useAppShellRuntime";

/** provider 内部组件 — hook 必须在 provider 内调用 */
function ShellWithRuntime() {
  const runtime = useAppShellRuntime();
  return <AppShell runtime={runtime} />;
}

export default function App() {
  return (
    <SlotProvider>
      <ShellWithRuntime />
    </SlotProvider>
  );
}
