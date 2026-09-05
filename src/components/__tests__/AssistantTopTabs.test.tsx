import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantTopTabs, ASSISTANT_TAB_ROUTE_BY_SECTION, ASSISTANT_TAB_SECTIONS, assistantPluginTabsFromContributions } from "@openbuddy/ui-shell";
import { assistantWorkspaceSectionFromRoute } from "@openbuddy/ui-shared";

describe("AssistantTopTabs", () => {
  it("renders overview and every built-in assistant workspace tab", () => {
    render(<AssistantTopTabs activeRoute="助理" onNavigate={vi.fn()} builtin={ASSISTANT_TAB_SECTIONS} pluginTabs={[]} />);

    expect(screen.getByRole("tab", { name: /总览/ })).toHaveAttribute("aria-selected", "true");
    for (const label of ["本地助理", "收件箱", "跨项目任务", "工作流", "开放网络"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /协作/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /治理/ })).toBeInTheDocument();
  });

  it("navigates to a selected workspace and sends overview to the home route", () => {
    const onNavigate = vi.fn();
    render(<AssistantTopTabs activeRoute="助理·工作流" onNavigate={onNavigate} builtin={ASSISTANT_TAB_SECTIONS} pluginTabs={[]} />);

    fireEvent.click(screen.getByRole("tab", { name: /工作流/ }));
    expect(onNavigate).toHaveBeenCalledWith("助理·工作流");

    fireEvent.click(screen.getByRole("tab", { name: /总览/ }));
    expect(onNavigate).toHaveBeenCalledWith("助理");
  });

  it("exposes the local assistant as a first-class workspace tab", () => {
    const onNavigate = vi.fn();
    render(<AssistantTopTabs activeRoute="助理" onNavigate={onNavigate} builtin={ASSISTANT_TAB_SECTIONS} pluginTabs={[]} />);

    fireEvent.click(screen.getByRole("tab", { name: /本地助理/ }));
    expect(onNavigate).toHaveBeenCalledWith("助理·本地助理");
  });

  it("keeps the assistant workspace menu keyboard navigable", () => {
    const onNavigate = vi.fn();
    render(<AssistantTopTabs activeRoute="助理·收件箱" onNavigate={onNavigate} builtin={ASSISTANT_TAB_SECTIONS} pluginTabs={[]} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onNavigate).toHaveBeenCalledWith("助理·日程");
  });

  it("highlights the canonical tab for the legacy task-collaboration route", () => {
    render(<AssistantTopTabs activeRoute="助理·任务协作" onNavigate={vi.fn()} builtin={ASSISTANT_TAB_SECTIONS} pluginTabs={[]} />);

    expect(screen.getByRole("tab", { name: /跨项目任务/ })).toHaveAttribute("aria-selected", "true");
  });

  it("sorts plugin workbench entries by order and ignores invalid metadata", () => {
    const tabs = assistantPluginTabsFromContributions([
      { kind: "assistant", id: "later", payload: { route: "助理·后置", label: "后置", order: 200, modes: ["network", "invalid"], requiredTrust: "known_peer" } },
      { kind: "assistant", id: "first", payload: { route: "助理·前置", label: "前置", order: 100, modes: ["organization"], capabilityIds: ["rooms", 7] } },
      { kind: "assistant", id: "fallback", payload: { route: "助理·默认", label: "默认", order: "bad", requiredTrust: "untrusted" } },
    ]);

    expect(tabs.map((tab) => tab.label)).toEqual(["前置", "后置", "默认"]);
    expect(tabs[0]).toMatchObject({ modes: ["organization"], capabilityIds: ["rooms"] });
    expect(tabs[1]).toMatchObject({ modes: ["network"], requiredTrust: "known_peer" });
    expect(tabs[2]).not.toHaveProperty("requiredTrust");
  });

  it("keeps every built-in tab route resolvable by the workspace renderer", () => {
    for (const section of ASSISTANT_TAB_SECTIONS) {
      const route = ASSISTANT_TAB_ROUTE_BY_SECTION[section];
      expect(assistantWorkspaceSectionFromRoute(route)).toBe(section);
    }
    expect(assistantWorkspaceSectionFromRoute("助理·任务协作")).toBe("tasks");
  });

  it("summarizes pending governance counts on the 治理 menu trigger", () => {
    render(
      <AssistantTopTabs
        activeRoute="助理"
        onNavigate={vi.fn()}
        builtin={ASSISTANT_TAB_SECTIONS}
        pluginTabs={[]}
        badgeByRoute={{ "治理·审批": 3, "治理·副作用": 2, "治理·委托": 1 }}
      />,
    );
    const trigger = screen.getByRole("button", { name: /治理/ });
    expect(trigger).toHaveTextContent("6");
  });

  it("summarizes unread + active rooms on the 协作 menu trigger", () => {
    render(
      <AssistantTopTabs
        activeRoute="助理"
        onNavigate={vi.fn()}
        builtin={ASSISTANT_TAB_SECTIONS}
        pluginTabs={[]}
        badgeByRoute={{ "协作·未读": 4, "协作·活跃": 2 }}
      />,
    );
    const trigger = screen.getByRole("button", { name: /协作/ });
    expect(trigger).toHaveTextContent("6");
  });

  it("renders plugin-supplied multi-agent collaboration tabs through the workbench menu", () => {
    const tabs = assistantPluginTabsFromContributions([
      { kind: "assistant", id: "cross-org", payload: { route: "助理·跨组织交付", label: "跨组织交付", order: 410, modes: ["organization", "network"], capabilityIds: ["federated-room-grant"], requiredTrust: "known_peer" } },
      { kind: "assistant", id: "research", payload: { route: "助理·研究 Buddy", label: "研究 Buddy", order: 420, modes: ["personal", "organization", "network"], capabilityIds: ["research:brief"] } },
      { kind: "assistant", id: "team-workflow", payload: { route: "助理·团队工作流编排", label: "团队工作流编排", order: 430, modes: ["organization"], requiredTrust: "org" } },
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual(["跨组织交付", "研究 Buddy", "团队工作流编排"]);
    expect(tabs.every((tab) => tab.route.startsWith("助理·"))).toBe(true);
    expect(tabs[0]).toMatchObject({ modes: ["organization", "network"], capabilityIds: ["federated-room-grant"], requiredTrust: "known_peer" });
    expect(tabs[1]).toMatchObject({ modes: ["personal", "organization", "network"] });
    expect(tabs[2]).toMatchObject({ modes: ["organization"], requiredTrust: "org" });
  });
});
