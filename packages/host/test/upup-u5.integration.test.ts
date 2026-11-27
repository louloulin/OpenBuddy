// @vitest-environment node
/**
 * U5 对真实 UpUp 的验证 (2026-11-27)：本机 UpUp checkout + 本地 OpenAI 协议 fixture 模型。
 *
 *   OPENBUDDY_UPUP=1 pnpm exec vitest run packages/host/test/upup-u5.integration.test.ts
 *
 * - `ob_app_recommend` 在装了 UpUp 后推荐 upup（只来自真实 apps_list）；
 * - 调真实 UpUp `market_data_quote`（联网取东方财富等行情）→ 结果经 `detectFinanceCard` 出卡；
 * - 引擎按 UpUp 安装目录记下最近使用日；
 * - 绑定「基本面分析师」后发给模型的工具从 UpUp 全量收窄到只读数据工具，交易工具不在其中。
 *
 * 需要本机 `~/stock/upup`（或 UPUP_REPO）与网络；默认跳过。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";
import { detectFinanceCard } from "@openbuddy/chat-core/finance-card";

const repo = process.env.UPUP_REPO ?? join(process.env.HOME ?? "", "stock", "upup");
const enabled = process.env.OPENBUDDY_UPUP === "1";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Req = { messages: Array<{ role: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> };

describe.skipIf(!enabled)("U5 对真实 UpUp (2026-11-27)", () => {
  it("推荐 upup、真实行情出数据卡、记录使用、投研专家收窄 UpUp 工具", { timeout: 600_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "openbuddy-upup-u5-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const requests: Req[] = [];
    let n = 0;
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const part of req) body += part;
      const data = JSON.parse(body) as Req;
      requests.push(data);
      const last = data.messages.at(-1);
      const result = last?.role === "tool" ? JSON.stringify(last.content) : "";
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: unknown, finish: string | null = null) =>
        res.write(`data: ${JSON.stringify({ id: "fx", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      const call = (name: string, args: unknown) => {
        chunk({ tool_calls: [{ index: 0, id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
        chunk({}, "tool_calls");
      };
      chunk({ role: "assistant" });
      if (!result) call("ob_app_recommend", { query: "帮我查一下北向资金和贵州茅台的股价" });
      else if (result.includes("推荐给用户") || result.includes("没有更合适")) call("market_data_quote", { symbol: "600519", market: "cn" });
      else {
        chunk({ content: "done" });
        chunk({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const port = (server.address() as { port: number }).port;

    const events: Array<{ name: string; payload: any }> = [];
    const app = await createEngineHandlers({
      userDataDir: root,
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (b: Buffer) => b.toString() },
      emit: (name, payload) => events.push({ name, payload }),
      shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
    });
    cleanups.push(() => app.dispose());
    const h = app.handlers as Record<string, (p: Record<string, unknown>) => Promise<any>>;
    await h.providers_save_provider({ provider: { id: "fixture", providerKind: "custom", baseUrl: `http://127.0.0.1:${port}/v1`, apiBackend: "chat_completions", authScheme: "bearer", apiKey: "fixture" } });
    await h.providers_save_model({ model: { modelId: "fixture", providerId: "fixture", contextWindow: 64000 } });
    await h.agent_init({ cwd: root });
    // UP-2.5：安装确认卡的数据来自真实预演（临时目录解析，不落盘）。
    const preview = await h.agent_extensions_preview_package({ source: repo });
    const previewTools = preview.extensions.reduce((sum: number, e: { tools: string[] }) => sum + e.tools.length, 0);
    console.log("UPUP_U5_PREVIEW", JSON.stringify({ tools: previewTools, skills: preview.skills.length, prompts: preview.prompts.length, failures: preview.failures.length, app: preview.app }));
    expect(preview.app).toMatchObject({ name: "upup", kind: "app", category: "finance", toolPolicy: { deny: expect.arrayContaining(["place_trade_order", "cancel_trade_order"]) } });
    expect(preview.app.scenes).toBeGreaterThan(0);
    expect(previewTools).toBeGreaterThan(100);
    await h.agent_extensions_install_package({ source: repo });
    await h.agent_extensions_set_enabled({ enabled: true });
    await h.folder_trust_respond({ cwd: root, trusted: true });
    await h.permission_mode_set({ mode: "always-approve" });

    const apps = (await h.apps_list({ cwd: root })) as Array<{ id: string; installedPath?: string }>;
    const upup = apps.find((a) => a.id === "upup")!;
    expect(upup).toBeTruthy();

    const sid = (await h.agent_new_session({ cwd: root, modelId: "fixture" })) as string;
    const ends = () => events.filter((e) => e.name === "agent://event" && e.payload.sessionId === sid && e.payload.event.type === "tool_execution_end").map((e) => e.payload.event);
    await h.agent_send({ sessionId: sid, text: "茅台现在多少钱" });
    const deadline = Date.now() + 120_000;
    while (ends().length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));

    const rec = ends().find((e) => e.toolName === "ob_app_recommend");
    const recs = rec?.result?.details?.recommendations ?? [];
    console.log("UPUP_U5_RECOMMEND", JSON.stringify(recs.map((r: { appId: string; matched: string[] }) => ({ appId: r.appId, matched: r.matched }))));
    expect(recs[0]?.appId).toBe("upup");

    const quote = ends().find((e) => e.toolName === "market_data_quote");
    expect(quote).toBeTruthy();
    console.log("UPUP_U5_QUOTE", JSON.stringify({ isError: quote.isError, details: quote.result?.details, text: JSON.stringify(quote.result?.content).slice(0, 300) }));
    const card = detectFinanceCard({ toolCallId: quote.toolCallId, title: quote.toolName, kind: quote.toolName, status: quote.isError ? "failed" : "completed", content: quote.result.content, details: quote.result.details });
    console.log("UPUP_U5_CARD", JSON.stringify(card));
    if (!quote.isError) {
      expect(card).toMatchObject({ kind: "quote" });
      expect(card!.asOf).toBeTruthy();
      expect(card!.source).toBeTruthy();
    }

    // 使用统计：成功的 UpUp 工具调用按安装目录记日。
    if (!quote.isError) {
      const usage = JSON.parse(readFileSync(join(root, "pi", "app-usage.json"), "utf8")) as { lastUsed: Record<string, string> };
      console.log("UPUP_U5_USAGE", JSON.stringify(usage));
      expect(Object.keys(usage.lastUsed)).toEqual([upup.installedPath]);
    }

    // 投研专家：工具从 UpUp 全量收窄。
    const names = (r: Req) => (r.tools ?? []).map((t) => t.function?.name ?? "");
    const before = names(requests.at(-1)!);
    await h.agent_set_session_expert({ sessionId: sid, expertId: "fundamental-analyst" });
    const sent = requests.length;
    await h.agent_send({ sessionId: sid, text: "基本面视角看茅台" });
    while (requests.length <= sent && Date.now() < deadline + 60_000) await new Promise((r) => setTimeout(r, 100));
    const after = names(requests[sent]!);
    console.log("UPUP_U5_EXPERT", JSON.stringify({ before: before.length, after: after.length, sample: after.filter((t) => !t.startsWith("ob_")).slice(0, 12) }));
    expect(before.length).toBeGreaterThan(100);
    expect(after.length).toBeLessThan(before.length);
    expect(after).toEqual(expect.arrayContaining(["market_data_quote", "get_financials", "dcf_model", "upup_market_data_quote", "upup_dcf_model"]));
    for (const banned of ["place_trade_order", "cancel_trade_order", "add_to_watchlist", "upup_place_trade_order", "upup_cancel_trade_order", "upup_add_to_watchlist", "bash"]) expect(after).not.toContain(banned);
  });
});
