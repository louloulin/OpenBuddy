import type { ProviderHeaders } from "@earendil-works/pi-ai";

export interface EnterpriseBillingContextInput {
  provider?: string;
  sessionId?: string;
  agentId?: string;
  walletId?: string;
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.trim().replace(/[\r\n\t]/g, "").slice(0, maxLength);
  return normalized || undefined;
}

export function buildEnterpriseBillingHeaders(
  input: EnterpriseBillingContextInput,
  headers: ProviderHeaders = {},
): ProviderHeaders {
  if (!input.provider || !(input.provider === "new_api" || input.provider.startsWith("new_api-"))) return headers;
  const next = { ...headers };
  const agentId = clean(input.agentId, 120) ?? "openbuddy-desktop";
  const sessionId = clean(input.sessionId, 200);
  const walletId = clean(input.walletId, 120);
  next["x-openbuddy-agent"] = agentId;
  if (sessionId) next["x-openbuddy-session"] = sessionId;
  if (walletId) next["x-openbuddy-wallet"] = walletId;
  return next;
}
