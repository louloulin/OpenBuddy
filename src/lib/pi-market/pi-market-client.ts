/**
 * @openbuddy/pi-market-client — renderer wrappers for the Pi Extension
 * marketplace bridge IPC.
 *
 * R18 / Phase D — Expert Marketplace Bridge (one of OpenBuddy's open-source
 * differentiators vs WorkBuddy: install any Pi Extension through the
 * marketplace UI with versioned, atomic, rollback-able semantics).
 */
import { invoke } from "@/lib/platform/electron-api";

export type PiMarketKind = "plugin" | "skill" | "extension" | "mcp" | "theme";

export interface PiMarketRegistryEntry {
  id: string;
  name: string;
  publisher: string;
  description: string;
  version: string;
  versions: readonly string[];
  kinds: readonly PiMarketKind[];
  capabilities: readonly { id: string; risk?: "low" | "medium" | "high" }[];
}

export interface PiMarketLockEntry {
  id: string;
  version: string;
  path: string;
  installedAt: string;
  integrity: string;
  history: readonly string[];
  capabilities: readonly string[];
}

export interface PiMarketAuditEntry {
  id: string;
  at: string;
  action: "install" | "upgrade" | "rollback" | "uninstall" | "scan";
  id_ref: string;
  version?: string;
  outcome: "ok" | "error";
  detail?: Record<string, unknown>;
}

export interface PiMarketListResult {
  entries: readonly PiMarketRegistryEntry[];
}

export interface PiMarketLockfile {
  version: number;
  extensions: Record<string, PiMarketLockEntry>;
}

export function listPiMarket(args?: { query?: string }): Promise<PiMarketListResult> {
  return invoke("agent:pi-market-list", args) as Promise<PiMarketListResult>;
}

export function refreshPiMarket(): Promise<{ entries: readonly PiMarketRegistryEntry[] }> {
  return invoke("agent:pi-market-refresh") as Promise<{ entries: readonly PiMarketRegistryEntry[] }>;
}

export function installPiMarket(args: { id: string; version?: string }): Promise<{ ok: true; lock: PiMarketLockEntry } | { ok: false; error: string }> {
  return invoke("agent:pi-market-install", args) as Promise<{ ok: true; lock: PiMarketLockEntry } | { ok: false; error: string }>;
}

export function upgradePiMarket(args: { id: string; version: string }): Promise<{ ok: true; lock: PiMarketLockEntry } | { ok: false; error: string }> {
  return invoke("agent:pi-market-upgrade", args) as Promise<{ ok: true; lock: PiMarketLockEntry } | { ok: false; error: string }>;
}

export function rollbackPiMarket(args: { id: string }): Promise<{ ok: true; lock: PiMarketLockEntry } | { ok: false; error: string }> {
  return invoke("agent:pi-market-rollback", args) as Promise<{ ok: true; lock: PiMarketLockEntry } | { ok: false; error: string }>;
}

export function lockfilePiMarket(): Promise<PiMarketLockfile> {
  return invoke("agent:pi-market-lockfile") as Promise<PiMarketLockfile>;
}

export function auditPiMarket(args?: { limit?: number }): Promise<{ events: readonly PiMarketAuditEntry[] }> {
  return invoke("agent:pi-market-audit", args) as Promise<{ events: readonly PiMarketAuditEntry[] }>;
}
