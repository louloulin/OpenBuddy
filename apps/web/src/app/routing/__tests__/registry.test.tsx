import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { COMMANDS } from "@openbuddy/protocol/commands";
import { EVENTS } from "@openbuddy/protocol/events";
import { Sidebar } from "@/features/sessions/Sidebar";
import type { CapabilitySnapshot } from "../../state/capabilities-store";
import { FEATURES, LEGACY_BLOCKED_VIEWS } from "../features";
import { capabilityFeature } from "../capability-features";
import { isAvailable, missingFor, navItems, resolveView, routeEntry, settingsSections } from "../registry";

const snapshot = (commands: readonly string[], events: readonly string[] = [], status: CapabilitySnapshot["status"] = "ready"): CapabilitySnapshot =>
  ({ status, platform: "desktop", commands: new Set(commands), events: new Set(events) });
/** This branch's desktop host: every contract command plus native ones, the agent:// events. */
const desktop = snapshot([...COMMANDS], EVENTS.filter((e) => e.startsWith("agent://")));
const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("FeatureRegistry (pii W0.2)", () => {
  it("entries whose requires are unmet do not render in the sidebar or the 更多 menu", async () => {
    const primary = navItems(FEATURES, desktop, "primary");
    const more = navItems(FEATURES, desktop, "more");
    expect(labels(primary)).toEqual(["专家·技能·连接器", "项目"]);
    expect(labels(more)).toEqual(["我的文件", "知识库", "用量统计", "通知渠道"]);
    const user = userEvent.setup();
    render(<Sidebar onNewSession={vi.fn()} onSelect={vi.fn()} onNavigate={vi.fn()} onOpenSettings={vi.fn()} onToggleCollapse={vi.fn()} onToggleWorkspace={vi.fn()} onOpenSearch={vi.fn()} onPlaceholder={vi.fn()} activeNav="" nav={primary} moreItems={more} />);
    for (const label of ["自动化", "资料库", "助理", "技能与 MCP"]) expect(screen.queryByText(label)).toBeNull();
    await user.hover(screen.getByText("更多"));
    await screen.findByRole("menu");
    for (const label of ["策略设置", "灵感", "云存储", "网页预览"]) expect(screen.queryByText(label)).toBeNull();
    expect(screen.getByRole("menuitem", { name: "我的文件" })).toBeInTheDocument();
  });

  it("entries light up by themselves when the host starts serving their commands", () => {
    const later = snapshot([...COMMANDS, "automations_snapshot", "memory_list", "memory_rewrite", "agents_list", "experts_load"], ["agent://plan"]);
    expect(labels(navItems(FEATURES, later, "primary"))).toEqual(["专家·技能·连接器", "自动化", "资料库", "项目"]);
    expect(settingsSections(FEATURES, later).map((s) => s.id)).toContain("memory");
    expect(isAvailable(capabilityFeature("plan-panel"), later)).toBe(true);
    expect(isAvailable(capabilityFeature("experts-catalog"), later)).toBe(true);
    expect(isAvailable(capabilityFeature("plan-panel"), desktop)).toBe(false);
  });

  it("keys requires on the command names the renderer calls", () => {
    const requires = (id: string) => FEATURES.find((e) => e.id === id)!;
    expect(requires("experts-mine").requires).toEqual(["agents_list"]);
    expect(requires("experts-catalog").requires).toEqual(["experts_load"]);
    expect(requires("connectors-catalog").requires).toEqual(["connectors_load"]);
    expect(requires("skills-catalog").requires).toEqual(["skills_catalog_load"]);
    expect(requires("automation").requires).toEqual(["automations_snapshot"]);
    expect(requires("library").requires).toEqual(["memory_list"]);
    expect(requires("session-search").requires).toEqual(["session_search"]);
    expect(requires("plan-panel").requiresEvents).toEqual(["agent://plan"]);
    expect(missingFor(requires("automation"), desktop)).toEqual(["automations_snapshot"]);
  });

  it("only mounts the settings sections the host can serve", () => {
    expect(settingsSections(FEATURES, desktop).map((s) => s.id)).toEqual(["account", "agent-mail", "shortcuts", "model", "assistant", "personalize", "security", "help"]);
    // Browser-only preview: no host answer, only sections that need no command.
    expect(settingsSections(FEATURES, snapshot([], [], "unavailable")).map((s) => s.id)).toEqual(["shortcuts", "personalize", "help"]);
  });

  it("returns false while loading and never shows offline entries", () => {
    const loading = snapshot([...COMMANDS], [], "loading");
    expect(navItems(FEATURES, loading, "primary")).toEqual([]);
    expect(labels(navItems(FEATURES, loading, "more"))).toEqual(["用量统计", "通知渠道"]);
    const everything = snapshot([...COMMANDS, "inspiration_generate", "open_url"]);
    for (const id of ["policy", "cloud-storage", "assistant", "browser-preview", "settings-data"])
      expect(isAvailable(FEATURES.find((e) => e.id === id)!, everything)).toBe(false);
    expect(FEATURES.filter((e) => e.offline).every((e) => e.offline!.length > 0)).toBe(true);
  });

  it("refuses navigation to views the host cannot serve; the old App.tsx block list is now decided by requires", () => {
    expect(resolveView(FEATURES, desktop, "技能与 MCP")).toBe("专家·技能·连接器");
    expect(resolveView(FEATURES, desktop, "自动化")).toBeUndefined();
    expect(resolveView(FEATURES, desktop, "不存在的入口")).toBeUndefined();
    expect(LEGACY_BLOCKED_VIEWS.filter((label) => resolveView(FEATURES, desktop, label))).toEqual(["专家·技能·连接器"]);
    expect(LEGACY_BLOCKED_VIEWS.every((label) => routeEntry(FEATURES, label))).toBe(true);
  });

  it("every nav entry has a route and ids are unique", () => {
    expect(new Set(FEATURES.map((e) => e.id)).size).toBe(FEATURES.length);
    expect(FEATURES.filter((e) => e.nav && !e.route)).toEqual([]);
  });
});
