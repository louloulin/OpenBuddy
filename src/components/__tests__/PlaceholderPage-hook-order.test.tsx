/**
 * LUM-1315 生产包实测的 P0 回归:在「邮件」与其它面板之间切换会抛
 * `Minified React error #300 / #310`,整个工作台掉进 ErrorBoundary,
 * 并且此后所有面板都停在错误占位,必须重载才能恢复。
 *
 * 根因:`PlaceholderPageInner` 在路由切换时会被 React 复用(同一个兄弟位置、
 * 同一个元素类型,`AppShell` 没有给 `<PlaceholderPage>` 传 `key`),此时
 * **hook 数量必须与 label 无关**。原实现把 4 个邮件钩子放在第一个 early
 * return 之后、把另外 2 个 `useMemo` 放在 `if (label === "邮件")` 分支内部,
 * 于是「邮件」(8 个)切到别的面板(6 个)时 hook 数量变少,React 直接抛错。
 *
 * 这条测试把不变式钉死:用**同一个组件实例**遍历所有路由 label(以 hook 数
 * 最多的「邮件」为轴),任何分支只要条件调用 hook 就会立刻红。修复前实测:
 * `rerender(<PlaceholderPage label="项目" />)` 抛
 * "Rendered fewer hooks than expected"。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlaceholderPage } from "../shared/PlaceholderPage";
import { EXPERTS_ROUTE_LABEL } from "@/lib/navigation/placeholder-routes";

/** 覆盖 `PlaceholderPageInner` 里每一条分支的 label(含兜底分支)。 */
const ROUTE_LABELS = [
  "助理",
  "助理·本地助理",
  "助理·已卸载扩展",
  "邮件",
  "项目",
  EXPERTS_ROUTE_LABEL,
  "自动化",
  "发现",
  "更多",
  "资料库",
  "灵感",
  "我的文件",
  "知识库",
  "网页预览",
  "用量统计",
  "通知渠道",
  "策略设置",
  "云存储",
  "某个未实现功能",
];

function renderLabel(label: string, rerender?: (ui: React.ReactElement) => void): void {
  const ui = <PlaceholderPage label={label} sessionId="s-hook-order" onNavigate={() => {}} onToast={() => {}} />;
  if (rerender) rerender(ui);
  else render(ui);
}

describe("PlaceholderPage · hook 顺序不变式", () => {
  it("同一实例在「邮件」与所有其它面板之间往返切换都不抛 hook 顺序错误", () => {
    const { rerender } = render(
      <PlaceholderPage label="邮件" sessionId="s-hook-order" onNavigate={() => {}} onToast={() => {}} />,
    );

    for (const label of ROUTE_LABELS) {
      // 修复前:`邮件`(8 hooks)→ 任意其它 label(6 hooks)在这里抛
      // "Rendered fewer hooks than expected"(React error #300)。
      renderLabel(label, rerender);
      // 再切回「邮件」(6 hooks → 8 hooks,修复前抛 #310)。
      renderLabel("邮件", rerender);
    }

    // 没有任何分支把工作台推给 ErrorBoundary。
    expect(screen.queryByText(/工作台视图出现错误/)).toBeNull();
  });

  it("渲染「邮件」时 hook 数量与渲染「项目」时一致(切换不重挂载也不会错)", () => {
    const { rerender, container } = render(
      <PlaceholderPage label="项目" sessionId="s-hook-order" onNavigate={() => {}} onToast={() => {}} />,
    );
    const first = container.firstElementChild;
    renderLabel("邮件", rerender);
    renderLabel("项目", rerender);
    // 同一个组件实例被复用(没有 key ⇒ 不重挂载),但渲染没有失败。
    expect(container.firstElementChild).toBe(first);
  });
});
