// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "@openbuddy/services/settings/settings";
import { Permissions, deniedByPlatform } from "../src/permissions/permissions.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString(),
};

function gate() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-policy-"));
  dirs.push(root);
  const settings = createSettings(root, secure);
  return { settings, permissions: new Permissions(settings, () => {}) };
}

describe("工具策略 (20261126-upup UP-3.2)", () => {
  it("交易类工具按名字（含 upup_ 前缀）识别为平台禁用", () => {
    expect(deniedByPlatform("place_trade_order")).toBe(true);
    expect(deniedByPlatform("upup_place_trade_order")).toBe(true);
    expect(deniedByPlatform("cancel_trade_order")).toBe(true);
    expect(deniedByPlatform("get_trade_quote")).toBe(false);
    expect(deniedByPlatform("evaluate_trade")).toBe(false);
  });

  it("即使 always-approve，交易工具也被拒绝并给出原因", async () => {
    const { settings, permissions } = gate();
    settings.config.write({ ...settings.config.read(), permissionMode: "always-approve" });
    const decision = await permissions.decision("s1", "c1", "upup_place_trade_order", {});
    expect(decision.allow).toBe(false);
    expect(decision.kind).toBe("policy");
    expect(decision.note).toContain("平台策略");
    // extension 里也必须是 block，而不是放行
    const extension = permissions.extension("s1");
    expect(typeof extension).toBe("function");
  });

  it("配置里的 deniedTools 同样最先生效", async () => {
    const { settings, permissions } = gate();
    settings.config.write({ ...settings.config.read(), permissionMode: "always-approve", deniedTools: ["custom_danger"] });
    expect((await permissions.decision("s1", "c1", "custom_danger", {})).allow).toBe(false);
    expect(await permissions.decision("s1", "c2", "read", { path: "/a" })).toMatchObject({ allow: true });
  });

  it("auto 模式下应用声明的只读工具免审，其它只读扩展工具仍要问", async () => {
    const { settings, permissions } = gate();
    settings.config.write({ ...settings.config.read(), permissionMode: "auto", readonlyTools: ["get_astock_price"] });
    expect(permissions.decide("s1", "read", { path: "/a" })).toBe(true);
    expect(permissions.decide("s1", "get_astock_price", {})).toBe(true);
    expect(permissions.decide("s1", "get_market_data", {})).toBeUndefined();
  });
});
