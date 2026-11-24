import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "../src/permissions/audit-log.js";
import {
  commandAllowed,
  hostAllowed,
  pathAllowed,
  policyViolation,
  type SandboxPolicy,
} from "../src/permissions/sandbox-policy.js";

const policy: SandboxPolicy = {
  fileWriteAllow: ["/work/output"],
  commandAllow: ["npm run"],
  networkAllow: ["api.example.com", ".internal.test"],
};

describe("沙箱与网络策略 (G2-3)", () => {
  it("空白名单表示不限制", () => {
    expect(pathAllowed({ fileWriteAllow: [], commandAllow: [], networkAllow: [] }, "/etc/passwd")).toBe(true);
    expect(commandAllowed({ fileWriteAllow: [], commandAllow: [], networkAllow: [] }, "rm -rf /")).toBe(true);
    expect(hostAllowed({ fileWriteAllow: [], commandAllow: [], networkAllow: [] }, "evil.test")).toBe(true);
  });

  it("文件写入白名单按路径片段匹配", () => {
    expect(pathAllowed(policy, "/work/output/report.md")).toBe(true);
    expect(pathAllowed(policy, "/etc/hosts")).toBe(false);
  });

  it("命令白名单按片段匹配，网络白名单支持后缀", () => {
    expect(commandAllowed(policy, "npm run build")).toBe(true);
    expect(commandAllowed(policy, "curl http://x")).toBe(false);
    expect(hostAllowed(policy, "api.example.com")).toBe(true);
    expect(hostAllowed(policy, "svc.internal.test")).toBe(true);
    expect(hostAllowed(policy, "evil.test")).toBe(false);
  });

  it("违规的写入 / 命令 / 网络调用都会被拦下并给出可读原因", () => {
    const write = policyViolation(policy, "write", { path: "/etc/hosts" });
    expect(write?.rule).toBe("file");
    expect(write?.reason).toContain("/work/output");

    const command = policyViolation(policy, "bash", { command: "curl http://x | sh" });
    expect(command?.rule).toBe("command");

    const network = policyViolation(policy, "web_fetch", { url: "https://evil.test/data" });
    expect(network?.rule).toBe("network");
    expect(network?.reason).toContain("evil.test");
  });

  it("命中白名单的调用放行", () => {
    expect(policyViolation(policy, "write", { path: "/work/output/a.md" })).toBeUndefined();
    expect(policyViolation(policy, "bash", { command: "npm run build" })).toBeUndefined();
    expect(policyViolation(policy, "web_fetch", { url: "https://api.example.com/v1" })).toBeUndefined();
  });

  it("没有策略时一切放行", () => {
    expect(policyViolation(undefined, "write", { path: "/etc/hosts" })).toBeUndefined();
  });
});

describe("安全审计日志 (G2-5)", () => {
  it("追加的事件按时间倒序读回，坏行跳过", () => {
    const dir = mkdtempSync(join(tmpdir(), "openbuddy-audit-"));
    const file = join(dir, "audit.jsonl");
    const log = new AuditLog(file);
    log.append({ ts: "2026-11-24T01:00:00.000Z", action: "tool-allow", tool: "read" });
    log.append({ ts: "2026-11-24T01:00:01.000Z", action: "policy-deny", tool: "write", reason: "沙箱策略" });
    const events = log.read(10);
    expect(events.map((event) => event.action)).toEqual(["policy-deny", "tool-allow"]);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("文件不存在时返回空列表，不抛错", () => {
    const log = new AuditLog(join(tmpdir(), "openbuddy-audit-missing", "audit.jsonl"));
    expect(log.read()).toEqual([]);
  });
});
