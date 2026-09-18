// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { InstallPreflightDialog } from "../src/InstallPreflightDialog";
import type { InstallPreflight } from "../src/install-preflight";

function plan(overrides: Partial<InstallPreflight> = {}): InstallPreflight {
  return {
    pluginName: "pkg",
    version: "1.2.3",
    installedVersion: null,
    action: "install",
    sourceName: "pi.dev",
    sourceKind: "remote",
    sourceLocation: "https://pi.dev/packages",
    facts: [
      { id: "source", level: "info", label: "来源:pi.dev", detail: "远程目录 ..." },
      { id: "version", level: "info", label: "目标版本 v1.2.3", detail: "这是一个还没装过的包" },
    ],
    risks: [],
    blockers: [],
    takeover: null,
    requiresConfirmation: true,
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("InstallPreflightDialog", () => {
  it("open=false 不渲染任何节点", () => {
    const { container } = render(
      <InstallPreflightDialog open={false} plan={plan()} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(container.querySelector("[role='alertdialog']")).toBeNull();
  });

  it("facts / risks 都以稳定 id 暴露,便于测试与 e2e 断言", () => {
    const richPlan = plan({
      risks: [
        { id: "hooks-exec", level: "danger", label: "含 hooks", detail: "..." },
        { id: "mcp-external", level: "warning", label: "含 MCP", detail: "..." },
      ],
      takeover: { capability: "mcp", capabilityLabel: "MCP 客户端", owner: "openbuddy-mcp-client" },
    });
    const { getByTestId } = render(
      <InstallPreflightDialog open plan={richPlan} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(getByTestId("preflight-item-hooks-exec").getAttribute("data-level")).toBe("danger");
    expect(getByTestId("preflight-item-mcp-external").getAttribute("data-level")).toBe("warning");
    expect(getByTestId("preflight-item-source")).toBeTruthy();
  });

  it("取消按钮 → onCancel;Esc → onCancel", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { getByTestId } = render(
      <InstallPreflightDialog open plan={plan()} onCancel={onCancel} onConfirm={onConfirm} />,
    );
    fireEvent.click(getByTestId("install-preflight-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("阻断项存在时确认按钮被禁用,且点了也不会真的回调", () => {
    const onConfirm = vi.fn();
    const blocked = plan({
      blockers: [{ id: "missing-source", level: "danger", label: "无", detail: "无" }],
    });
    const { getByTestId } = render(
      <InstallPreflightDialog open plan={blocked} onCancel={() => {}} onConfirm={onConfirm} />,
    );
    const btn = getByTestId("install-preflight-confirm") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("actions 改名:install / upgrade / reinstall 各自文案", () => {
    const { getByTestId, rerender } = render(
      <InstallPreflightDialog open plan={plan({ action: "upgrade" })} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(getByTestId("install-preflight-confirm").textContent).toBe("升级");

    rerender(
      <InstallPreflightDialog open plan={plan({ action: "reinstall" })} onCancel={() => {}} onConfirm={() => {}} />,
    );
    expect(getByTestId("install-preflight-confirm").textContent).toBe("重新安装");
  });
});
