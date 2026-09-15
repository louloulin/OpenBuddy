/**
 * src/App.tsx
 *
 * Phase 1 — 微内核激活（入口）
 * 整个 app 的根组件。职责收缩到只剩：
 *   1. 装载 ui-runtime 的 SlotProvider（激活所有 26 个 ui-* 包）
 *   2. 挂载 BuiltinUiPlugins（注册 slot 资源）
 *   3. 把 <AppShell /> 渲染为 provider 的子节点
 *
 * 注意：useAppShellRuntime() 必须在 SlotProvider 内部调用，因为它内部
 * 使用了 useTheme() / useUiRuntime() 等依赖 Context 的 hooks。
 * 因此 AppShell 是 provider 的子组件，hook 在 AppShell 顶层调用。
 */

import { SlotProvider, useUiRuntime, registerAllBuiltinUis } from "@openbuddy/ui-runtime/client";
import { AppShell } from "@/features/app/AppShell";
import { useAppShellRuntime } from "@/features/app/useAppShellRuntime";
import { useEffect } from "react";

/**
 * 内置 ui-* 包注册副作用组件。
 * 挂载时一次性执行 registerAllBuiltinUis()，卸载时反注册。
 */
function BuiltinUiPlugins() {
  const runtime = useUiRuntime();
  useEffect(() => {
    const disposer = registerAllBuiltinUis();
    return () => {
      try {
        disposer();
      } catch {
        /* swallow */
      }
      runtime.dispose?.();
    };
  }, [runtime]);
  return null;
}

/** provider 内部组件 — hook 必须在 provider 内调用 */
function ShellWithRuntime() {
  const runtime = useAppShellRuntime();
  return <AppShell runtime={runtime} />;
}

export default function App() {
  return (
    <SlotProvider>
      <BuiltinUiPlugins />
      <ShellWithRuntime />
    </SlotProvider>
  );
}
