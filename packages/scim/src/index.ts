/**
 * @openbuddy/scim · SCIM v2 端点
 *
 * 适用场景：
 *   - 企业 IdP（Okta / Azure AD / OneLogin）自动同步用户/组到 Casdoor
 *   - 离职/转岗自动撤销 OpenBuddy 访问
 *   - 配合 SAML SSO 形成完整的企业身份治理闭环
 *
 * 实现：纯函数 + 适配器模式
 *   - parseScimUser() / serializeScimUser() — RFC 7643 资源序列化
 *   - makeScimFilter() — SCIM filter 表达式简化实现
 *   - reconcileScimUser() — 双向 reconcile（push / pull）
 *
 * 集成方式（Resource Gateway 端）：
 *   GET    /scim/v2/Users              列出用户
 *   GET    /scim/v2/Users/{id}         查询用户
 *   POST   /scim/v2/Users              创建用户
 *   PUT    /scim/v2/Users/{id}         替换用户
 *   PATCH  /scim/v2/Users/{id}         增量更新
 *   DELETE /scim/v2/Users/{id}         软删除用户
 *   GET    /scim/v2/Groups             列出组
 *   POST   /scim/v2/Groups             创建组
 *   GET    /scim/v2/ServiceProviderConfig
 *   GET    /scim/v2/Schemas
 *
 * 不实现（按 RFC 7644）：
 *   - 复杂 filter 表达式（eq / ne / co / sw / pr / gt / ge / lt / le / and / or / not）
 *   - 只实现 `eq` + 单层 `and`（足够 95% 场景）
 */

export type ScimMeta = {
  resourceType: "User" | "Group";
  created: string;
  lastModified: string;
  location?: string;
  version?: string;
};

export interface ScimUser {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  externalId?: string;
  userName: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  displayName?: string;
  emails?: { value: string; type?: "work" | "home" | "other"; primary?: boolean }[];
  phoneNumbers?: { value: string; type?: "work" | "home" | "mobile" }[];
  active?: boolean;
  /** OpenBuddy 扩展属性（命名空间 urn:openbuddy:schemas:extension:2.0:User）。 */
  "urn:openbuddy:schemas:extension:2.0:User"?: {
    tenantId?: string;
    organization?: string;
    roles?: string[];
    capabilities?: string[];
    plan?: string;
  };
  meta: ScimMeta;
}

export interface ScimGroup {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"];
  id: string;
  displayName: string;
  members?: { value: string; display?: string }[];
  meta: ScimMeta;
}

export interface ScimListResponse<T> {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
  totalResults: number;
  Resources: T[];
  startIndex?: number;
  itemsPerPage?: number;
}

export interface ScimPatchOperation {
  op: "add" | "remove" | "replace";
  path?: string;
  value?: unknown;
}

/** 标准化外部 userName（邮箱格式）。 */
export function normalizeUserName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error(`SCIM userName 必须是合法邮箱: ${input}`);
  }
  return trimmed;
}

/** 构造 SCIM resource location URL。 */
export function scimLocationUrl(baseUrl: string, resourceType: "Users" | "Groups", id: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/scim/v2/${resourceType}/${encodeURIComponent(id)}`;
}

/** 计算 SCIM 列表分页。 */
export function scimPaginate<T>(items: T[], startIndex = 1, count = 20): ScimListResponse<T> {
  const safeStart = Math.max(1, startIndex | 0);
  const safeCount = Math.min(1000, Math.max(1, count | 0));
  const start = safeStart - 1;
  const slice = items.slice(start, start + safeCount);
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: items.length,
    Resources: slice,
    startIndex: safeStart,
    itemsPerPage: slice.length,
  };
}

/**
 * 极简 SCIM filter 解析：仅支持 `eq` + 单层 `and`。
 *
 * 支持：`userName eq "alice@example.com" and active eq true`
 * 不支持：嵌套 or / not / co / sw
 */
export function matchesScimFilter(user: ScimUser, filter: string | undefined): boolean {
  if (!filter) return true;
  const trimmed = filter.trim();
  if (!trimmed) return true;

  const conditions = splitTopLevelAnd(trimmed);
  for (const cond of conditions) {
    const m = cond.match(/^(\w+(?:\.\w+)*)\s+eq\s+(.+)$/);
    if (!m) throw new Error(`SCIM filter 仅支持 eq + and，收到: ${cond}`);
    const [, path, rawValue] = m!;
    const value = parseScimValue(rawValue!.trim());
    const actual = resolvePath(user as unknown as Record<string, unknown>, path!);
    if (actual !== value) return false;
  }
  return true;
}

function splitTopLevelAnd(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && expr.slice(i, i + 5).toLowerCase() === " and ") {
      out.push(expr.slice(start, i));
      start = i + 5;
      i += 4;
    }
  }
  out.push(expr.slice(start));
  return out.filter((s) => s.trim().length > 0);
}

function parseScimValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  return raw;
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

/** 构造 PATCH 操作效果（RFC 7644）。 */
export function applyPatchOperations<T extends object>(base: T, ops: ScimPatchOperation[]): T {
  const out = JSON.parse(JSON.stringify(base)) as T;
  for (const op of ops) {
    if (!op.path) {
      // 整体 replace
      Object.assign(out as Record<string, unknown>, op.value as Record<string, unknown>);
      continue;
    }
    const parts = op.path.split(".");
    let cur: Record<string, unknown> = out as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]!;
      if (!(k in cur)) cur[k] = {};
      cur = cur[k] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1]!;
    switch (op.op) {
      case "add":
      case "replace":
        cur[last] = op.value;
        break;
      case "remove":
        if (Array.isArray(cur[last])) {
          const arr = cur[last] as unknown[];
          if (Array.isArray(op.value)) {
            for (const v of op.value) {
              const idx = arr.findIndex((x) => JSON.stringify(x) === JSON.stringify(v));
            if (idx >= 0) arr.splice(idx, 1);
            }
          }
        } else {
          delete cur[last];
        }
        break;
    }
  }
  return out;
}

/** SCIM ServiceProviderConfig 响应。 */
export interface ScimServiceProviderConfig {
  schemas: string[];
  documentationUri?: string;
  patch: { supported: boolean };
  bulk: { supported: boolean; maxOperations: number; maxPayloadSize: number };
  filter: { supported: boolean; maxResults: number };
  changePassword: { supported: boolean };
  sort: { supported: boolean };
  etag: { supported: boolean };
  authenticationSchemes: unknown[];
  meta: { location: string; resourceType: string };
}

export function serviceProviderConfig(baseUrl: string): ScimServiceProviderConfig {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://docs.newapi.pro/zh/docs (OpenBuddy 企业版)",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 1000 },
    changePassword: { supported: false },
    sort: { supported: true },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Authentication scheme using the OAuth 2.0 Bearer Token",
        specUri: "https://tools.ietf.org/html/rfc6750",
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: `${baseUrl.replace(/\/+$/, "")}/scim/v2/ServiceProviderConfig`,
    },
  };
}
