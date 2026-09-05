import { casdoorAuth } from "./casdoor-auth";
import type { WeKnoraAnswer, WeKnoraKnowledgeBaseEntry, WeKnoraReference, WeKnoraStatus } from "../enterprise/weknora-api";

const REQUEST_TIMEOUT_MS = 15_000;
const STREAM_TIMEOUT_MS = 120_000;
const sessionTenantIds = new Map<string, number>();

function configuredApiURL(): string {
  const value = process.env.OPENBUDDY_WEKNORA_API_URL?.trim() ?? "";
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function configuredExchangeURL(): string {
  const value = process.env.OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL?.trim() ?? "";
  if (!value) return "";
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function configuredTenantMap(): Record<string, number> {
  const raw = process.env.OPENBUDDY_WEKNORA_TENANT_MAP?.trim() ?? "";
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, tenantId]) => {
      const normalizedKey = key.trim();
      const normalizedTenantId = typeof tenantId === "number"
        ? tenantId
        : typeof tenantId === "string" && /^\d+$/.test(tenantId.trim())
          ? Number(tenantId)
          : 0;
      return normalizedKey && Number.isSafeInteger(normalizedTenantId) && normalizedTenantId > 0
        ? [[normalizedKey, normalizedTenantId]]
        : [];
    }));
  } catch {
    return {};
  }
}

function resolveTenantId(): number {
  const activeTenantId = casdoorAuth.status().tenantContext.activeTenantId?.trim() ?? "";
  if (!activeTenantId) throw new Error("请先登录并选择 Casdoor 租户");
  const tenantId = configuredTenantMap()[activeTenantId];
  if (!tenantId) throw new Error("当前 Casdoor 租户没有配置 WeKnora 空间映射");
  return tenantId;
}

async function assertWeKnoraPermission(action: "read" | "contribute"): Promise<void> {
  const tenantId = casdoorAuth.status().tenantContext.activeTenantId?.trim() ?? "";
  if (!tenantId || !await casdoorAuth.authorizeResourceRemotely({ tenantId, resource: "weknora.workspace", action })) {
    throw new Error(action === "read" ? "当前 Casdoor 租户没有 WeKnora 读取权限" : "当前 Casdoor 租户没有 WeKnora 问答权限");
  }
}

export function weknoraStatus(): WeKnoraStatus {
  if (!configuredApiURL()) return { configured: false, reason: "未配置 OPENBUDDY_WEKNORA_API_URL" };
  if (!configuredExchangeURL()) return { configured: false, reason: "未配置 OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL" };
  if (Object.keys(configuredTenantMap()).length === 0) return { configured: false, reason: "未配置 OPENBUDDY_WEKNORA_TENANT_MAP" };
  return { configured: true };
}

export async function listWeKnoraKnowledgeBases(query = ""): Promise<WeKnoraKnowledgeBaseEntry[]> {
  const apiURL = configuredApiURL();
  if (!apiURL) throw new Error("未配置 OPENBUDDY_WEKNORA_API_URL");
  if (!configuredExchangeURL()) throw new Error("未配置 OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL");
  await assertWeKnoraPermission("read");
  const tenantId = resolveTenantId();
  const exchange = await casdoorAuth.exchangeForWeKnora(String(tenantId));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const endpoint = new URL("/api/v1/knowledge-bases", `${apiURL}/`);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { accept: "application/json", authorization: `${exchange.tokenType} ${exchange.accessToken}` },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as { data?: unknown; message?: string } | null;
    if (!response.ok || !Array.isArray(payload?.data)) {
      throw new Error(payload?.message || `WeKnora knowledge-base request failed (${response.status})`);
    }
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return payload.data.flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      if (!id || !name) return [];
      if (typeof item.tenant_id !== "number" || item.tenant_id !== tenantId) return [];
      const description = typeof item.description === "string" ? item.description.trim() : undefined;
      const type = typeof item.type === "string" ? item.type.trim() : undefined;
      const haystack = `${name} ${description ?? ""} ${type ?? ""}`.toLocaleLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) return [];
      return [{
        id,
        name,
        type,
        description,
        tenantId: item.tenant_id,
        updatedAt: typeof item.updated_at === "string" ? item.updated_at : undefined,
      }];
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestToken(tenantId: number, sessionId?: string) {
  return casdoorAuth.exchangeForWeKnora(String(tenantId), sessionId);
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.code === "string" && value.code.trim()) return value.code;
  }
  return fallback;
}

export async function askWeKnora(
  query: string,
  knowledgeBaseIds: string[],
  sessionId?: string,
): Promise<WeKnoraAnswer> {
  const apiURL = configuredApiURL();
  if (!apiURL) throw new Error("未配置 OPENBUDDY_WEKNORA_API_URL");
  if (!configuredExchangeURL()) throw new Error("未配置 OPENBUDDY_WEKNORA_TOKEN_EXCHANGE_URL");
  await assertWeKnoraPermission("contribute");
  const tenantId = resolveTenantId();
  const normalizedQuery = query.trim();
  const normalizedKnowledgeBaseIds = [...new Set(knowledgeBaseIds.map((id) => id.trim()).filter(Boolean))];
  if (!normalizedQuery) throw new Error("问题不能为空");
  if (normalizedKnowledgeBaseIds.length === 0) throw new Error("请先选择 WeKnora 知识库");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);
  try {
    let activeSessionId = sessionId?.trim() ?? "";
    if (activeSessionId) {
      const boundTenantId = sessionTenantIds.get(activeSessionId);
      if (boundTenantId !== undefined && boundTenantId !== tenantId) {
        throw new Error("WeKnora 会话不属于当前 Casdoor 租户");
      }
    }
    if (!activeSessionId) {
      const token = await requestToken(tenantId);
      const createEndpoint = new URL("/api/v1/sessions", `${apiURL}/`);
      const createResponse = await fetch(createEndpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `${token.tokenType} ${token.accessToken}`,
        },
        body: JSON.stringify({ title: "OpenBuddy WeKnora 会话", description: "由 OpenBuddy 创建" }),
        signal: controller.signal,
      });
      const createPayload = await createResponse.json().catch(() => null) as { data?: { id?: unknown }; message?: string; code?: string } | null;
      const createdId = typeof createPayload?.data?.id === "string" ? createPayload.data.id.trim() : "";
      if (!createResponse.ok || !createdId) {
        throw new Error(responseError(createPayload, `WeKnora session request failed (${createResponse.status})`));
      }
      activeSessionId = createdId;
      sessionTenantIds.set(activeSessionId, tenantId);
    }

    const token = await requestToken(tenantId, activeSessionId);
    const endpoint = new URL(`/api/v1/knowledge-chat/${encodeURIComponent(activeSessionId)}`, `${apiURL}/`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        authorization: `${token.tokenType} ${token.accessToken}`,
      },
      body: JSON.stringify({ query: normalizedQuery, knowledge_base_ids: normalizedKnowledgeBaseIds, channel: "api", disable_title: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(responseError(payload, `WeKnora knowledge-chat request failed (${response.status})`));
    }
    if (!response.body) throw new Error("WeKnora 未返回 SSE 流");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const references: WeKnoraReference[] = [];
    const consume = (block: string) => {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
      if (!data) return false;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new Error("WeKnora 返回了无效 SSE 数据");
      }
      const responseType = typeof payload.response_type === "string" ? payload.response_type : "";
      if (responseType === "error" || payload.error) throw new Error(responseError(payload, "WeKnora 问答失败"));
      if (responseType === "answer" && typeof payload.content === "string") answer += payload.content;
      if (Array.isArray(payload.knowledge_references)) {
        for (const value of payload.knowledge_references) {
          if (!value || typeof value !== "object") continue;
          const item = value as Record<string, unknown>;
          references.push({
            id: typeof item.id === "string" ? item.id : undefined,
            content: typeof item.content === "string" ? item.content : undefined,
            knowledgeId: typeof item.knowledge_id === "string" ? item.knowledge_id : undefined,
            knowledgeTitle: typeof item.knowledge_title === "string" ? item.knowledge_title : undefined,
            score: typeof item.score === "number" ? item.score : undefined,
          });
        }
      }
      return payload.done === true;
    };
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) done = consume(block) || done;
      if (chunk.done) {
        if (buffer.trim()) done = consume(buffer) || done;
        break;
      }
    }
    if (!answer.trim()) throw new Error("WeKnora 未返回有效回答");
    return { sessionId: activeSessionId, answer, references };
  } finally {
    clearTimeout(timeout);
  }
}
