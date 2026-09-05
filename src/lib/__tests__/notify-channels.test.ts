import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  buildSlackPayload,
  buildDiscordPayload,
  buildGenericPayload,
  buildMailtoUrl,
  buildPayload,
  registerNotifyChannel,
  unregisterNotifyChannel,
  listNotifyChannels,
  listAllNotifyChannels,
  resetNotifyChannels,
  dispatchNotification,
  type NotifyChannel,
  type NotifyMessage,
} from "../notify/notify-channels";

const msg: NotifyMessage = { title: "任务完成", body: "已生成报告", level: "info" };

describe("载荷构造器", () => {
  it("buildSlackPayload 含 emoji + blocks", () => {
    const p = buildSlackPayload(msg);
    expect(p.text).toContain("任务完成");
    expect(p.blocks?.[0].text.text).toContain("已生成报告");
  });
  it("buildSlackPayload error 级别用红圆", () => {
    expect(buildSlackPayload({ title: "x", level: "error" }).text).toContain("🔴");
    expect(buildSlackPayload({ title: "x", level: "warn" }).text).toContain("🟡");
    expect(buildSlackPayload({ title: "x", level: "info" }).text).toContain("🔵");
  });
  it("buildDiscordPayload 含 embeds + color", () => {
    const p = buildDiscordPayload(msg);
    expect(p.embeds?.[0].title).toBe("任务完成");
    expect(p.embeds?.[0].description).toBe("已生成报告");
    expect(p.embeds?.[0].color).toBe(0x0ea5e9);
  });
  it("buildGenericPayload 含 title/body/level/ts", () => {
    const p = buildGenericPayload(msg);
    expect(p.title).toBe("任务完成");
    expect(p.body).toBe("已生成报告");
    expect(p.level).toBe("info");
    expect(typeof p.ts).toBe("number");
  });
  it("buildMailtoUrl 含 mailto: + subject + body", () => {
    const ch: NotifyChannel = { id: "m", label: "M", kind: "email", endpoint: "a@b.com", enabled: true };
    const url = buildMailtoUrl(ch, msg);
    expect(url.startsWith("mailto:a@b.com?")).toBe(true);
    expect(url).toContain(encodeURIComponent("任务完成"));
    expect(url).toContain(encodeURIComponent("已生成报告"));
  });
});

describe("buildPayload 按 kind 分发", () => {
  const slack: NotifyChannel = { id: "s", label: "S", kind: "slack-webhook", enabled: true };
  const discord: NotifyChannel = { id: "d", label: "D", kind: "discord-webhook", enabled: true };
  const generic: NotifyChannel = { id: "g", label: "G", kind: "generic-webhook", enabled: true };
  const email: NotifyChannel = { id: "e", label: "E", kind: "email", endpoint: "a@b.com", enabled: true };

  it("slack → SlackPayload", () => {
    const p = buildPayload(slack, msg) as { text: string };
    expect(p.text).toContain("任务完成");
  });
  it("discord → DiscordPayload", () => {
    const p = buildPayload(discord, msg) as { embeds: unknown[] };
    expect(p.embeds).toBeDefined();
  });
  it("generic → generic object", () => {
    expect((buildPayload(generic, msg) as { title: string }).title).toBe("任务完成");
  });
  it("email → mailto url 字符串", () => {
    expect(typeof buildPayload(email, msg)).toBe("string");
  });
});

describe("渠道注册表", () => {
  beforeEach(resetNotifyChannels);

  const ch = (id: string, enabled = true): NotifyChannel => ({
    id,
    label: id,
    kind: "generic-webhook",
    enabled,
  });

  it("注册后可列出(仅启用)", () => {
    registerNotifyChannel(ch("a"));
    registerNotifyChannel(ch("b", false));
    expect(listNotifyChannels().map((c) => c.id)).toEqual(["a"]);
    expect(listAllNotifyChannels().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("同 id 不重复注册", () => {
    registerNotifyChannel(ch("a"));
    registerNotifyChannel(ch("a"));
    expect(listAllNotifyChannels()).toHaveLength(1);
  });

  it("unregister 按 id 移除", () => {
    registerNotifyChannel(ch("a"));
    expect(unregisterNotifyChannel("a")).toBe(true);
    expect(listAllNotifyChannels()).toHaveLength(0);
    expect(unregisterNotifyChannel("nope")).toBe(false);
  });

  it("reset 清空", () => {
    registerNotifyChannel(ch("a"));
    resetNotifyChannels();
    expect(listAllNotifyChannels()).toEqual([]);
  });
});

describe("dispatchNotification", () => {
  beforeEach(resetNotifyChannels);

  it("向所有启用渠道分发,注入 sender 返回每渠道结果", async () => {
    registerNotifyChannel({
      id: "s",
      label: "Slack",
      kind: "slack-webhook",
      endpoint: "https://slack/x",
      enabled: true,
    });
    registerNotifyChannel({
      id: "d",
      label: "Discord",
      kind: "discord-webhook",
      enabled: false,
    });
    const sender = vi.fn(async () => true);
    const res = await dispatchNotification(msg, { sender });
    // 只向启用的 s 分发。
    expect(sender).toHaveBeenCalledTimes(1);
    expect(res).toEqual([{ id: "s", ok: true }]);
  });

  it("sender 抛错 → 该渠道 ok:false,不影响其它", async () => {
    registerNotifyChannel({
      id: "bad",
      label: "Bad",
      kind: "generic-webhook",
      enabled: true,
    });
    registerNotifyChannel({
      id: "good",
      label: "Good",
      kind: "generic-webhook",
      enabled: true,
    });
    const sender = vi.fn(async (c: NotifyChannel) => {
      if (c.id === "bad") throw new Error("net");
      return true;
    });
    const res = await dispatchNotification(msg, { sender });
    expect(res).toEqual([
      { id: "bad", ok: false },
      { id: "good", ok: true },
    ]);
  });

  it("无启用渠道返回空数组", async () => {
    const sender = vi.fn();
    expect(await dispatchNotification(msg, { sender })).toEqual([]);
    expect(sender).not.toHaveBeenCalled();
  });

  it("sender 收到按 kind 构造的 payload(slack → 含 text)", async () => {
    registerNotifyChannel({
      id: "s",
      label: "Slack",
      kind: "slack-webhook",
      enabled: true,
    });
    let received: unknown = null;
    await dispatchNotification(msg, {
      sender: async (_c, payload) => {
        received = payload;
        return true;
      },
    });
    expect((received as { text: string }).text).toContain("任务完成");
  });
});
