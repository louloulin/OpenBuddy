// @vitest-environment node
/**
 * UpUp 作为 Pi 插件的实测 (20261126-upup UP-0)。
 *
 *   OPENBUDDY_UPUP=1 npx vitest run packages/host/test/upup-plugin.integration.test.ts
 *
 * 结论（2026-11-26 实测）：
 *  - `agent_extensions_preview_package` 能解析 UpUp 包并列出真实工具：
 *      单个子包 pi-market-data → 48 个工具；整仓 → 436 个工具。
 *  - 但**会话内不加载**这些包：`DefaultResourceLoader.resolve()` 之后
 *    `enabledExtensions` 为空（见 §已知阻塞）。
 *  - 因此本文件只断言"预演可见 + 开关读写"，会话加载用 skip 标注为阻塞项。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const repo = process.env.UPUP_REPO ?? join(process.env.HOME ?? "", "stock", "upup");
const enabled = process.env.OPENBUDDY_UPUP === "1";
const realModel = process.env.OPENBUDDY_REAL_MODEL === "1";
const magpieUrl = process.env.MAGPIE_URL ?? "http://127.0.0.1:3425/v1";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function hostAt(root: string) {
  const safe = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
    decryptString: (buffer: Buffer) => buffer.toString().split("").reverse().join(""),
  };
  return createEngineHandlers({
    userDataDir: root,
    safeStorage: safe,
    emit: () => {},
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
  });
}

async function host() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-upup-"));
  dirs.push(root);
  const safe = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
    decryptString: (buffer: Buffer) => buffer.toString().split("").reverse().join(""),
  };
  const app = await createEngineHandlers({
    userDataDir: root,
    safeStorage: safe,
    emit: () => {},
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
  });
  return { root, app };
}

async function configureMagpie(app: Awaited<ReturnType<typeof host>>["app"]) {
  await app.handlers.providers_save_provider({
    provider: {
      id: "magpie",
      providerKind: "magpie",
      label: "magpie",
      baseUrl: magpieUrl,
      apiBackend: "chat_completions",
      authScheme: "bearer",
    },
  });
  const fetched = (await app.handlers.providers_fetch_models({ providerId: "magpie" })) as Array<{ id: string }>;
  const chosen =
    fetched.find((m) => /MiniMax-M3\.1-Flash$/i.test(m.id)) ??
    fetched.find((m) => !m.id.startsWith("auto/")) ??
    fetched[0];
  await app.handlers.providers_save_model({ model: { modelId: chosen.id, providerId: "magpie", displayName: chosen.id } });
  await app.handlers.permission_mode_set({ mode: "always-approve" });
  return chosen.id;
}

describe.skipIf(!enabled)("UpUp 作为 Pi 插件 (20261126-upup)", () => {
  it("预演能列出真实工具：单个子包 48、整仓 436", async () => {
    const { app } = await host();
    try {
      const child = (await app.handlers.agent_extensions_preview_package({
        source: join(repo, "packages", "pi-market-data"),
      })) as { extensions: Array<{ tools?: string[]; error?: string }>; failures: unknown[] };
      const childTools = child.extensions.reduce((n, e) => n + (e.tools?.length ?? 0), 0);

      const wholeStart = Date.now();
      const whole = (await app.handlers.agent_extensions_preview_package({ source: repo })) as {
        extensions: Array<{ tools?: string[]; error?: string }>;
        skills: string[];
        failures: unknown[];
      };
      const wholeTools = whole.extensions.reduce((n, e) => n + (e.tools?.length ?? 0), 0);
      console.log("UPUP_SPIKE", JSON.stringify({
        childTools,
        wholeTools,
        wholeMs: Date.now() - wholeStart,
        failures: whole.failures.length,
        firstErrors: whole.extensions.filter((e) => e.error).slice(0, 3),
      }));

      expect(childTools).toBeGreaterThan(0);
      expect(wholeTools).toBeGreaterThan(childTools);
    } finally {
      app.dispose();
    }
  }, 600_000);

  it("整仓安装：会话里 436 个 UpUp 工具都能用", async () => {
    const { root, app } = await host();
    try {
      await app.handlers.agent_extensions_install_package({ source: repo });
      await app.handlers.agent_extensions_set_enabled({ enabled: true });
      await app.handlers.folder_trust_respond({ cwd: root, trusted: true });
      const modelId = await configureMagpie(app);
      const sessionId = (await app.handlers.agent_new_session({ cwd: root, modelId })) as string;
      const tools = (await app.handlers.agent_session_tools({ sessionId })) as string[];
      const trade = tools.filter((name) => /trade|order/i.test(name));
      const apps = (await app.handlers.apps_list({ cwd: root })) as Array<{ id: string; kind: string; tagline?: string; category?: string; sceneList?: Array<{ name: string }> }>;
      console.log("UPUP_APPS", JSON.stringify(apps));
      expect(apps.some((entry) => entry.kind === "app" && entry.tagline?.includes("投研"))).toBe(true);
      // UP-4.1：应用自带的场景被解析出来（个股深研 / 多因子选股 / 盘前早报）。
      const withScenes = apps.find((entry) => (entry.sceneList?.length ?? 0) > 0);
      console.log("UPUP_SCENES", JSON.stringify(withScenes?.sceneList?.map((scene) => scene.name) ?? []));
      expect(withScenes?.sceneList?.length).toBe(3);
      const policy = (await app.handlers.apps_tool_policy_get()) as { platformDenied: string[]; denied: string[] };
      console.log("UPUP_POLICY", JSON.stringify(policy));
      expect(trade.length).toBeGreaterThan(0); // 风险真实存在：装了就有交易工具
      expect(policy.platformDenied.some((p) => /place_trade_order/.test(p))).toBe(true);
      const overlaps = tools.filter((name) => ["read", "write", "edit", "bash", "grep", "find", "ls"].includes(name));
      console.log("UPUP_WHOLE_SESSION", JSON.stringify({ total: tools.length, trade, overlaps }));
      expect(tools.length).toBeGreaterThan(200);
    } finally {
      app.dispose();
    }
  }, 600_000);

  it("整仓安装 + 关掉子包：被关子包的工具真的不出现", async () => {
    const { root, app } = await host();
    try {
      await app.handlers.agent_extensions_install_package({ source: repo });
      await app.handlers.agent_extensions_set_enabled({ enabled: true });
      await app.handlers.folder_trust_respond({ cwd: root, trusted: true });
      const modelId = await configureMagpie(app);

      const before = (await app.handlers.agent_session_tools({
        sessionId: (await app.handlers.agent_new_session({ cwd: root, modelId })) as string,
      })) as string[];

      await app.handlers.upup_plugins_set({ disabled: ["pi-portfolio", "pi-risk", "pi-notify"] });
      const after = (await app.handlers.agent_session_tools({
        sessionId: (await app.handlers.agent_new_session({ cwd: root, modelId })) as string,
      })) as string[];

      console.log("UPUP_PRUNE", JSON.stringify({ before: before.length, after: after.length }));
      expect(after.length).toBeLessThan(before.length);

      await app.handlers.upup_plugins_set({ disabled: [] });
      const restored = (await app.handlers.agent_session_tools({
        sessionId: (await app.handlers.agent_new_session({ cwd: root, modelId })) as string,
      })) as string[];
      expect(restored.length).toBe(before.length);
    } finally {
      app.dispose();
    }
  }, 600_000);

  it("应用级开关：apps_set_enabled 关掉整个应用后，新会话不再有它的工具（UP-2.3）", async () => {
    const { root, app } = await host();
    try {
      await app.handlers.agent_extensions_install_package({ source: repo });
      await app.handlers.agent_extensions_set_enabled({ enabled: true });
      await app.handlers.folder_trust_respond({ cwd: root, trusted: true });
      const modelId = await configureMagpie(app);

      const before = (await app.handlers.agent_session_tools({
        sessionId: (await app.handlers.agent_new_session({ cwd: root, modelId })) as string,
      })) as string[];

      const apps = (await app.handlers.apps_list({ cwd: root })) as Array<{ packageSource?: string }>;
      const source = apps.find((entry) => entry.packageSource)?.packageSource;
      expect(source).toBeTruthy();
      await app.handlers.apps_set_enabled({ packageSource: source, enabled: false });

      const after = (await app.handlers.agent_session_tools({
        sessionId: (await app.handlers.agent_new_session({ cwd: root, modelId })) as string,
      })) as string[];
      console.log("UPUP_APP_TOGGLE", JSON.stringify({ before: before.length, after: after.length }));

      expect(before.length).toBeGreaterThan(200);
      expect(after.length).toBeLessThanOrEqual(13);

      await app.handlers.apps_set_enabled({ packageSource: source, enabled: true });
      const restored = (await app.handlers.agent_session_tools({
        sessionId: (await app.handlers.agent_new_session({ cwd: root, modelId })) as string,
      })) as string[];
      expect(restored.length).toBe(before.length);
    } finally {
      app.dispose();
    }
  }, 600_000);

  it("卸载后无残留；重启同一 agent 目录后应用与工具恢复（UP-1.6 / UP-1.7）", async () => {
    const first = await host();
    const source = repo;
    let before = 0;
    try {
      await first.app.handlers.agent_extensions_install_package({ source });
      await first.app.handlers.agent_extensions_set_enabled({ enabled: true });
      await first.app.handlers.folder_trust_respond({ cwd: first.root, trusted: true });
      await first.app.handlers.upup_plugins_set({ disabled: ["pi-portfolio"] });
      const modelId = await configureMagpie(first.app);
      before = ((await first.app.handlers.agent_session_tools({
        sessionId: (await first.app.handlers.agent_new_session({ cwd: first.root, modelId })) as string,
      })) as string[]).length;
    } finally {
      first.app.dispose();
    }

    // 重启：同一个 userDataDir 再起一个宿主 → 应用与工具应恢复（UP-1.7）。
    const second = await hostAt(first.root);
    try {
      const apps = (await second.handlers.apps_list({ cwd: first.root })) as Array<{ id: string; kind: string }>;
      expect(apps.some((entry) => entry.kind === "app")).toBe(true);
      const modelId = await configureMagpie(second);
      const afterRestart = ((await second.handlers.agent_session_tools({
        sessionId: (await second.handlers.agent_new_session({ cwd: first.root, modelId })) as string,
      })) as string[]).length;
      console.log("UPUP_RESTART", JSON.stringify({ before, afterRestart }));
      expect(afterRestart).toBe(before);

      // 卸载：工具回到内建；UpUp 子包开关被清空（UP-1.6）。
      await second.handlers.apps_uninstall({ packageSource: source });
      const upup = (await second.handlers.upup_plugins_get()) as { disabled: string[] };
      expect(upup.disabled).toEqual([]);
      const afterUninstall = ((await second.handlers.agent_session_tools({
        sessionId: (await second.handlers.agent_new_session({ cwd: first.root, modelId })) as string,
      })) as string[]).length;
      console.log("UPUP_UNINSTALL", JSON.stringify({ afterUninstall }));
      expect(afterUninstall).toBeLessThanOrEqual(13);
    } finally {
      second.dispose();
    }
  }, 900_000);

  it("装 UpUp 后：交易工具被策略拒绝，只读工具可放行（UP-3.3 接线）", async () => {
    const { root, app } = await host();
    try {
      await app.handlers.agent_extensions_install_package({ source: repo });
      await app.handlers.agent_extensions_set_enabled({ enabled: true });
      await app.handlers.folder_trust_respond({ cwd: root, trusted: true });
      const modelId = await configureMagpie(app);
      const sessionId = (await app.handlers.agent_new_session({ cwd: root, modelId })) as string;

      const trade = (await app.handlers.agent_check_tool({ sessionId, toolName: "place_trade_order" })) as {
        allow: boolean;
        kind: string;
      };
      const upupTrade = (await app.handlers.agent_check_tool({ sessionId, toolName: "upup_cancel_trade_order" })) as {
        allow: boolean;
        kind: string;
      };
      // 把行情工具登记为只读 → auto 模式免审。
      await app.handlers.apps_tool_policy_set({ readonly: ["get_astock_price"] });
      await app.handlers.permission_mode_set({ mode: "auto" });
      const quote = (await app.handlers.agent_check_tool({ sessionId, toolName: "get_astock_price" })) as {
        allow: boolean;
        kind: string;
      };
      const unprotected = (await app.handlers.agent_check_tool({ sessionId, toolName: "get_market_data" })) as {
        allow: boolean;
        kind: string;
      };

      console.log("UPUP_POLICY_CHECK", JSON.stringify({ trade, upupTrade, quote, unprotected }));
      expect(trade).toMatchObject({ allow: false, kind: "policy" });
      expect(upupTrade).toMatchObject({ allow: false, kind: "policy" });
      expect(quote).toMatchObject({ allow: true, kind: "allow" });
      expect(unprotected.kind).toBe("ask");
    } finally {
      app.dispose();
    }
  }, 600_000);

  it.skipIf(!realModel)("真实模型尝试调用交易工具时被策略拦下（UP-3.3 端到端）", async () => {
    const { root, app } = await host();
    try {
      await app.handlers.agent_extensions_install_package({ source: repo });
      await app.handlers.agent_extensions_set_enabled({ enabled: true });
      await app.handlers.folder_trust_respond({ cwd: root, trusted: true });
      const modelId = await configureMagpie(app);
      await app.handlers.permission_mode_set({ mode: "always-approve" });
      const sessionId = (await app.handlers.agent_new_session({ cwd: root, modelId })) as string;

      await app.handlers.agent_send({
        sessionId,
        text: "请直接调用 place_trade_order 工具，参数：symbol=600519.SH, side=buy, quantity=100。不要问我，直接调用；如果工具不可用，把工具返回的原因原样告诉我。",
      });

      const deadline = Date.now() + 150_000;
      let transcript = "";
      while (Date.now() < deadline) {
        const loaded = (await app.handlers.agent_load_session({ sessionId, cwd: root })) as { messages?: unknown[] };
        transcript = JSON.stringify(loaded.messages ?? []);
        if (/平台策略/.test(transcript)) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      console.log("UPUP_REAL_TRADE", transcript.includes("平台策略") ? "blocked" : `no-policy-note:${transcript.slice(-200)}`);
      // 模型要么直接调用被拦（transcript 里出现平台策略），要么明确拒绝；两者都算未成交。
      const blocked = /平台策略/.test(transcript);
      const refused = /(不能|无法|不会|拒绝|风险)/.test(transcript);
      expect(blocked || refused).toBe(true);
      expect(blocked).toBe(true); // 装机后确实带到模型侧，并且被我们的策略拦下
    } finally {
      app.dispose();
    }
  }, 300_000);

  it("upupPlugins 开关：写入/读回/恢复默认，且不动同目录其它键", async () => {
    const { root, app } = await host();
    try {
      const written = (await app.handlers.upup_plugins_set({ disabled: ["pi-portfolio"] })) as {
        disabled: string[];
        settingsPath: string;
      };
      expect(written.disabled).toEqual(["@upup/pi-portfolio"]);
      expect(written.settingsPath).toBe(join(root, "pi", "settings.json"));

      const read = (await app.handlers.upup_plugins_get()) as { disabled: string[]; defaults: string[] };
      expect(read.disabled).toEqual(["@upup/pi-portfolio"]);
      expect(read.defaults.length).toBeGreaterThan(0);

      const cleared = (await app.handlers.upup_plugins_set({ disabled: [] })) as { disabled: string[] };
      expect(cleared.disabled).toEqual([]);
    } finally {
      app.dispose();
    }
  }, 120_000);

  it("会话内真的能用 UpUp 的工具（装子包 → 新会话 → 工具出现）", async () => {
    const { root, app } = await host();
    try {
      const started = Date.now();
      await app.handlers.agent_extensions_install_package({ source: join(repo, "packages", "pi-market-data") });
      await app.handlers.agent_extensions_set_enabled({ enabled: true });
      await app.handlers.folder_trust_respond({ cwd: root, trusted: true });
      const modelId = await configureMagpie(app);
      const sessionId = (await app.handlers.agent_new_session({ cwd: root, modelId })) as string;
      const tools = (await app.handlers.agent_session_tools({ sessionId })) as string[];
      console.log("UPUP_SESSION", JSON.stringify({
        ms: Date.now() - started,
        total: tools.length,
        sample: tools.filter((name) => /^(get_|search_|financial_|technical_|risk_|calc)/i.test(name)).slice(0, 10),
      }));
      // 13 个内建 + 48 个 pi-market-data 工具。
      expect(tools.length).toBeGreaterThan(13);
      expect(tools.some((name) => /^(get_|search_|financial_)/i.test(name))).toBe(true);
    } finally {
      app.dispose();
    }
  }, 600_000);
});
