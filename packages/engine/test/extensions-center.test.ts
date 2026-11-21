// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { sdkFixture } from "./helpers/sdk-fixture.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const GOOD = `export default function (pi) { pi.registerCommand("hello-ext", { description: "示例扩展命令", handler: async () => {} }); }`;
const BROKEN = `throw new Error("boom from extension");`;

describe("扩展中心 (pii W2.6 / U7.3)", () => {
  it("previews a path in an isolated loader and refuses a broken one without touching the session", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const dir = join(f.root, "exts");
    await mkdir(dir, { recursive: true });
    const good = join(dir, "good.js");
    const broken = join(dir, "broken.js");
    await writeFile(good, GOOD);
    await writeFile(broken, BROKEN);

    const report = (await f.call("agent_extensions_inspect", { path: good })) as any;
    expect(report).toMatchObject({ ok: true, commands: ["hello-ext"], error: null });

    const bad = (await f.call("agent_extensions_inspect", { path: broken })) as any;
    expect(bad.ok).toBe(false);
    expect(String(bad.error)).toContain("boom from extension");

    // Adding is refused up front: the path never enters the configuration.
    await expect(f.call("agent_extensions_add", { path: broken })).rejects.toThrow(/extension_load_failed/);
    expect(((await f.call("agent_extensions_list")) as any).paths).not.toContain(broken);
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "fixture" });
  });

  it("records a path that breaks after it was added, and toggles each path individually", async () => {
    const f = await sdkFixture(() => ({ text: "ok" }), cleanups);
    const dir = join(f.root, "exts");
    await mkdir(dir, { recursive: true });
    const good = join(dir, "good.js");
    await writeFile(good, GOOD);

    await f.call("agent_extensions_set_enabled", { enabled: true });
    const added = (await f.call("agent_extensions_add", { path: good })) as any;
    const real = realpathSync(good);
    expect(added.paths).toContain(real);
    expect(await f.call("commands_list")).toContainEqual(expect.objectContaining({ name: "hello-ext" }));

    // Per-path switch: off means configured but not loaded (the session keeps working).
    const off = (await f.call("agent_extensions_set_path_enabled", { path: good, enabled: false })) as any;
    expect(off.disabled).toContain(real);
    expect(await f.call("commands_list")).not.toContainEqual(expect.objectContaining({ name: "hello-ext" }));
    await f.call("agent_extensions_set_path_enabled", { path: good, enabled: true });
    expect(await f.call("commands_list")).toContainEqual(expect.objectContaining({ name: "hello-ext" }));

    // The file breaks on disk; the next reload records the error instead of failing the session.
    await writeFile(good, BROKEN);
    await f.call("agent_extensions_set_path_enabled", { path: good, enabled: false });
    const listed = (await f.call("agent_extensions_set_path_enabled", { path: good, enabled: true })) as any;
    expect(listed.items[0]).toMatchObject({ path: real, ok: false });
    expect(String(listed.items[0].error)).toContain("boom from extension");
        expect(listed.errors).toContainEqual(expect.objectContaining({ path: real }));
    // The live session was not taken down by the broken extension.
    expect(await f.call("agent_get_model_state", { sessionId: f.sid })).toMatchObject({ modelId: "fixture" });
    expect(f.events.some((event) => event.name === "agent://error" && String(event.payload.message).includes("扩展加载失败"))).toBe(true);
  });
});
