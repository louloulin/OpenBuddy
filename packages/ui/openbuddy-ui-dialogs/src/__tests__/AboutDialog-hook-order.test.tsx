/**
 * AboutDialog-hook-order.test.tsx — LUM-1326 regression guard.
 *
 * 「关于」对话框由 `AppShell.tsx:626` **无条件挂载**（`<AboutSurface open={aboutOpen} …/>`），
 * `open=false` 时走组件内的 `if (!open) return null` 提前返回。原实现把
 * `aria-label={useT("common.close")}` 写在 JSX 里、位于该提前返回**之后**：
 *
 *   open=false → 5 个 hook（2×useState + 2×useT + useEffect）
 *   open=true  → 6 个 hook（JSX 里那次 useT 才被调用）
 *
 * 同一个实例从关闭切到打开即抛 "Rendered more hooks than expected"
 * （React #310），整块工作台掉进 ErrorBoundary —— 与 LUM-1315 的
 * PlaceholderPage 崩溃完全同类。这里用同一个实例把关闭 → 打开推一遍。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AboutDialog } from "../AboutDialog";

describe("AboutDialog — hook 顺序稳定", () => {
  it("同一实例 open=false → open=true 不改变 hook 数量", () => {
    const onClose = vi.fn();
    const { rerender } = render(<AboutDialog open={false} onClose={onClose} init={null} />);

    // 修复前：这里同步抛 "Rendered more hooks than expected"。React 会把
    // 抛出点重新抛给调用方，所以 rerender 直接炸。
    expect(() => {
      rerender(<AboutDialog open={true} onClose={onClose} init={null} />);
    }).not.toThrow();
  });

  it("反向（open=true → false → true）同样安全", () => {
    const onClose = vi.fn();
    const { rerender } = render(<AboutDialog open={true} onClose={onClose} init={null} />);

    expect(() => {
      rerender(<AboutDialog open={false} onClose={onClose} init={null} />);
      rerender(<AboutDialog open={true} onClose={onClose} init={null} />);
    }).not.toThrow();
  });
});
