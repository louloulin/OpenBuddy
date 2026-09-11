/**
 * host-modules/facade/telemetry-facade.ts
 *
 * v6-G M2 — 提取 telemetrySink / assistantMessageText / formatBranchSummaryText
 * 到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import { assistantMessageText as assistantMessageTextImpl } from "../team-runner";
// R30 moved the formatter out of session-store into ../branch-summary-format;
// session-store no longer re-exports it, so this import must point at the owner.
import { formatBranchSummaryText as formatBranchSummaryTextImpl } from "../../branch-summary-format";

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
