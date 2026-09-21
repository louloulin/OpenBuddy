/**
 * PrivacySettingsPanel — 隐私 / 埋点 / 错误上报面板单测。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { PrivacySettingsPanel, resetPrivacyPrefsForTests } from "../components/PrivacySettingsPanel";
import { recordTelemetry, telemetryStore } from "../telemetry-store";
import { errorReporter } from "../error-reporter";

beforeEach(() => {
  resetPrivacyPrefsForTests();
  localStorage.clear();
});

afterEach(() => {
  resetPrivacyPrefsForTests();
  localStorage.clear();
});

describe("PrivacySettingsPanel", () => {
  it("默认渲染两个 toggle + 两个事件列表", () => {
    render(<PrivacySettingsPanel />);
    expect(screen.getByTestId("privacy-toggle-telemetry")).toBeTruthy();
    expect(screen.getByTestId("privacy-toggle-error-reporter")).toBeTruthy();
    expect(screen.getByTestId("privacy-event-list")).toBeTruthy();
    expect(screen.getByTestId("privacy-error-list")).toBeTruthy();
  });

  it("默认 telemetry 关闭,error reporter 开启", () => {
    render(<PrivacySettingsPanel />);
    const t = screen.getByTestId("privacy-toggle-telemetry") as HTMLInputElement;
    const e = screen.getByTestId("privacy-toggle-error-reporter") as HTMLInputElement;
    expect(t.checked).toBe(false);
    expect(e.checked).toBe(true);
  });

  it("开启 telemetry 后 recordTelemetry 真的写入缓冲", () => {
    render(<PrivacySettingsPanel />);
    const t = screen.getByTestId("privacy-toggle-telemetry") as HTMLInputElement;
    act(() => { fireEvent.click(t); });
    // 状态已切到 enabled:true,默认 sink 会消费 console.debug
    act(() => { recordTelemetry("triage_shown"); });
    expect(telemetryStore.getState().aggregate.triageShown).toBe(1);
  });

  it("error reporter 默认开启时记录异常", () => {
    render(<PrivacySettingsPanel />);
    errorReporter.captureException(new Error("boom"));
    expect(errorReporter.recent()).toHaveLength(1);
  });

  it("toggle error reporter 关闭后不再记录", () => {
    render(<PrivacySettingsPanel />);
    const e = screen.getByTestId("privacy-toggle-error-reporter") as HTMLInputElement;
    act(() => { fireEvent.click(e); });
    errorReporter.captureException(new Error("off"));
    expect(errorReporter.recent()).toHaveLength(0);
  });

  it("清空埋点缓冲按钮生效", () => {
    render(<PrivacySettingsPanel />);
    const t = screen.getByTestId("privacy-toggle-telemetry") as HTMLInputElement;
    act(() => { fireEvent.click(t); });
    act(() => { recordTelemetry("triage_shown"); });
    expect(telemetryStore.size()).toBe(1);
    act(() => { fireEvent.click(screen.getByTestId("privacy-clear-events")); });
    expect(telemetryStore.size()).toBe(0);
  });

  it("清空错误缓冲按钮生效", () => {
    render(<PrivacySettingsPanel />);
    act(() => { errorReporter.captureException(new Error("boom")); });
    expect(errorReporter.recent()).toHaveLength(1);
    act(() => { fireEvent.click(screen.getByTestId("privacy-clear-errors")); });
    expect(errorReporter.recent()).toHaveLength(0);
  });

  it("prefs 持久化到 localStorage", () => {
    const { unmount } = render(<PrivacySettingsPanel />);
    const t = screen.getByTestId("privacy-toggle-telemetry") as HTMLInputElement;
    act(() => { fireEvent.click(t); });
    const saved = localStorage.getItem("openbuddy.privacy");
    expect(saved).toBeTruthy();
    expect(JSON.parse(saved ?? "{}").telemetryEnabled).toBe(true);
    unmount();
    // 重新挂载时 loadPrefs 应恢复
    render(<PrivacySettingsPanel />);
    const t2 = screen.getByTestId("privacy-toggle-telemetry") as HTMLInputElement;
    expect(t2.checked).toBe(true);
  });

  it("事件列表显示最近 N 条", () => {
    render(<PrivacySettingsPanel />);
    const t = screen.getByTestId("privacy-toggle-telemetry") as HTMLInputElement;
    act(() => { fireEvent.click(t); });
    act(() => { recordTelemetry("triage_shown", { count: 1 }); });
    act(() => { recordTelemetry("action_executed"); });
    const items = document.querySelectorAll('[data-testid="privacy-event-list"] .privacy-event-list__item');
    expect(items.length).toBe(2);
  });

  it("错误列表显示最近错误", () => {
    render(<PrivacySettingsPanel />);
    act(() => {
      errorReporter.captureException(new Error("first"));
      errorReporter.captureException(new Error("second"));
    });
    const items = document.querySelectorAll('[data-testid="privacy-error-list"] .privacy-event-list__item');
    expect(items.length).toBe(2);
  });

  it("无事件时显示空态文案", () => {
    render(<PrivacySettingsPanel />);
    expect(screen.getByText(/暂无事件/)).toBeTruthy();
    expect(screen.getByText(/暂无错误/)).toBeTruthy();
  });
});
