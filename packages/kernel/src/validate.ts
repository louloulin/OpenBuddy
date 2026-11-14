// Command payload validators, moved verbatim from services/settings/settings.ts (R2); that module re-exports them.
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("参数必须是对象");
  return value as Record<string, unknown>;
}
export function text(value: unknown, name = "value"): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw Error(`${name} 必须是非空字符串`);
  return value;
}
export function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw Error("必须是布尔值");
  return value;
}
export function unsupported(name: string): never {
  throw Error(`not_implemented: ${name}`);
}
