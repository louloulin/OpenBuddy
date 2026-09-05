import { homedir } from "node:os";
import { join } from "node:path";
import {
  RendererStorageGateway,
  RendererStorageVersionConflictError,
  type RendererStorageValue,
} from "@openbuddy/storage";

function agentHome(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(process.env.PI_HOME ?? homedir(), ".pi", "agent");
}

function rendererDatabasePath(): string {
  return join(agentHome(), "openbuddy-renderer.sqlite");
}

let cached: RendererStorageGateway | undefined;

export function rendererStorageGateway(): RendererStorageGateway {
  return (cached ??= new RendererStorageGateway(rendererDatabasePath()));
}

export async function resetRendererStorageGateway(): Promise<void> {
  if (!cached) return;
  const previous = cached;
  cached = undefined;
  await previous.close();
}

export interface RendererReadArgs { namespace: string; key: string }
export interface RendererListArgs { namespace: string }
export interface RendererWriteArgs { namespace: string; key: string; value: unknown; version?: number; expectedVersion?: number }
export interface RendererRemoveArgs { namespace: string; key: string }

export type RendererReadResult = { ok: true; value: RendererStorageValue | undefined } | { ok: false; error: string };
export type RendererListResult = { ok: true; values: RendererStorageValue[] } | { ok: false; error: string };
export type RendererWriteResult =
  | { ok: true; value: RendererStorageValue }
  | { ok: false; error: string; code: "version-conflict" | "invalid" | "unknown"; currentVersion?: number };
export type RendererRemoveResult = { ok: true; removed: boolean } | { ok: false; error: string };

export async function rendererRead(args: RendererReadArgs): Promise<RendererReadResult> {
  try {
    const value = await rendererStorageGateway().read(args.namespace, args.key);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

export async function rendererList(args: RendererListArgs): Promise<RendererListResult> {
  try {
    const values = await rendererStorageGateway().list(args.namespace);
    return { ok: true, values };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

export async function rendererWriteVersioned(args: RendererWriteArgs): Promise<RendererWriteResult> {
  try {
    const value = await rendererStorageGateway().writeVersioned(args.namespace, args.key, args.value, args.version ?? 1, args.expectedVersion);
    return { ok: true, value };
  } catch (error) {
    if (error instanceof RendererStorageVersionConflictError) {
      return { ok: false, error: error.message, code: "version-conflict", currentVersion: error.currentVersion };
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = /invalid/i.test(message) ? "invalid" : "unknown";
    return { ok: false, error: message, code };
  }
}

export async function rendererRemove(args: RendererRemoveArgs): Promise<RendererRemoveResult> {
  try {
    const removed = await rendererStorageGateway().remove(args.namespace, args.key);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}
