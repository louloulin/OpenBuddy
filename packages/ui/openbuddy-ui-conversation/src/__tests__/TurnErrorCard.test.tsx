/**
 * 20261031 Phase 1.8 — 错误卡在缺少机器码时按 HTTP 状态推断标题与"去设置"入口。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MODEL_SELECTOR_OPEN_EVENT } from "@openbuddy/ui-workbench";
import { TurnErrorCard, inferErrorCode } from "../TurnErrorCard";

describe("TurnErrorCard", () => {
  it.each([
    ["401 Unauthorized", "auth_error"],
    ["402 insufficient balance", "insufficient_balance_error"],
    ["404 model not found", "model_not_found"],
    ["429 Too Many Requests", "rate_limit_error"],
    ["listen on port 4012 failed", undefined],
  ])("infers %s → %s", (message, code) => {
    expect(inferErrorCode({ message })).toBe(code);
  });

  it("显式机器码优先于推断", () => {
    expect(inferErrorCode({ message: "401", code: "network_error" })).toBe("network_error");
  });

  it("余额不足显示标题和去设置按钮", () => {
    const onOpenSettings = vi.fn();
    render(<TurnErrorCard error={{ message: "402 insufficient balance" }} onOpenSettings={onOpenSettings} onRetry={() => undefined} />);
    expect(screen.getByText("账户余额不足")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "去设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("速率限制只给重试,不引导去设置", () => {
    render(<TurnErrorCard error={{ message: "429 slow down" }} onOpenSettings={() => undefined} onRetry={() => undefined} />);
    expect(screen.queryByRole("button", { name: "去设置" })).toBeNull();
    expect(screen.getByRole("button", { name: /重试/ })).toBeTruthy();
  });

  it("限流显示切换模型,点击打开模型菜单;无菜单时给出提示", () => {
    const onToast = vi.fn();
    render(<TurnErrorCard error={{ message: "429 slow down" }} onToast={onToast} />);
    const button = screen.getByRole("button", { name: "切换模型" });
    fireEvent.click(button);
    expect(onToast).toHaveBeenCalledWith("在输入框下方的模型菜单里切换模型");
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener(MODEL_SELECTOR_OPEN_EVENT, claim);
    try {
      fireEvent.click(button);
      expect(onToast).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MODEL_SELECTOR_OPEN_EVENT, claim);
    }
  });

  it("鉴权错误不显示切换模型", () => {
    render(<TurnErrorCard error={{ message: "401 bad key" }} onOpenSettings={() => undefined} />);
    expect(screen.queryByRole("button", { name: "切换模型" })).toBeNull();
  });
});
