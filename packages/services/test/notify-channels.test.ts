// @vitest-environment node
// 通知渠道 (pii W4.6): configuration in the settings, sending from the host.
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "../src/settings/settings";
import { NotifyChannelsService, validateChannelDraft } from "../src/notifications/channels";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const secure = { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

function setup(options: { fetchImpl?: typeof fetch; openExternal?: (url: string) => unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-notify-"));
  dirs.push(root);
  const settings = createSettings(root, secure);
  return { settings, service: new NotifyChannelsService(settings, options) };
}

describe("通知渠道配置 (pii W4.6)", () => {
  it("saves, updates, lists and removes; the config survives a restart", () => {
    const { settings, service } = setup();
    const saved = service.save({ label: "群机器人", kind: "slack-webhook", endpoint: "https://hooks.example/abc" });
    expect(saved.id).toBeTruthy();
    expect(saved.enabled).toBe(true);
    expect(service.list()).toHaveLength(1);

    const updated = service.save({ id: saved.id, kind: "slack-webhook", label: "改名", endpoint: "https://hooks.example/abc", enabled: false });
    expect(updated.label).toBe("改名");
    expect(updated.enabled).toBe(false);
    expect(service.list()).toHaveLength(1);

    // Persisted in the settings config (not in the renderer).
    expect(settings.config.read().notifyChannels).toHaveLength(1);

    service.remove(saved.id);
    expect(service.list()).toEqual([]);
    expect(() => service.remove(saved.id)).toThrow("notify_channel_not_found");
  });

  it("rejects an invalid kind, a non-URL webhook and a bad mail address", () => {
    const { service } = setup();
    expect(() => service.save({ kind: "wechat" as never })).toThrow("invalid_payload");
    expect(() => service.save({ kind: "generic-webhook", endpoint: "not a url" })).toThrow("invalid_payload");
    expect(() => service.save({ kind: "generic-webhook", endpoint: "ftp://x/y" })).toThrow("invalid_payload");
    expect(() => service.save({ kind: "generic-webhook" })).toThrow("invalid_payload");
    expect(() => service.save({ kind: "email", endpoint: "not-an-email" })).toThrow("invalid_payload");
  });

  it("keeps the endpoint of an existing channel when the update omits it", () => {
    const channel = validateChannelDraft({ id: "c1", label: "X", kind: "generic-webhook", endpoint: "https://a/b" });
    expect(channel.endpoint).toBe("https://a/b");
    const same = validateChannelDraft({ id: "c1", kind: "generic-webhook" }, channel);
    expect(same.endpoint).toBe("https://a/b");
  });
});

describe("通知渠道发送 (pii W4.6)", () => {
  it("posts a Slack payload to the webhook and reports the result", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const { service } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const channel = service.save({ label: "Slack", kind: "slack-webhook", endpoint: "https://hooks.example/x" });
    const result = await service.test(channel.id);
    expect(result).toEqual({ id: channel.id, ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example/x");
    expect((init.method as string)).toBe("POST");
    expect(JSON.parse(init.body as string).text).toContain("OpenBuddy 测试通知");
  });

  it("reports an HTTP failure without throwing", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 500 }));
    const { service } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const channel = service.save({ label: "Bad", kind: "generic-webhook", endpoint: "https://hooks.example/y" });
    expect(await service.test(channel.id)).toEqual({ id: channel.id, ok: false, error: "http_500" });
  });

  it("a network error is reported per channel, never thrown", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("net down");
    });
    const { service } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const channel = service.save({ label: "Net", kind: "generic-webhook", endpoint: "https://hooks.example/z" });
    const result = await service.test(channel.id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("net down");
  });

  it("dispatches only to enabled channels and opens mailto for the email kind", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const openExternal = vi.fn();
    const { service } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch, openExternal });
    service.save({ label: "On", kind: "generic-webhook", endpoint: "https://hooks.example/on" });
    service.save({ label: "Off", kind: "generic-webhook", endpoint: "https://hooks.example/off", enabled: false });
    service.save({ label: "Mail", kind: "email", endpoint: "a@b.com" });
    const results = await service.dispatch({ title: "任务完成", body: "报告已生成", level: "info", sessionId: "s1" });
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(String(openExternal.mock.calls[0][0])).toContain("mailto:a@b.com");
  });
});

describe("引擎事件 → 推送 (pii W4.6)", () => {
  it("pushes an approval request and a completion, but only once per turn", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const { service } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    service.save({ label: "On", kind: "generic-webhook", endpoint: "https://hooks.example/on" });

    service.observe("agent://permission", { sessionId: "s1", toolKind: "edit" });
    service.observe("agent://session-status", { sessionId: "s1", status: "running" });
    service.observe("agent://session-status", { sessionId: "s1", status: "idle" });
    service.observe("agent://session-status", { sessionId: "s1", status: "idle" });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies[0].title).toContain("需要你的确认");
    expect(bodies[1].title).toContain("任务完成");
  });

  it("ignores events without a session", () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const { service } = setup({ fetchImpl: fetchImpl as unknown as typeof fetch });
    service.save({ label: "On", kind: "generic-webhook", endpoint: "https://hooks.example/on" });
    service.observe("agent://permission", { toolKind: "edit" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
