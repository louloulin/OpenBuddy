// @vitest-environment node
/**
 * 启动自检 (20261127-upup §1.18)：真实宿主上跑 agent_self_check。
 * 没配模型时「模型配置」失败、「模型连通」直接失败不发请求；内置应用按目录判完整；
 * save 写到 <userData>/diagnostics，报告里没有绝对路径。
 */
import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";
import { validateCommandPayload } from "@openbuddy/protocol/validate";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

it("agent_self_check 汇总本机检查并保存脱敏报告", { timeout: 60_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "openbuddy-selfcheck-host-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const bundled = join(root, "Resources", "upup");
  mkdirSync(join(bundled, "node_modules"), { recursive: true });
  writeFileSync(join(bundled, "package.json"), JSON.stringify({ name: "upup", version: "2026.10.11" }));
  writeFileSync(join(bundled, ".openbuddy-bundle.json"), JSON.stringify({ commit: "69050042abcdef" }));
  const userData = join(root, "userData");
  const app = await createEngineHandlers({
    userDataDir: userData,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (b: Buffer) => b.toString() },
    emit: () => {},
    shell: { openPath: async () => "", showItemInFolder: () => {}, openExternal: async () => {} },
    bundledApps: [bundled],
    appVersion: "0.9.0",
  });
  cleanups.push(() => app.dispose());
  const h = app.handlers as Record<string, (p: Record<string, unknown>) => Promise<any>>;

  const result = await h.agent_self_check({ probeModel: true, save: true });
  const byId = Object.fromEntries(result.results.map((r: { id: string }) => [r.id, r]));
  expect(Object.keys(byId).sort()).toEqual([
    "apps.bundled", "data.writable", "env.crash_log", "env.system_info", "extensions.load", "model.config", "model.reachable", "system.disk",
  ]);
  expect(byId["apps.bundled"]).toMatchObject({ status: "pass", summary: "upup：2026.10.11 · 6905004" });
  expect(byId["data.writable"].status).toBe("pass");
  expect(byId["env.crash_log"].status).toBe("pass");
  expect(byId["model.config"]).toMatchObject({ status: "fail", summary: "请添加模型" });
  expect(byId["model.reachable"]).toMatchObject({ status: "fail", summary: "没有默认模型可测" });
  expect(result.report).toContain("应用：OpenBuddy 0.9.0");
  expect(result.report).not.toContain(root);
  expect(result.file).toMatch(/^self-check-.*\.txt$/);
  const saved = readFileSync(join(userData, "diagnostics", result.file), "utf8");
  expect(saved).toBe(result.report);
  expect(readdirSync(join(userData, "diagnostics"))).toEqual([result.file]);

  // 不带 probeModel 时不测连通。
  const local = await h.agent_self_check({});
  expect(local.results.some((r: { id: string }) => r.id === "model.reachable")).toBe(false);
  expect(local.file).toBeUndefined();
  expect(() => validateCommandPayload("agent_self_check", { probeModel: "yes" })).toThrow("invalid_payload: probeModel");
});
