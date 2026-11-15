// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiSettingsStore } from "../src/settings/pi-settings.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const store = () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-settings-"));
  dirs.push(dir);
  return { dir, store: new PiSettingsStore(dir), file: () => JSON.parse(readFileSync(join(dir, "pi-settings.json"), "utf8")) };
};

describe("pi-settings.json (pii W0.4)", () => {
  it("resolves Pi's defaults before anything is saved, without creating the file", () => {
    const { dir, store: s } = store();
    expect(s.resolved()).toEqual({
      autoCompaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      autoRetry: { enabled: true, maxRetries: 3 },
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      cacheWarming: "idle",
      favoriteRefs: [],
      builtins: {},
    });
    expect(s.builtinEnabled("mode")).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("writes a versioned file that a real Pi SettingsManager reads back", () => {
    const { store: s, file } = store();
    s.update({ autoCompaction: { enabled: false, reserveTokens: 4096 }, autoRetry: { maxRetries: 1 }, steeringMode: "all", favoriteRefs: ["p/a", "p/b"], builtins: { mode: false } });
    expect(file()).toEqual({
      version: 1,
      pi: { compaction: { enabled: false, reserveTokens: 4096 }, retry: { maxRetries: 1 }, steeringMode: "all", enabledModels: ["p/a", "p/b"] },
      builtins: { mode: false },
    });
    const m = s.manager(true);
    expect(m.getCompactionSettings()).toMatchObject({ enabled: false, reserveTokens: 4096 });
    expect(m.getRetrySettings()).toMatchObject({ enabled: true, maxRetries: 1 });
    expect(m.getSteeringMode()).toBe("all");
    expect(m.getEnabledModels()).toEqual(["p/a", "p/b"]);
    expect(m.isProjectTrusted()).toBe(true);
    expect(s.builtinEnabled("mode")).toBe(false);
    // Clearing the favourites drops the key instead of storing an empty scope.
    s.update({ favoriteRefs: [] });
    expect(file().pi.enabledModels).toBeUndefined();
  });

  it("persists writes made through Pi's own setters but never keys outside the allowlist", async () => {
    const { store: s, file } = store();
    s.update({ builtins: { mode: true } });
    const m = s.manager(false);
    m.setFollowUpMode("all");
    m.setCacheWarmingMode("off");
    m.applyOverrides({ httpProxy: "http://user:secret@proxy" });
    m.setDefaultThinkingLevel("high");
    await m.flush();
    expect(file()).toEqual({ version: 1, pi: { followUpMode: "all", cacheWarming: "off" }, builtins: { mode: true } });
    expect(JSON.stringify(file())).not.toContain("secret");
    expect(m.drainErrors()).toEqual([]);
  });

  it("never reads project settings from disk, trusted or not", () => {
    const { dir, store: s } = store();
    const m = s.manager(true);
    expect(m.getProjectSettings()).toEqual({});
    expect(s.manager(false).isProjectTrusted()).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps a corrupt file aside on the next write and starts from the defaults", () => {
    const { dir, store: s, file } = store();
    writeFileSync(join(dir, "pi-settings.json"), "{ not json");
    expect(s.resolved().autoCompaction.enabled).toBe(true);
    s.update({ cacheWarming: "streaming" });
    expect(file()).toMatchObject({ pi: { cacheWarming: "streaming" } });
    expect(readdirSync(dir).some((name) => name.startsWith("pi-settings.json.corrupt-"))).toBe(true);
  });
});
