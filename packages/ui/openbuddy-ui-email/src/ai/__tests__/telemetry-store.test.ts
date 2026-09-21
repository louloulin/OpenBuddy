/**
 * telemetry-store — 邮件 AI 闭环埋点 store 单测。
 *
 * 覆盖:
 *   - record / aggregate 更新
 *   - buffer 上限滚动
 *   - enable + sink 转发
 *   - reset
 *   - undoRate / actionSuccessRate 计算
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  recordTelemetry,
  telemetryStore,
  useTelemetryAggregate,
  useTelemetryEnabled,
  useTelemetryEvents,
} from "../telemetry-store";

beforeEach(() => telemetryStore.reset());

describe("telemetry-store", () => {
  it("records events and bumps aggregate", () => {
    recordTelemetry("triage_shown", { count: 5 });
    recordTelemetry("action_proposed");
    recordTelemetry("action_executed");
    expect(telemetryStore.size()).toBe(3);
    const agg = useTelemetryAggregate;
    const { result } = renderHook(() => useTelemetryAggregate());
    expect(result.current.triageShown).toBe(1);
    expect(result.current.actionProposed).toBe(1);
    expect(result.current.actionExecuted).toBe(1);
    expect(result.current.actionSuccessRate).toBe(1);
    expect(result.current.undoRate).toBe(0);
  });

  it("computes undoRate and actionSuccessRate correctly", () => {
    recordTelemetry("action_proposed");
    recordTelemetry("action_proposed");
    recordTelemetry("action_proposed");
    recordTelemetry("action_executed");
    recordTelemetry("action_executed");
    recordTelemetry("action_undone");
    const { result } = renderHook(() => useTelemetryAggregate());
    expect(result.current.actionSuccessRate).toBeCloseTo(2 / 3);
    expect(result.current.undoRate).toBe(0.5);
  });

  it("does not throw on zero events", () => {
    const { result } = renderHook(() => useTelemetryAggregate());
    expect(result.current.undoRate).toBe(0);
    expect(result.current.actionSuccessRate).toBe(0);
  });

  it("rolls buffer when exceeding MAX_BUFFER", () => {
    for (let i = 0; i < 1001; i += 1) recordTelemetry("command_prompt", { i });
    // 聚合保留全部 1001(只是聚合增加)
    const { result: aggResult } = renderHook(() => useTelemetryAggregate());
    expect(aggResult.current.commandPrompt).toBe(1001);
    // buffer 限制为 1000
    expect(telemetryStore.size()).toBe(1000);
  });

  it("forwards to sink when enabled", () => {
    const sink = vi.fn();
    telemetryStore.setEnabled(true, sink);
    recordTelemetry("triage_shown", { count: 2 });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ name: "triage_shown", props: { count: 2 } }),
    );
    const { result } = renderHook(() => useTelemetryEnabled());
    expect(result.current).toBe(true);
  });

  it("does not call sink when disabled", () => {
    const sink = vi.fn();
    // 默认 disabled
    recordTelemetry("triage_shown");
    expect(sink).not.toHaveBeenCalled();
  });

  it("does not crash when sink throws", () => {
    telemetryStore.setEnabled(true, () => {
      throw new Error("boom");
    });
    expect(() => recordTelemetry("triage_shown")).not.toThrow();
  });

  it("reset clears events and aggregate", () => {
    recordTelemetry("triage_shown");
    recordTelemetry("action_proposed");
    expect(telemetryStore.size()).toBe(2);
    telemetryStore.reset();
    expect(telemetryStore.size()).toBe(0);
    const { result } = renderHook(() => useTelemetryAggregate());
    expect(result.current.triageShown).toBe(0);
    expect(result.current.actionProposed).toBe(0);
  });

  it("events hook returns recent buffer", () => {
    recordTelemetry("triage_shown", { count: 1 });
    recordTelemetry("action_proposed");
    const { result } = renderHook(() => useTelemetryEvents());
    expect(result.current).toHaveLength(2);
    expect(result.current[0]?.name).toBe("triage_shown");
    expect(result.current[1]?.name).toBe("action_proposed");
  });

  it("propagates updates to subscribers (useSyncExternalStore)", () => {
    const { result } = renderHook(() => useTelemetryAggregate());
    expect(result.current.triageShown).toBe(0);
    act(() => { recordTelemetry("triage_shown"); });
    expect(result.current.triageShown).toBe(1);
    act(() => { recordTelemetry("triage_shown"); });
    expect(result.current.triageShown).toBe(2);
  });
});
