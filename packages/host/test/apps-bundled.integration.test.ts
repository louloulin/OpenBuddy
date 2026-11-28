// @vitest-environment node
/**
 * 内置应用登记 (20261127-upup §1.15)，真实宿主 + 真实 Pi 包管理器：
 *
 * - 内置目录登记为本地 Pi 包（不跑 git/npm），apps_list 带 `bundled`；重复调用幂等；
 * - 以前动态装的同 id 副本被替换（免得同名工具注册两遍）；
 * - OpenBuddy 换了位置（内置目录变了）时旧目录的登记被清掉；
 * - 内置应用不能卸载 / 单独更新，可以停用，停用后重启不会被重新打开；
 * - 有 `vendor/upup`（scripts/bundle-upup.mjs 产物）时，新会话真的拿到 UpUp 工具。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const vendor = resolve(__dirname, "../../../vendor/upup");
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function tmp(prefix: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 与 UpUp 同 id 的最小应用包；`marker` 决定它是不是内置产物。 */
function finPackage(dir: string, marker: boolean) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "finapp", version: "1.0.0", pi: { extensions: ["./ext.js"], app: { kind: "app", tagline: "证券投研", category: "finance" } } }));
  writeFileSync(join(dir, "ext.js"), `export default function (pi) { pi.registerTool({ name: "fin_quote", label: "q", description: "q", parameters: { type: "object", properties: {} }, async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; } }); }\n`);
  if (marker) writeFileSync(join(dir, ".openbuddy-bundle.json"), JSON.stringify({ name: "finapp", version: "1.0.0", commit: "abc1234def" }));
  return dir;
}

async function host(userData: string, bundledApps: string[]) {
  const app = await createEngineHandlers({
    userDataDir: userData,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (b: Buffer) => b.toString() },
    emit: () => {},
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
    bundledApps,
  });
  cleanups.push(() => app.dispose());
  return app.handlers as Record<string, (p: Record<string, unknown>) => Promise<any>>;
}

describe("内置应用登记 (§1.15)", () => {
  it("登记、幂等、替换动态副本、搬家清旧登记、不可卸载但可停用", { timeout: 120_000 }, async () => {
    const root = tmp("openbuddy-bundled-");
    const userData = join(root, "userData");
    const dynamic = finPackage(join(root, "dynamic", "finapp"), false);
    const bundledV1 = finPackage(join(root, "OpenBuddy-1.app", "Resources", "finapp"), true);

    let h = await host(userData, [bundledV1]);
    // 以前动态装过同一个应用。
    await h.agent_extensions_install_package({ source: dynamic });
    const first = await h.apps_ensure_bundled({});
    expect(first.registered).toEqual([bundledV1]);
    expect(first.replaced).toEqual([dynamic]);
    expect(first.extensionsEnabled).toBe(true);
    const apps = (await h.apps_list({})) as Array<{ id: string; installedPath?: string; bundled?: { commit?: string } }>;
    expect(apps.map((a) => a.id)).toEqual(["openbuddy", "finapp"]);
    expect(apps[1]).toMatchObject({ installedPath: bundledV1, bundled: { commit: "abc1234def" } });
    expect(existsSync(join(dynamic, "package.json"))).toBe(true); // 本地动态副本只去掉登记，不删用户文件

    // 幂等。
    expect((await h.apps_ensure_bundled({})).registered).toEqual([]);

    // 不能卸载 / 单独更新 / 回滚；可以停用。
    await expect(h.apps_uninstall({ packageSource: bundledV1 })).rejects.toThrow(/bundled_app/);
    await expect(h.apps_update({ packageSource: bundledV1 })).rejects.toThrow(/bundled_app/);
    await expect(h.apps_rollback({ packageSource: bundledV1 })).rejects.toThrow(/bundled_app/);
    await h.apps_set_enabled({ packageSource: bundledV1, enabled: false });

    // 新版 OpenBuddy 装到别处：重启后旧目录登记被清掉，新目录登记；停用不会被重新打开以外的状态影响。
    const bundledV2 = join(root, "OpenBuddy-2.app", "Resources", "finapp");
    cpSync(bundledV1, bundledV2, { recursive: true });
    h = await host(userData, [bundledV2]);
    const moved = await h.apps_ensure_bundled({});
    expect(moved.removed).toEqual([bundledV1]);
    expect(moved.registered).toEqual([bundledV2]);
    const packages = (await h.agent_extensions_packages({})) as Array<{ source: string }>;
    expect(packages.map((p) => p.source)).toEqual([bundledV2]);

    // 同一位置重启：停用状态保留（ensure 不覆盖用户的停用）。
    await h.apps_set_enabled({ packageSource: bundledV2, enabled: false });
    h = await host(userData, [bundledV2]);
    expect((await h.apps_ensure_bundled({})).registered).toEqual([]);
    const after = (await h.agent_extensions_packages({})) as Array<{ source: string; filtered?: unknown }>;
    expect(after[0]?.filtered).not.toBe(false);
  });

  /**
   * 真实模型 + 真实 vendor/upup：老用户以前动态装过 UpUp（这里用本机 checkout 代替 Git 副本），
   * 升级到内置版后：动态副本被替换 → 真实模型调 UpUp 行情出数据卡 → 使用统计记在内置目录上 →
   * 交易工具仍被平台拦下。magpie 本机网关，免 Key。
   */
  it.skipIf(!existsSync(join(vendor, ".openbuddy-bundle.json")) || process.env.OPENBUDDY_REAL_MODEL !== "1")(
    "真实模型：从动态安装升级到内置 UpUp，行情出卡、统计记在内置目录、交易仍被拦",
    { timeout: 600_000 },
    async () => {
      const { detectFinanceCard } = await import("@openbuddy/chat-core/finance-card");
      const { readFileSync } = await import("node:fs");
      const checkout = process.env.UPUP_REPO ?? join(process.env.HOME ?? "", "stock", "upup");
      const root = tmp("openbuddy-bundled-real-");
      const userData = join(root, "userData");
      let h = await host(userData, []);
      await h.agent_init({ cwd: root });
      await h.agent_extensions_install_package({ source: checkout });
      expect(((await h.apps_list({})) as Array<{ id: string }>).some((a) => a.id === "upup")).toBe(true);

      h = await host(userData, [vendor]);
      await h.agent_init({ cwd: root });
      const ensured = await h.apps_ensure_bundled({});
      console.log("BUNDLED_REAL_ENSURE", JSON.stringify({ registered: ensured.registered, replaced: ensured.replaced }));
      expect(ensured.replaced).toEqual([checkout]);
      const packages = (await h.agent_extensions_packages({})) as Array<{ source: string }>;
      expect(packages.map((p) => p.source)).toEqual([vendor]);

      await h.folder_trust_respond({ cwd: root, trusted: true });
      await h.providers_save_provider({ provider: { id: "magpie", providerKind: "magpie", label: "magpie", baseUrl: process.env.MAGPIE_URL ?? "http://127.0.0.1:3425/v1", apiBackend: "chat_completions", authScheme: "bearer" } });
      const models = (await h.providers_fetch_models({ providerId: "magpie" })) as Array<{ id: string }>;
      const model = models.find((m) => /minimax-m3\.1-flash$/i.test(m.id)) ?? models[0]!;
      await h.providers_save_model({ model: { modelId: model.id, providerId: "magpie", displayName: model.id } });
      await h.permission_mode_set({ mode: "always-approve" });
      await h.apps_set_current({ appId: "upup", cwd: root });

      type Part = { role?: string; toolCallId?: string; toolName?: string; content?: Array<{ type: string; text?: string }>; details?: any; isError?: boolean };
      const results = async (sessionId: string) =>
        (((await h.agent_load_session({ sessionId, cwd: root })) as { messages?: Part[] }).messages ?? []).filter((m) => m.role === "toolResult");
      const waitFor = async (sessionId: string, ok: (rs: Part[]) => boolean) => {
        const deadline = Date.now() + 240_000;
        let rs: Part[] = [];
        while (Date.now() < deadline && !ok((rs = await results(sessionId)))) await new Promise((r) => setTimeout(r, 1500));
        return rs;
      };

      const sid = (await h.agent_new_session({ cwd: root, modelId: model.id })) as string;
      await h.agent_send({ sessionId: sid, text: "用 upup_market_data_quote（symbol=600519，market=cn）查贵州茅台的最新行情，一句话告诉我价格和截至时间。" });
      const rs = await waitFor(sid, (list) => list.some((m) => /^(upup_)?market_data_quote$/.test(m.toolName ?? "") && !m.isError));
      const quote = rs.find((m) => /^(upup_)?market_data_quote$/.test(m.toolName ?? "") && !m.isError);
      console.log("BUNDLED_REAL_CALLS", JSON.stringify(rs.map((m) => ({ tool: m.toolName, isError: m.isError }))));
      expect(quote, "真实模型调用了内置 UpUp 的行情工具").toBeTruthy();
      const card = detectFinanceCard({
        toolCallId: quote!.toolCallId ?? "x", title: quote!.toolName!, kind: quote!.toolName!, status: "completed",
        content: (quote!.content ?? []).filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string"),
        details: quote!.details,
      });
      console.log("BUNDLED_REAL_CARD", JSON.stringify(card && { kind: card.kind, title: card.title, source: card.source, asOf: card.asOf, price: card.rows.find((r) => r.key === "price")?.value, model: model.id }));
      expect(card).toMatchObject({ kind: "quote" });
      const usage = JSON.parse(readFileSync(join(userData, "pi", "app-usage.json"), "utf8")) as { lastUsed: Record<string, string> };
      console.log("BUNDLED_REAL_USAGE", JSON.stringify(usage.lastUsed));
      expect(Object.keys(usage.lastUsed)).toEqual([vendor]);

      const trade = (await h.agent_new_session({ cwd: root, modelId: model.id })) as string;
      await h.agent_send({ sessionId: trade, text: "请直接调用 upup_place_trade_order 工具，参数 symbol=600519.SH, side=buy, quantity=100。不要问我，直接调用；如果不可用，把工具返回的原因原样告诉我。" });
      const deadline = Date.now() + 180_000;
      let transcript = "";
      while (Date.now() < deadline && !/平台策略/.test(transcript)) {
        transcript = JSON.stringify(((await h.agent_load_session({ sessionId: trade, cwd: root })) as { messages?: unknown[] }).messages ?? []);
        if (!/平台策略/.test(transcript)) await new Promise((r) => setTimeout(r, 1500));
      }
      console.log("BUNDLED_REAL_TRADE", /平台策略/.test(transcript) ? "blocked" : "no-block-note");
      expect(transcript).toMatch(/平台策略/);
    },
  );

  it.skipIf(!existsSync(join(vendor, ".openbuddy-bundle.json")))("真实 vendor/upup：登记后新会话拿到 UpUp 工具，不需要 git/npm", { timeout: 300_000 }, async () => {
    const root = tmp("openbuddy-bundled-upup-");
    const h = await host(join(root, "userData"), [vendor]);
    await h.agent_init({ cwd: root });
    const started = Date.now();
    const result = await h.apps_ensure_bundled({});
    const ensureMs = Date.now() - started;
    await h.folder_trust_respond({ cwd: root, trusted: true });
    await h.providers_save_provider({ provider: { id: "fx", providerKind: "custom", baseUrl: "http://127.0.0.1:9/v1", apiBackend: "chat_completions", authScheme: "bearer", apiKey: "x" } });
    await h.providers_save_model({ model: { modelId: "fx", providerId: "fx", contextWindow: 64000 } });
    const sid = (await h.agent_new_session({ cwd: root, modelId: "fx" })) as string;
    const tools = (await h.agent_session_tools({ sessionId: sid })) as string[];
    const upupTools = tools.filter((name) => name.startsWith("upup_"));
    console.log("BUNDLED_UPUP", JSON.stringify({ ensureMs, apps: result.apps, tools: tools.length, upupTools: upupTools.length }));
    expect(result.apps[0]).toMatchObject({ id: "upup" });
    expect(upupTools.length).toBeGreaterThan(100);
    expect(tools).toContain("upup_market_data_quote");
  });
});
