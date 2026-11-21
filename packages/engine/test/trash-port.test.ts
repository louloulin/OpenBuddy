// @vitest-environment node
// R2: the engine moves files to the trash through the host's injected HostShell.trash instead of loading electron itself.
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PiEngine } from "../src/pi-engine.js";
import { createSettings } from "@openbuddy/services/settings/settings";
import { createEngineHandlers } from "@openbuddy/host/handlers";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
async function setup(trash?: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ob-trash-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const settings = createSettings(root, { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
  const engine = new PiEngine(settings, () => {}, async () => {}, [], undefined, trash);
  const file = join(root, "made-by-agent.txt");
  await writeFile(file, "draft");
  // The checkpoint store's restore path calls this private method.
  const moveToTrash = (path: string) => (engine as unknown as { trash(path: string): Promise<void> }).trash(path);
  return { settings, file, moveToTrash };
}
const exists = (path: string) => stat(path).then(() => true, () => false);

it("hands the file to the injected host trash and leaves <dir>/trash alone", async () => {
  const trash = vi.fn(async (path: string) => { await rm(path); });
  const { settings, file, moveToTrash } = await setup(trash);
  await moveToTrash(file);
  expect(trash).toHaveBeenCalledWith(file);
  expect(await exists(file)).toBe(false);
  expect(await exists(join(settings.dir, "trash"))).toBe(false);
});

it("without a host trash, keeps the existing fallback: <dir>/trash/<ts>-<name>", async () => {
  const { settings, file, moveToTrash } = await setup();
  await moveToTrash(file);
  expect(await exists(file)).toBe(false);
  const moved = await readdir(join(settings.dir, "trash"));
  expect(moved).toHaveLength(1);
  expect(moved[0]).toMatch(/^\d+-made-by-agent\.txt$/);
  expect(await readFile(join(settings.dir, "trash", moved[0]), "utf8")).toBe("draft");
});

it("falls back to <dir>/trash when the host trash fails, as the electron shell.trashItem path did", async () => {
  const trash = vi.fn(async () => { throw new Error("trash unavailable"); });
  const { settings, file, moveToTrash } = await setup(trash);
  await moveToTrash(file);
  expect(trash).toHaveBeenCalledWith(file);
  expect(await exists(file)).toBe(false);
  expect(await readdir(join(settings.dir, "trash"))).toHaveLength(1);
});

// Host wiring: createEngineHandlers passes options.shell.trash to the engine (checkpoint_restore of a created file).
async function restoreCreatedFile(trash?: (path: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ob-trash-host-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const app = await createEngineHandlers({
    userDataDir: root,
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
    emit: () => {},
    shell: { openPath: async () => "", openExternal: async () => {}, showItemInFolder: () => {}, ...(trash ? { trash } : {}) },
  });
  cleanups.push(app.dispose);
  const call = async (name: string, p: Record<string, unknown> = {}) => app.handlers[name](p);
  await call("providers_save_provider", { provider: { id: "fixture", providerKind: "custom", baseUrl: "http://127.0.0.1:9/v1", apiKey: "model-key" } });
  await call("providers_save_model", { model: { modelId: "fixture", providerId: "fixture" } });
  const sessionId = await call("agent_new_session", { cwd: root, modelId: "fixture" });
  const file = join(root, "made-by-agent.txt");
  await writeFile(file, "draft");
  await call("checkpoint_restore", { sessionId, path: file });
  return { root, file };
}

it("createEngineHandlers hands options.shell.trash to the engine", async () => {
  const trash = vi.fn(async (path: string) => { await rm(path); });
  const { root, file } = await restoreCreatedFile(trash);
  expect(trash).toHaveBeenCalledWith(file);
  expect(await exists(file)).toBe(false);
  expect(await exists(join(root, "pi", "trash"))).toBe(false);
});

it("createEngineHandlers without shell.trash keeps the <dir>/trash fallback", async () => {
  const { root, file } = await restoreCreatedFile();
  expect(await exists(file)).toBe(false);
  expect(await readdir(join(root, "pi", "trash"))).toEqual([expect.stringMatching(/^\d+-made-by-agent\.txt$/)]);
});
