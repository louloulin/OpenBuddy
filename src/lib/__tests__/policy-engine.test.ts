import { describe, it, expect } from "vitest";
import {
  mergeRules,
  getPolicyValue,
  isModelAllowed,
  canUploadSkill,
  getLockedPermissionMode,
  getMaxTokensPerDay,
  isFeatureDisabled,
  checkPolicy,
  serializePolicySet,
  deserializePolicySet,
  type PolicyRule,
} from "../security/policy-engine";

describe("mergeRules", () => {
  it("同 type 取最高优先级", () => {
    const rules: PolicyRule[] = [
      { type: "model-whitelist", value: ["a", "b"], priority: 1 },
      { type: "model-whitelist", value: ["c"], priority: 5 },
    ];
    const set = mergeRules(rules);
    expect(set.rules).toHaveLength(1);
    expect(getPolicyValue<string[]>(set, "model-whitelist")).toEqual(["c"]);
  });
  it("同优先级后者覆盖", () => {
    const rules: PolicyRule[] = [
      { type: "permission-mode", value: "default" },
      { type: "permission-mode", value: "acceptEdits" },
    ];
    const set = mergeRules(rules);
    expect(getPolicyValue(set, "permission-mode")).toBe("acceptEdits");
  });
  it("不同 type 各保留一条", () => {
    const rules: PolicyRule[] = [
      { type: "model-whitelist", value: ["a"] },
      { type: "skill-upload", value: false },
    ];
    const set = mergeRules(rules);
    expect(set.rules).toHaveLength(2);
  });
});

describe("策略评估器", () => {
  const set = mergeRules([
    { type: "model-whitelist", value: ["gpt-4", "claude"] },
    { type: "skill-upload", value: false },
    { type: "permission-mode", value: "acceptEdits" },
    { type: "max-tokens-per-day", value: 50000 },
    { type: "disabled-features", value: ["browser-preview", "share"] },
  ]);

  it("isModelAllowed", () => {
    expect(isModelAllowed(set, "gpt-4")).toBe(true);
    expect(isModelAllowed(set, "unknown")).toBe(false);
  });
  it("无白名单 → 全允许", () => {
    const empty = mergeRules([]);
    expect(isModelAllowed(empty, "anything")).toBe(true);
  });
  it("canUploadSkill", () => {
    expect(canUploadSkill(set)).toBe(false);
    expect(canUploadSkill(mergeRules([]))).toBe(true); // 默认允许
  });
  it("getLockedPermissionMode", () => {
    expect(getLockedPermissionMode(set)).toBe("acceptEdits");
    expect(getLockedPermissionMode(mergeRules([]))).toBeUndefined();
  });
  it("getMaxTokensPerDay", () => {
    expect(getMaxTokensPerDay(set)).toBe(50000);
  });
  it("isFeatureDisabled", () => {
    expect(isFeatureDisabled(set, "browser-preview")).toBe(true);
    expect(isFeatureDisabled(set, "knowledge-base")).toBe(false);
  });
});

describe("checkPolicy gate", () => {
  const set = mergeRules([
    { type: "model-whitelist", value: ["gpt-4"] },
    { type: "skill-upload", value: false },
    { type: "disabled-features", value: ["experimental"] },
  ]);

  it("use-model 允许", () => {
    expect(checkPolicy(set, { kind: "use-model", modelId: "gpt-4" })).toEqual({ allowed: true });
  });
  it("use-model 拒绝", () => {
    const r = checkPolicy(set, { kind: "use-model", modelId: "banned" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("banned");
  });
  it("upload-skill 拒绝", () => {
    const r = checkPolicy(set, { kind: "upload-skill" });
    expect(r.allowed).toBe(false);
  });
  it("use-feature 禁用", () => {
    const r = checkPolicy(set, { kind: "use-feature", feature: "experimental" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("experimental");
  });
  it("use-feature 允许(未禁用)", () => {
    expect(checkPolicy(set, { kind: "use-feature", feature: "chat" }).allowed).toBe(true);
  });
});

describe("serialize/deserialize", () => {
  it("往返", () => {
    const set = mergeRules([{ type: "permission-mode", value: "default" }]);
    const json = serializePolicySet(set);
    const back = deserializePolicySet(json);
    expect(back.rules).toHaveLength(1);
    expect(getPolicyValue(back, "permission-mode")).toBe("default");
  });
  it("非法 JSON → fallback", () => {
    expect(deserializePolicySet("bad").rules).toEqual([]);
  });
  it("缺 rules → fallback", () => {
    expect(deserializePolicySet("{}").rules).toEqual([]);
  });
});
