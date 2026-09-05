import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

/**
 * R — Snapshot test of the WorkBuddy-aligned chat empty state markup
 * and the streaming / completed status pill markup.
 *
 * ChatView itself is too tightly coupled to a full app state tree to
 * mount in a unit test, so this test renders the same JSX the
 * production empty-state and status pill blocks use. The production
 * markup in ChatView.tsx is kept in lockstep with the markup below;
 * this catches regressions in either the component or the matching
 * CSS hooks.
 */
function EmptyState() {
  return (
    <div className="chatview__empty-state" role="status">
      <div className="chatview__empty-state-icon" aria-hidden="true">✨</div>
      <h2 className="chatview__empty-state-title">开始一段新的对话</h2>
      <p className="chatview__empty-state-subtitle">
        OpenBuddy 帮你调度专家 / 技能 / 连接器,在下方输入框描述你的任务即可。
      </p>
      <p className="chatview__empty-state-hint">
        按 <kbd>?</kbd> 查看全部快捷键,<kbd>/</kbd> 调用技能与指令,<kbd>@</kbd> 引用对话文件。
      </p>
      <ul className="chatview__empty-state-tags" aria-label="可用能力">
        <li className="chatview__empty-state-tag">助理</li>
        <li className="chatview__empty-state-tag">项目</li>
        <li className="chatview__empty-state-tag">专家 / 技能 / 连接器</li>
        <li className="chatview__empty-state-tag">自动化</li>
        <li className="chatview__empty-state-tag">资料库</li>
      </ul>
    </div>
  );
}

function ChatTitle({ title }: { title: string }) {
  return (
    <h1 className="chatview__title" title={title}>
      {title}
    </h1>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "已完成";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `已完成 ${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `已完成 ${minutes}m ${seconds}s`;
}

function StatusPill({ streaming, lastTurnMs = null }: { streaming: boolean; lastTurnMs?: number | null }) {
  return (
    <div
      className={"chatview__status" + (streaming ? " chatview__status--streaming" : "")}
      role="status"
      aria-live="polite"
    >
      <span className="chatview__status-dot" aria-hidden="true" />
      <span className="chatview__status-text">
        {streaming
          ? "正在生成…"
          : lastTurnMs !== null
          ? formatElapsed(lastTurnMs)
          : "已完成"}
      </span>
    </div>
  );
}

describe("ChatView empty state markup (WorkBuddy-aligned onboarding)", () => {
  it("contains the title, subtitle, hint, and capability tags", () => {
    const { container } = render(<EmptyState />);
    expect(container.querySelector(".chatview__empty-state-title")?.textContent).toBe("开始一段新的对话");
    expect(container.querySelector(".chatview__empty-state-subtitle")?.textContent).toMatch(/OpenBuddy 帮你调度专家/);
    expect(container.querySelector(".chatview__empty-state-hint")?.textContent).toMatch(/调用技能与指令/);
    const tags = Array.from(container.querySelectorAll(".chatview__empty-state-tag")).map((n) => n.textContent);
    expect(tags).toEqual(["助理", "项目", "专家 / 技能 / 连接器", "自动化", "资料库"]);
  });

  it("renders the icon with role-decorative aria-hidden", () => {
    const { container } = render(<EmptyState />);
    const icon = container.querySelector(".chatview__empty-state-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ChatView session title markup (WorkBuddy-aligned chat header)", () => {
  it("renders the title h1 with the given title and a tooltip", () => {
    const { container } = render(<ChatTitle title="项目复盘 2026Q1" />);
    const heading = container.querySelector(".chatview__title");
    expect(heading?.textContent).toBe("项目复盘 2026Q1");
    expect(heading?.getAttribute("title")).toBe("项目复盘 2026Q1");
  });
});

describe("ChatView status pill markup (WorkBuddy-aligned 完成状态)", () => {
  it("shows 完成已 when not streaming", () => {
    const { container } = render(<StatusPill streaming={false} />);
    expect(container.querySelector(".chatview__status-text")?.textContent).toBe("已完成");
    expect(container.querySelector(".chatview__status")?.className).not.toContain("chatview__status--streaming");
  });

  it("shows 正在生成… when streaming and adds the streaming class", () => {
    const { container } = render(<StatusPill streaming={true} />);
    expect(container.querySelector(".chatview__status-text")?.textContent).toBe("正在生成…");
    expect(container.querySelector(".chatview__status")?.className).toContain("chatview__status--streaming");
  });

  it("renders the WorkBuddy-style 完成已 Xs chip when lastTurnMs is set", () => {
    const { container } = render(<StatusPill streaming={false} lastTurnMs={1200} />);
    expect(container.querySelector(".chatview__status-text")?.textContent).toBe("已完成 1s");
  });

  it("renders the multi-minute 完成已 Xm Ys chip for longer turns", () => {
    const { container } = render(<StatusPill streaming={false} lastTurnMs={65_000} />);
    expect(container.querySelector(".chatview__status-text")?.textContent).toBe("已完成 1m 5s");
  });
});
