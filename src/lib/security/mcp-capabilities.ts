/**
 * MCP 客户端能力抽象 —— elicitation / sampling / roots 的本地可移植替代。
 *
 * WorkBuddy 的 `session:respondElicitation/respondToSampling/respondToRoots` 是 MCP
 * 客户端能力(server → client 请求)。pi 后端尚不支持这些 capability,但「客户端能力声明 +
 * 可注入处理器 + UI 兜底」是可移植的:当某 MCP server 请求这些能力时,OpenBuddy 有类型化契约
 * 与降级处理(而非静默忽略)。纯函数核心(能力声明 + 请求/响应类型 + 注册表 + 兜底),便于单测。
 */

/** 客户端能力开关。 */
export interface ClientCapabilities {
  elicitation: boolean;
  sampling: boolean;
  roots: boolean;
}

/** 默认能力(全部声明支持,由 UI 兜底处理)。 */
export const DEFAULT_CAPABILITIES: ClientCapabilities = {
  elicitation: true,
  sampling: true,
  roots: true,
};

/** 能力名集合(用于校验/枚举)。 */
export const CAPABILITY_NAMES = ["elicitation", "sampling", "roots"] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** 是否声明支持某能力。 */
export function hasCapability(caps: ClientCapabilities, name: CapabilityName): boolean {
  return !!caps[name];
}

/** 序列化能力声明(用于 MCP initialize 时上报)。 */
export function serializeCapabilities(caps: ClientCapabilities): Record<string, unknown> {
  return {
    elicitation: caps.elicitation ? {} : undefined,
    sampling: caps.sampling ? {} : undefined,
    roots: { listChanged: true },
  };
}

// ---------- Elicitation(服务器向用户提问)----------

export interface ElicitRequest {
  /** 服务器提问的消息。 */
  message: string;
  /** 请求的 schema(JSON Schema 片段,描述期望的回答结构)。 */
  requestedSchema?: Record<string, unknown>;
}

export interface ElicitResponse {
  /** 用户填写的字段(schema 的实例)。 */
  fields?: Record<string, unknown>;
  /** 用户取消。 */
  cancelled?: boolean;
}

// ---------- Sampling(服务器请求 LLM 补全)----------

export interface SamplingRequest {
  /** 提示词消息列表。 */
  messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>;
  /** 期望模型(可选)。 */
  modelHint?: string;
  /** 最大 token(可选)。 */
  maxTokens?: number;
}

export interface SamplingResponse {
  /** 补全文本。 */
  text: string;
  /** 使用的模型。 */
  model?: string;
  /** 用户拒绝。 */
  cancelled?: boolean;
}

// ---------- Roots(文件系统根目录)----------

export interface RootsResponse {
  /** 当前工作目录/根。 */
  roots: Array<{ uri: string; name?: string }>;
}

// ---------- 能力处理器注册表 + 兜底 ----------

/** Elicitation 处理器(弹表单让用户回答)。 */
export type ElicitHandler = (req: ElicitRequest) => Promise<ElicitResponse>;
/** Sampling 处理器(把请求转给本地 LLM/转发)。 */
export type SamplingHandler = (req: SamplingRequest) => Promise<SamplingResponse>;
/** Roots 处理器(返回当前工作目录列表)。 */
export type RootsHandler = () => Promise<RootsResponse>;

interface CapabilityHandlers {
  elicitation?: ElicitHandler;
  sampling?: SamplingHandler;
  roots?: RootsHandler;
}

const handlers: CapabilityHandlers = {};

/** 注册 elicitation 处理器。 */
export function registerElicitHandler(h: ElicitHandler): void {
  handlers.elicitation = h;
}
/** 注册 sampling 处理器。 */
export function registerSamplingHandler(h: SamplingHandler): void {
  handlers.sampling = h;
}
/** 注册 roots 处理器。 */
export function registerRootsHandler(h: RootsHandler): void {
  handlers.roots = h;
}

/** 清空处理器(测试用)。 */
export function resetCapabilityHandlers(): void {
  handlers.elicitation = undefined;
  handlers.sampling = undefined;
  handlers.roots = undefined;
}

/** 处理 elicitation 请求:有注册处理器则用,否则 UI 兜底(返回 cancelled)。 */
export async function handleElicit(
  req: ElicitRequest,
  deps: { fallback?: ElicitHandler } = {},
): Promise<ElicitResponse> {
  const h = handlers.elicitation ?? deps.fallback;
  if (h) return h(req);
  // 兜底:无处理器 → 用户无法回答 → cancelled。
  return { cancelled: true };
}

/** 处理 sampling 请求:有注册处理器则用,否则兜底(返回空文本)。 */
export async function handleSampling(
  req: SamplingRequest,
  deps: { fallback?: SamplingHandler } = {},
): Promise<SamplingResponse> {
  const h = handlers.sampling ?? deps.fallback;
  if (h) return h(req);
  // 兜底:无处理器 → 拒绝。
  return { text: "", cancelled: true };
}

/** 处理 roots 请求:有注册处理器则用,否则兜底(空列表)。 */
export async function handleRoots(
  deps: { fallback?: RootsHandler } = {},
): Promise<RootsResponse> {
  const h = handlers.roots ?? deps.fallback;
  if (h) return h();
  return { roots: [] };
}

/**
 * 高层:对单个 server→client 请求做分发(按方法名),返回响应。
 * 用于把 pi 转发的原始请求路由到对应处理器。
 */
export async function dispatchCapabilityRequest(
  method: "elicitation" | "sampling" | "roots",
  params: unknown,
  deps: { fallbackElicit?: ElicitHandler; fallbackSampling?: SamplingHandler; fallbackRoots?: RootsHandler } = {},
): Promise<ElicitResponse | SamplingResponse | RootsResponse> {
  switch (method) {
    case "elicitation":
      return handleElicit(params as ElicitRequest, { fallback: deps.fallbackElicit });
    case "sampling":
      return handleSampling(params as SamplingRequest, { fallback: deps.fallbackSampling });
    case "roots":
      return handleRoots({ fallback: deps.fallbackRoots });
  }
}
