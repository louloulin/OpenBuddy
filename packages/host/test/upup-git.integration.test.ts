// @vitest-environment node
/**
 * UpUp 通过 Git 源安装的实测 (2026-11-27)。
 *
 *   OPENBUDDY_UPUP_GIT=1 npx vitest run packages/host/test/upup-git.integration.test.ts
 *
 * 这是「与 `pi install <url>` 等价」的路径：Pi 包管理器直接克隆仓库并解析。
 * 需要网络，耗时取决于仓库大小；默认跳过，避免拖慢常规测试。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const source = process.env.UPUP_GIT_SOURCE ?? "https://gitcode.com/lumosaigroup/upup.git";
const enabled = process.env.OPENBUDDY_UPUP_GIT === "1";
const magpieUrl = process.env.MAGPIE_URL ?? "http://127.0.0.1:3425/v1";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function host() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-upup-git-"));
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

describe.skipIf(!enabled)("UpUp Git 安装 (2026-11-27)", () => {
  it("预演 Git 源能解析出真实工具与技能", { timeout: 900_000 }, async () => {
    const { app } = await host();
    const preview = (await app.handlers.agent_extensions_preview_package({ source })) as {
      extensions: Array<{ tools: string[]; error: string | null }>;
      skills: string[];
      failures: Array<{ message: string }>;
    };
    const tools = preview.extensions.flatMap((entry) => entry.tools);
    console.log("UPUP_GIT_PREVIEW", JSON.stringify({ source, tools: tools.length, skills: preview.skills.length, failures: preview.failures.length }));
    expect(tools.length).toBeGreaterThan(0);
  });

  it("安装 Git 源后 apps_list 出现 upup，新会话能拿到它的工具", { timeout: 900_000 }, async () => {
    const { root, app } = await host();
    // 本机 magpie 网关（免 Key），只用于建会话。
    await app.handlers.providers_save_provider({
      provider: { id: "magpie", providerKind: "magpie", label: "magpie", baseUrl: magpieUrl, apiBackend: "chat_completions", authScheme: "bearer" },
    });
    const fetched = (await app.handlers.providers_fetch_models({ providerId: "magpie" })) as Array<{ id: string }>;
    const chosen = fetched.find((m) => !String(m.id).startsWith("auto/")) ?? fetched[0];
    expect(chosen).toBeTruthy();
    await app.handlers.providers_save_model({ model: { modelId: chosen.id, providerId: "magpie", displayName: chosen.id } });

    await app.handlers.agent_extensions_install_package({ source });
    await app.handlers.agent_extensions_set_enabled({ enabled: true });
    await app.handlers.folder_trust_respond({ cwd: root, trusted: true });

    const apps = (await app.handlers.apps_list({ cwd: root })) as Array<{ id: string; source: string }>;
    console.log("UPUP_GIT_APPS", JSON.stringify(apps));
    expect(apps.map((entry) => entry.id)).toContain("upup");
    expect(apps[0]).toMatchObject({ id: "openbuddy", source: "builtin" });

    // U2/U6：检查更新 + 更新 Git 源，真实走 Pi 包管理器并记录来源/版本/commit。
    const updates = (await app.handlers.agent_extensions_check_updates({ cwd: root })) as Array<{ source?: string }>;
    console.log("UPUP_GIT_UPDATES", JSON.stringify(updates));
    const updated = (await app.handlers.apps_update({ packageSource: source })) as {
      packages: Array<{ source: string }>;
      install: { version?: string; commit?: string } | null;
      canRollback: boolean;
    };
    console.log("UPUP_GIT_UPDATE", JSON.stringify(updated.packages.map((pkg) => pkg.source)), JSON.stringify(updated.install));
    expect(updated.packages.some((pkg) => /upup/i.test(pkg.source))).toBe(true);
    expect(updated.install?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(updated.install?.version).toBeTruthy();

    const installs = (await app.handlers.apps_install_state({})) as Record<string, { current: { version?: string; commit?: string } }>;
    console.log("UPUP_GIT_INSTALL_STATE", JSON.stringify(installs));
    expect(installs[source]?.current.commit).toBe(updated.install?.commit);

    const sessionId = (await app.handlers.agent_new_session({ cwd: root, modelId: chosen.id })) as string;
    const tools = (await app.handlers.agent_session_tools({ sessionId })) as string[];
    console.log("UPUP_GIT_TOOLS", JSON.stringify({ total: tools.length, sample: tools.slice(0, 5) }));
    expect(tools.length).toBeGreaterThan(100);
  });
});
