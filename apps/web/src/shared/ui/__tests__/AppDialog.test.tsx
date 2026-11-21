import { describe, it, expect } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { AppDialogHost, appConfirm, appPrompt } from "../AppDialog";

describe("AppDialog", () => {
  it("resolves confirm true on the confirm button and false on Escape", async () => {
    render(<AppDialogHost />);
    let first!: Promise<boolean>;
    act(() => { first = appConfirm({ title: "删除任务？", confirmLabel: "删除", danger: true }); });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("删除任务？");
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await expect(first).resolves.toBe(true);
    let second!: Promise<boolean>;
    act(() => { second = appConfirm("再确认一次？"); });
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(second).resolves.toBe(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("prompt returns trimmed text on Enter, null when cancelled, and disables confirm while empty", async () => {
    render(<AppDialogHost />);
    let named!: Promise<string | null>;
    act(() => { named = appPrompt({ title: "重命名项目", defaultValue: "旧名" }); });
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "确定" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  新名  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(named).resolves.toBe("新名");
    let cancelled!: Promise<string | null>;
    act(() => { cancelled = appPrompt("文件夹名称"); });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await expect(cancelled).resolves.toBeNull();
  });
});
