// §5.3 `host` module: host_capabilities (20261115-md R1/R4, pii W0.1).
import type { HostCapabilities } from "@openbuddy/protocol/host";
import { invoke } from "../ipc";

export type { HostCapabilities };

/** What the connected host serves: command and event names, protocol version, platform kind. */
export async function hostCapabilities(): Promise<HostCapabilities> {
  const caps = await invoke<HostCapabilities>("host_capabilities");
  if (!caps || !Array.isArray(caps.commands) || !Array.isArray(caps.events)) throw new Error("invalid_payload: host_capabilities");
  return caps;
}

// ---------- 反馈诊断 (pii W6.5): local preview only ----------

export interface DiagnoseRequest {
  app?: string;
  sessionId?: string;
  hint?: string;
  feedback?: string;
  includeSummary?: boolean;
}

/** Build a redacted diagnostics report; `includeSummary` lets the current model write a short summary. */
export async function agentDiagnose(request: DiagnoseRequest = {}): Promise<{ diagnostics: string; summary?: string }> {
  return invoke<{ diagnostics: string; summary?: string }>("agent_diagnose", request);
}

// ---------- 启动自检 (20261127-upup §1.18): local checks, optional model probe ----------

export type SelfCheckStatus = "pass" | "warning" | "fail" | "info";
export interface SelfCheckResult {
  id: string;
  title: string;
  status: SelfCheckStatus;
  summary: string;
  detail?: string;
  advice?: string;
  costMs: number;
}
export interface SelfCheckResponse {
  results: SelfCheckResult[];
  counts: Record<SelfCheckStatus, number>;
  durationMs: number;
  checkedAt: string;
  /** Redacted plain-text report. */
  report: string;
  /** File name under <userData>/diagnostics when `save` was set. */
  file?: string;
}

/** Run the self-check; `probeModel` sends one tiny request to the default model. */
export async function agentSelfCheck(request: { probeModel?: boolean; save?: boolean } = {}): Promise<SelfCheckResponse> {
  return invoke<SelfCheckResponse>("agent_self_check", request);
}
