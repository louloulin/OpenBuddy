/**
 * 模型就绪判定 (2026-11-27)。
 *
 * 之前这里只看 `secrets.has("provider:<id>")`，导致 magpie / 本地 llama.cpp 这类
 * **免 Key 的本机回环服务商**即使配置好模型也永远 ready=false：首页卡在「先连接模型」、
 * 输入框被禁用，而引擎其实能正常跑（实测一轮返回正常）。
 */

/** 本机回环 / 免鉴权的服务商：没有 API Key 也算已配置。 */
export function isKeylessProvider(p: { providerKind?: string; baseUrl?: string }): boolean {
  if (p.providerKind === "magpie") return true;
  try {
    const host = new URL(p.baseUrl ?? "").hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

export interface AuthStatusResult {
  ready: boolean;
  hasAuthFile: boolean;
  providers: string[];
  reason?: string;
}

/** 所有已保存模型里，只要有一个厂商「有 Key 或免 Key」就视为可运行。 */
export function computeAuthStatus(
  providerList: ReadonlyArray<{ id: string; label?: string; providerKind?: string; baseUrl?: string }>,
  models: ReadonlyArray<{ providerId: string; modelId: string }>,
  hasKey: (providerId: string) => boolean,
): AuthStatusResult {
  const byId = new Map(providerList.map((p) => [p.id, p]));
  const missingKey: string[] = [];
  const ready = models.some((m) => {
    if (hasKey(m.providerId)) return true;
    const provider = byId.get(m.providerId);
    if (provider && isKeylessProvider(provider)) return true;
    if (provider) missingKey.push(provider.label || provider.id);
    return false;
  });
  const reason = ready
    ? undefined
    : models.length === 0
      ? "请添加模型"
      : missingKey.length > 0
        ? `请为 ${[...new Set(missingKey)].join("、")} 填写 API Key`
        : "请配置模型和 API Key";
  return { ready, hasAuthFile: false, providers: models.map((m) => m.modelId), ...(reason ? { reason } : {}) };
}
