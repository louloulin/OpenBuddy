/**
 * slots.ts — 类型安全的 slot 注册/读取 API
 *
 * 与 ui-runtime SlotCore 桥接。第三方插件作者通常通过 defineExtension
 * 注册，本模块提供运行时低阶 API。
 */

export type SlotKind = "list" | "keyed";
export type SlotScope = "root" | "session";

export interface SlotRecord {
  name: string;
  kind: SlotKind;
  scope: SlotScope;
  payload: unknown;
}

const slots = new Map<string, SlotRecord[]>();

export function registerSlot(
  name: string,
  kind: SlotKind,
  scope: SlotScope,
  payload: unknown
): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("openbuddy:register-slot", { detail: { name, kind, scope, payload } })
    );
  }
  const existing = slots.get(name) ?? [];
  existing.push({ name, kind, scope, payload });
  slots.set(name, existing);
}

export function unregisterSlot(name: string, predicate?: (p: unknown) => boolean): void {
  const existing = slots.get(name);
  if (!existing) return;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("openbuddy:unregister-slot", { detail: { name } }));
  }
  const next = predicate ? existing.filter((r) => !predicate(r.payload)) : [];
  if (next.length === 0) slots.delete(name);
  else slots.set(name, next);
}

export function listSlots<T = unknown>(name: string): T[] {
  return (slots.get(name) ?? []).map((r) => r.payload as T);
}

export function useSlot<T = unknown>(_name: string, _selector?: (items: T[]) => T): T[] {
  // 简化版本：调用方通过 useSyncExternalStore 订阅 openbuddy:register-slot 事件
  return listSlots<T>(_name);
}

export function clearAllSlots(): void {
  slots.clear();
}
