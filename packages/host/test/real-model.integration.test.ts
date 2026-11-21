// @vitest-environment node
/**
 * Real-model smoke (opt-in): uses the provider from ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY /
 * ANTHROPIC_MODEL, runs one Pi turn and requires a real `write` tool call.
 *
 *   OPENBUDDY_REAL_MODEL=1 npx vitest run packages/host/test/real-model.integration.test.ts
 *
 * The suite is skipped in the normal run: no credentials, no network.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const baseUrl = process.env.ANTHROPIC_BASE_URL;
const apiKey = process.env.ANTHROPIC_API_KEY;
const modelId = process.env.ANTHROPIC_MODEL;
const enabled = process.env.OPENBUDDY_REAL_MODEL === "1" && !!baseUrl && !!apiKey && !!modelId;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function until(check: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw Error("timeout waiting for the model");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe.skipIf(!enabled)("真实模型运行 (B3d smoke)", () => {
  it("通过 Pi 的 write 工具写出文件并读回", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbuddy-real-model-"));
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
    try {
      await app.handlers.providers_save_provider({
        provider: {
          id: "real-anthropic",
          providerKind: "custom_anthropic",
          label: "Anthropic (real)",
          baseUrl,
          apiBackend: "messages",
          authScheme: "x_api_key",
          apiKey,
        },
      });
      await app.handlers.providers_save_model({
        model: { modelId, providerId: "real-anthropic", displayName: modelId },
      });
      await app.handlers.permission_mode_set({ mode: "always-approve" });
      const sessionId = await app.handlers.agent_new_session({ cwd: root, modelId });
      await app.handlers.agent_send({
        sessionId,
        text: "调用 write 工具在当前工作目录创建 real-model-check.md，内容只有一行 REAL_MODEL_OK。完成后回复 DONE。",
      });
      const target = join(root, "real-model-check.md");
      await until(() => existsSync(target) && readFileSync(target, "utf8").includes("REAL_MODEL_OK"), 180_000);
      expect(readFileSync(target, "utf8")).toContain("REAL_MODEL_OK");
      const artifacts = await app.handlers.artifacts_list({ sessionId });
      expect(Array.isArray(artifacts)).toBe(true);
    } finally {
      app.dispose();
    }
  }, 240_000);
});
