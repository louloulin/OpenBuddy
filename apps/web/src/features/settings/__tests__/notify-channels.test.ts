import { describe, it, expect } from "vitest";
import {
  buildSlackPayload,
  buildDiscordPayload,
  buildGenericPayload,
  buildMailtoUrl,
  buildPayload,
  CHANNEL_KIND_LABELS,
  type NotifyChannel,
  type NotifyMessage,
} from "../notify-channels";

// 20261116-pii W4.6：载荷构造已挪到 @openbuddy/protocol/notifications（渲染层与主进程共用）。
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

describe("渠道类型文案", () => {
  it("五种渠道都有中文名", () => {
    expect(Object.keys(CHANNEL_KIND_LABELS)).toEqual([
      "slack-webhook",
      "discord-webhook",
      "generic-webhook",
      "email",
      "desktop",
    ]);
    expect(CHANNEL_KIND_LABELS.desktop).toBe("桌面通知");
  });
});
