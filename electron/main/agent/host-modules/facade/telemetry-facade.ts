/**
 * host-modules/facade/telemetry-facade.ts
 *
 * v6-G M2 — 提取 telemetrySink / assistantMessageText / formatBranchSummaryText
 * 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import { assistantMessageText as assistantMessageTextImpl } from "../team-runner";
import { formatBranchSummaryText as formatBranchSummaryTextImpl } from "../session-store";

export function buildTelemetryFacade() {
  return {
    telemetrySink: () => undefined,
    assistantMessageText: (messages: unknown): string =>
      assistantMessageTextImpl(messages as never),
    formatBranchSummaryText: (messages: unknown, options?: unknown): string | null =>
      formatBranchSummaryTextImpl(
        messages as never,
        options as never,
      ),
  };
}
