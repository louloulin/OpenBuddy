/**
 * src/lib/casdoor/casdoor-error.ts
 *
 * 把 Casdoor 主进程抛回来的错误翻译成"用户能处置的一句话"。
 *
 * 为什么需要这一层:主进程的错误文案是给**运维**看的
 * (`Casdoor 配置无效：请检查 issuer、client ID、管理地址和 casdoor://localhost/callback`),
 * 它准确,但落在左下角 toast 里对普通用户等于没说 —— 用户既不知道 issuer 是什么,
 * 也不知道该去哪儿改。这里只做一件事:把"该怎么修"和"去哪里修"补上,
 * 同时**绝不吞掉原始信息**(仍然附在末尾),排障能力不下降。
 */
export type CasdoorFailureKind = "unconfigured" | "network" | "denied" | "unknown";

export function classifyCasdoorFailure(raw: string): CasdoorFailureKind {
  const text = (raw ?? "").toLowerCase();
  if (!text) return "unknown";
  if (
    text.includes("配置无效") ||
    text.includes("not configured") ||
    text.includes("invalid config") ||
    text.includes("issuer")
  ) {
    return "unconfigured";
  }
  if (
    text.includes("timeout") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("网络")
  ) {
    return "network";
  }
  if (text.includes("denied") || text.includes("拒绝") || text.includes("forbidden")) {
    return "denied";
  }
  return "unknown";
}

/**
 * 面向用户的一句话。
 *
 * 未配置的情况刻意说得具体(去哪个面板、填哪两个字段),因为这是新装用户
 * 点「登录」时最常撞到的一步;其余情况保留原文 —— 那些是真正的异常,
 * 用户需要原文才能搜到解法或贴给维护者。
 */
export function humanizeCasdoorError(raw: string): string {
  const text = String(raw ?? "").replace(/^Error:\s*/, "").trim();
  switch (classifyCasdoorFailure(text)) {
    case "unconfigured":
      return "企业身份服务还没配置:在「设置 → 账户管理」填写 issuer 与 client ID 后即可登录";
    case "network":
      return `连不上企业身份服务,请检查网络或服务地址(${text})`;
    case "denied":
      return `企业身份服务拒绝了这次授权(${text})`;
    default:
      return text || "登录失败,请稍后重试";
  }
}
