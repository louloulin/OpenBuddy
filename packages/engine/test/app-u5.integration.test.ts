// @vitest-environment node
/**
 * U5 真实链路 (20261127-upup：UP-5.1/5.2/5.3 + UP-6.1/6.2/6.4)，真实 Pi SDK + 本地 OpenAI 协议 fixture：
 *
 * - 本地「金融应用」Pi 包（pi.app.category=finance + scenes.json + 扩展），像 UpUp 一样注册
 *   `market_data_quote`（返回 UpUp 来源信封）与被平台拒绝的 `place_trade_order`；
 * - 模型先调 `ob_app_recommend`，再调 `market_data_quote`：
 *   推荐结果只来自真实已安装应用；行情结果经 `detectFinanceCard` 识别为数据卡；
 * - 工具调用后引擎按来源包写下最近使用日（app-usage.json），宿主 `apps_hygiene` 读得到；
 * - 「不用了」之后再次推荐为空（拒绝不重推）；
 * - 绑定投研专家后会话工具收窄，交易工具不在其中。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFinanceCard } from "@openbuddy/chat-core/finance-card";
import { sdkFixture, until, type FixtureReply, type FixtureRequest } from "./helpers/sdk-fixture";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** 一个最小的「金融应用」Pi 包：工具返回值与 UpUp `market_data_quote` 同形。 */
function financeApp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "openbuddy-fin-app-")));
  cleanups.push(async () => {});
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "finapp",
      version: "1.0.0",
      pi: {
        extensions: ["./ext.js"],
        app: { kind: "app", tagline: "证券智能投研助手", category: "finance", scenes: "./scenes.json", toolPolicy: { deny: ["place_trade_order"] } },
      },
    }),
  );
  writeFileSync(join(dir, "scenes.json"), JSON.stringify([{ id: "quote", name: "个股速览", prompt: "看一下 600519 的行情" }]));
  writeFileSync(
    join(dir, "ext.js"),
    `export default function (pi) {
  pi.registerTool({
    name: "market_data_quote", label: "Market data quote", description: "Read a market quote.",
    parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
    async execute(toolCallId, params) {
      const value = { symbol: params.symbol, market: "CN", price: 1520.5, currency: "CNY", changePct: 1.8, peTTM: 22.35 };
      const evidence = { asOf: "2026-11-27", source: "eastmoney", provider: "eastmoney", dataFreshness: "live", auditId: toolCallId };
      return { content: [{ type: "text", text: JSON.stringify(value) }], details: { evidence: [evidence], dataFreshness: "live", asOf: "2026-11-27", provider: "eastmoney", auditId: toolCallId, source: "native-provider" } };
    },
  });
  pi.registerTool({
    name: "place_trade_order", label: "Trade", description: "Place an order.",
    parameters: { type: "object", properties: {} },
    async execute() { return { content: [{ type: "text", text: "should never run" }], details: {} }; },
  });
}
`,
  );
  return dir;
}

const lastToolResult = (request: FixtureRequest) => {
  const last = request.messages.at(-1) as { role: string; content?: unknown } | undefined;
  return last?.role === "tool" ? JSON.stringify(last.content) : "";
};

describe("U5：数据卡 / 推荐 / 使用统计 / 投研专家（真实 Pi SDK）", () => {
  it("推荐只来自已安装应用；数据卡可识别；使用被记录；拒绝后不再推；专家收窄工具", { timeout: 120_000 }, async () => {
    let step = 0;
    const script = (request: FixtureRequest): FixtureReply => {
      const tools = JSON.stringify((request as { tools?: unknown }).tools ?? []);
      const result = lastToolResult(request);
      // 每个用户回合：推荐 → 行情 → 收尾。
      if (!result) return tools.includes("ob_app_recommend") ? { toolCalls: [{ id: `rec-${++step}`, name: "ob_app_recommend", arguments: { query: "帮我查一下北向资金和茅台股价" } }] } : { text: "no tools" };
      if (result.includes("推荐") || result.includes("没有更合适")) return { toolCalls: [{ id: `quote-${step}`, name: "market_data_quote", arguments: { symbol: "600519.SH" } }] };
      return { text: "done" };
    };
    const f = await sdkFixture(script, cleanups);
    const app = financeApp();
    // UP-2.5：安装前预演（不落盘）带出 pi.app，确认卡据此展示应用名、场景数与工具策略。
    const preview = (await f.call("agent_extensions_preview_package", { source: app })) as {
      extensions: Array<{ tools: string[] }>;
      app?: { name: string; version?: string; category?: string; toolPolicy?: { deny?: string[] }; scenes: number };
    };
    expect(preview.extensions.flatMap((e) => e.tools).sort()).toEqual(["market_data_quote", "place_trade_order"]);
    expect(preview.app).toEqual({ name: "finapp", version: "1.0.0", kind: "app", tagline: "证券智能投研助手", category: "finance", toolPolicy: { deny: ["place_trade_order"] }, scenes: 1 });
    // 预演不落盘；先按会话 cwd 读一次包列表，安装后同一 cwd 必须读到新包（包管理器缓存不能过期）。
    expect(await f.call("agent_extensions_packages", { cwd: f.root })).toEqual([]);
    await f.call("agent_extensions_install_package", { source: app });
    await f.call("agent_extensions_set_enabled", { enabled: true });
    await f.call("folder_trust_respond", { cwd: f.root, trusted: true });
    await f.call("permission_mode_set", { mode: "always-approve" });

    const apps = (await f.call("apps_list", { cwd: f.root })) as Array<{ id: string; packageSource?: string; installedPath?: string }>;
    expect(apps.map((a) => a.id)).toEqual(["openbuddy", "finapp"]);
    const pkgSource = apps[1]!.packageSource!;
    // 统计键是安装目录：实测 Pi 在会话里把本地包来源写成相对路径，apps_list 里却是绝对路径。
    const usageKey = apps[1]!.installedPath!;

    const sid = (await f.call("agent_new_session", { cwd: f.root, modelId: "fixture" })) as string;
    const ends = () => f.events.filter((e) => e.name === "agent://event" && e.payload.sessionId === sid && e.payload.event.type === "tool_execution_end").map((e) => e.payload.event);
    await f.call("agent_send", { sessionId: sid, text: "茅台现在多少钱" });
    await until(() => ends().length >= 2, 30_000);

    // UP-6.1：推荐来自真实 apps_list，带命中词与首个场景。
    const rec = ends().find((e) => e.toolName === "ob_app_recommend")!;
    expect(rec.isError).toBe(false);
    const recs = rec.result.details.recommendations as Array<{ appId: string; matched: string[]; scene?: { name: string } }>;
    expect(recs.map((r) => r.appId)).toEqual(["finapp"]);
    expect(recs[0]!.matched).toEqual(expect.arrayContaining(["北向资金"]));
    expect(recs[0]!.scene?.name).toBe("个股速览");

    // UP-5.1：真实工具结果经 chat-core 识别为数据卡（来源 / 截至 / 红涨）。
    const quote = ends().find((e) => e.toolName === "market_data_quote")!;
    const card = detectFinanceCard({ toolCallId: quote.toolCallId, title: quote.toolName, kind: quote.toolName, status: "completed", content: quote.result.content, details: quote.result.details });
    expect(card).toMatchObject({ kind: "quote", title: "600519.SH", source: "eastmoney", asOf: "2026-11-27", freshness: "live" });
    expect(card!.rows.find((r) => r.key === "changePct")?.tone).toBe("up");
    console.log("U5_CARD", JSON.stringify({ kind: card!.kind, title: card!.title, source: card!.source, asOf: card!.asOf, rows: card!.rows.length }));

    // UP-6.4：工具调用后按来源包记下最近使用日（内置 ob_* 工具不计）。
    const usagePath = join(f.root, "pi", "app-usage.json");
    await until(() => { try { return JSON.parse(readFileSync(usagePath, "utf8")).lastUsed[usageKey] !== undefined; } catch { return false; } }, 10_000);
    const usage = JSON.parse(readFileSync(usagePath, "utf8")) as { lastUsed: Record<string, string> };
    console.log("U5_USAGE", JSON.stringify(usage));
    expect(Object.keys(usage.lastUsed)).toEqual([usageKey]);
    // 刚用过：不在治理列表；把最近使用日改到 30 天前，就出现；「保留」后消失。
    expect(((await f.call("apps_hygiene", { cwd: f.root })) as { idle: unknown[] }).idle).toEqual([]);
    writeFileSync(usagePath, JSON.stringify({ lastUsed: { [usageKey]: "2026-10-01" }, kept: {} }));
    const idle = ((await f.call("apps_hygiene", { cwd: f.root })) as { idle: Array<{ appId: string; idleDays: number }> }).idle;
    expect(idle[0]).toMatchObject({ appId: "finapp" });
    expect(idle[0]!.idleDays).toBeGreaterThanOrEqual(14);
    await f.call("apps_hygiene_keep", { packageSource: pkgSource });
    expect(((await f.call("apps_hygiene", { cwd: f.root })) as { idle: unknown[] }).idle).toEqual([]);

    // UP-6.2：「不用了」之后再推荐为空。
    await f.call("apps_recommend_dismiss", { appId: "finapp" });
    const before = ends().length;
    await f.call("agent_send", { sessionId: sid, text: "再查一次" });
    await until(() => ends().length >= before + 2, 30_000);
    const again = ends().slice(before).find((e) => e.toolName === "ob_app_recommend")!;
    expect(again.result.details.recommendations).toEqual([]);

    // UP-5.3：绑定投研专家 → 下一轮发给模型的工具被收窄：保留行情工具，交易工具与 bash 不在其中。
    const namesOf = (request: FixtureRequest) =>
      (((request as { tools?: Array<{ function?: { name?: string } }> }).tools ?? []).map((tool) => tool.function?.name ?? ""));
    const toolsBefore = namesOf(f.requests.at(-1)!);
    expect(toolsBefore).toEqual(expect.arrayContaining(["market_data_quote", "bash", "place_trade_order"]));
    const bound = (await f.call("agent_set_session_expert", { sessionId: sid, expertId: "fundamental-analyst" })) as { applied: { tools?: string[] } };
    expect(bound.applied.tools).toContain("market_data_quote");
    const sent = f.requests.length;
    await f.call("agent_send", { sessionId: sid, text: "用基本面视角看茅台" });
    await until(() => f.requests.length > sent, 30_000);
    const toolsAfter = namesOf(f.requests[sent]!);
    console.log("U5_EXPERT_TOOLS", JSON.stringify({ before: toolsBefore.length, after: toolsAfter }));
    expect(toolsAfter).toContain("market_data_quote");
    expect(toolsAfter).not.toContain("place_trade_order");
    expect(toolsAfter).not.toContain("bash");
    expect(toolsAfter.length).toBeLessThan(toolsBefore.length);
  });
});
