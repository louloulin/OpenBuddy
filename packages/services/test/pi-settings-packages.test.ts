// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiSettingsStore } from "../src/settings/pi-settings";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-pi-settings-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Pi 包声明持久化 (S16)", () => {
  it("writes packages from setPackages and reads them back in a new manager", async () => {
    const dir = tempDir();
    const store = new PiSettingsStore(dir);
    const manager = store.manager(false);
    manager.setPackages(["npm:pi-web-access", { source: "git:https://github.com/a/b", skills: [] }]);
    await manager.flush();

    const saved = JSON.parse(readFileSync(store.path, "utf8")) as { pi?: { packages?: unknown } };
    expect(saved.pi?.packages).toEqual(["npm:pi-web-access", { source: "git:https://github.com/a/b", skills: [] }]);

    const reloaded = new PiSettingsStore(dir).manager(false).getPackages();
    expect(reloaded).toEqual(["npm:pi-web-access", { source: "git:https://github.com/a/b", skills: [] }]);
  });
});
