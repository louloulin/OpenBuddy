import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InstallDialog } from "../components/InstallDialog";
import type { MarketplaceEntry } from "../components/marketplace-model";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function entry(partial: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: "pi-fs",
    name: "Pi FS Tools",
    publisher: "openbuddy",
    description: "文件系统读写工具集",
    version: "1.2.0",
    kinds: ["plugin"],
    capabilities: [{ id: "fs.read", label: "读文件", risk: "low" }],
    ...partial,
  };
}

describe("InstallDialog", () => {
  it("renders nothing when closed", () => {
    render(<InstallDialog open={false} entry={entry()} onConfirm={() => {}} onCancel={() => {}} />);
    expect(document.querySelector('[data-testid="install-dialog"]')).toBeNull();
  });

  it("portals into document.body and shows capability risk + impact", () => {
    render(
      <InstallDialog
        open
        entry={entry({
          capabilities: [
            { id: "shell.exec", label: "执行命令", risk: "high", detail: "可运行任意 shell 命令" },
            { id: "fs.read", label: "读文件", risk: "low" },
          ],
        })}
        installBytes={4096}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const dialog = screen.getByTestId("install-dialog");
    expect(document.body.contains(dialog)).toBe(true);
    // portal 语义:backdrop 直接挂在 body 上,而不是渲染容器里。
    expect(screen.getByTestId("install-dialog-backdrop").parentElement).toBe(document.body);
    const list = screen.getByTestId("install-dialog-capabilities");
    expect(list.textContent).toContain("执行命令");
    expect(list.textContent).toContain("高风险");
    expect(list.textContent).toContain("可运行任意 shell 命令");
    expect(screen.getByTestId("install-dialog-impact").textContent).toContain("4 KB");
  });

  it("switches the confirm label for upgrades", () => {
    render(
      <InstallDialog
        open
        entry={entry({ installedVersion: "1.0.0", capabilities: [] })}
        confirmLabel="确认更新"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("install-dialog-confirm").textContent).toBe("确认更新");
    expect(screen.getByText(/当前 1\.0\.0/)).toBeTruthy();
  });

  it("closes on Escape and on backdrop click", () => {
    const onCancel = vi.fn();
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("install-dialog-backdrop"));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("does not close on backdrop click while busy", () => {
    const onCancel = vi.fn();
    render(
      <InstallDialog
        open
        busy
        entry={entry({ capabilities: [] })}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("install-dialog-backdrop"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ignores clicks inside the dialog", () => {
    const onCancel = vi.fn();
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("install-dialog"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps focus inside the dialog when tabbing past the last control", () => {
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByTestId("install-dialog-confirm");
    // DOM 顺序:关闭按钮 → 正文控件 → 取消 → 确认;焦点环从最后一个回到第一个。
    const firstControl = screen.getByLabelText("关闭");
    act(() => confirm.focus());
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(firstControl);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("requires consent for high-risk capabilities", () => {
    const onConfirm = vi.fn();
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [{ id: "shell.exec", label: "执行命令", risk: "high" }] })}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("install-dialog-confirm")).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("install-dialog-confirm")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("install-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ version: "1.2.0", allowHighRisk: true });
  });

  it("confirms without consent for low-risk capabilities", () => {
    const onConfirm = vi.fn();
    render(<InstallDialog open entry={entry()} onConfirm={onConfirm} onCancel={() => {}} />);
    expect(screen.queryByTestId("install-dialog-consent")).toBeNull();
    fireEvent.click(screen.getByTestId("install-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ version: "1.2.0", allowHighRisk: false });
  });

  it("supports version selection, uncontrolled and controlled", () => {
    const onConfirm = vi.fn();
    const onVersionChange = vi.fn();
    const { rerender } = render(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        versions={["1.0.0", "1.2.0", "1.1.0"]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const select = screen.getByTestId("install-dialog-version") as HTMLSelectElement;
    // 版本降序:1.2.0 在首位。
    expect([...select.options].map((option) => option.value)).toEqual(["1.2.0", "1.1.0", "1.0.0"]);
    fireEvent.change(select, { target: { value: "1.0.0" } });
    fireEvent.click(screen.getByTestId("install-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ version: "1.0.0", allowHighRisk: false });

    rerender(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        versions={["1.0.0", "1.2.0"]}
        version="1.0.0"
        onVersionChange={onVersionChange}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const controlled = screen.getByTestId("install-dialog-version") as HTMLSelectElement;
    expect(controlled.value).toBe("1.0.0");
    fireEvent.change(controlled, { target: { value: "1.2.0" } });
    expect(onVersionChange).toHaveBeenCalledWith("1.2.0");
    // 受控模式下不改内部 state:值仍回落到 props。
    expect((screen.getByTestId("install-dialog-version") as HTMLSelectElement).value).toBe("1.0.0");
  });

  it("renders a static version row when only one version exists", () => {
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByTestId("install-dialog-version")).toBeNull();
    expect(screen.getByText("1.2.0")).toBeTruthy();
  });

  it("lists dependencies", () => {
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [], dependencies: ["@openbuddy/core"] })}
        dependencies={["@openbuddy/core", "@openbuddy/fs"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const deps = screen.getByTestId("install-dialog-dependencies");
    expect(deps.textContent).toContain("@openbuddy/core");
    expect(deps.textContent).toContain("@openbuddy/fs");
    expect(screen.getByTestId("install-dialog-impact").textContent).toContain(
      "会一并注册 1 个依赖",
    );
  });

  it("shows progress and error states", () => {
    const { rerender } = render(
      <InstallDialog
        open
        busy
        entry={entry({ capabilities: [] })}
        progress={{ phase: "下载中", percent: 40 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("install-dialog-progress").textContent).toContain("下载中");
    expect(screen.getByTestId("install-dialog-progress").textContent).toContain("40%");
    expect(screen.getByTestId("install-dialog-confirm").textContent).toBe("安装中…");

    rerender(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        progress={{ phase: "校验签名" }}
        error="签名校验失败"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByTestId("install-dialog-error").textContent).toContain("签名校验失败");
    expect(screen.getByTestId("install-dialog-progress").textContent).toContain("校验签名");
  });

  it("renders the empty-capability hint", () => {
    render(
      <InstallDialog
        open
        entry={entry({ capabilities: [] })}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("此条目未声明额外能力。")).toBeTruthy();
  });
});
