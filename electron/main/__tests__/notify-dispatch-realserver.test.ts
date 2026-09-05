// @vitest-environment node
/**
 * Real end-to-end test for `dispatchMainNotifications` (the IPC handler
 * body for `notify:dispatch` defined in `electron/main/ipc.ts`).
 *
 * Exercises:
 *   - slack-webhook payload format (text + blocks)
 *   - discord-webhook payload format (content + embeds)
 *   - generic-webhook HTTP POST delivery with JSON body to a real local server
 *   - desktop channel (skipped — requires Electron Notification mock)
 *   - email channel returns a mailto: URL via shell.openExternal (skipped)
 *   - disabled channels are skipped
 *   - failed channels return ok=false
 *   - mixed levels (info / warn / error) map to correct emoji / color
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchMainNotifications, type MainNotificationMessage } from "../notifications";
import * as resources from "../agent/pi-resources";
import type { OpenBuddyNotifyChannel } from "../agent/pi-resources";

let tempDir = "";
let previousPiAgentDir: string | undefined;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "openbuddy-notify-int-"));
  previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tempDir;
  process.env.PI_HOME = tempDir;
});

afterAll(async () => {
  if (previousPiAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
  delete process.env.PI_HOME;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
  contentType: string | undefined;
}

describe("dispatchMainNotifications 真实端到端 (无 mock fetch)", () => {
  let server: Server;
  let baseUrl = "";
  const captured: CapturedRequest[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        captured.push({ method: req.method ?? "POST", url: req.url ?? "/", body, contentType: req.headers["content-type"] });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("slack-webhook payload uses blocks format with level emoji", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [{ id: "slack-int", label: "slack-int", kind: "slack-webhook", endpoint: `${baseUrl}/slack`, enabled: true }];
    const message: MainNotificationMessage = { title: "hello", body: "world", level: "warn" };
    const results = await dispatchMainNotifications(channels, message);
    expect(results).toEqual([{ id: "slack-int", ok: true }]);
    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.url).toBe("/slack");
    expect(req.contentType).toContain("application/json");
    const payload = JSON.parse(req.body);
    expect(payload.text).toContain("🟡 hello");
    expect(payload.blocks[0].text.text).toContain("hello");
    expect(payload.blocks[0].text.text).toContain("world");
  });

  it("discord-webhook payload uses embeds format with warn hex color", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [{ id: "discord-int", label: "discord-int", kind: "discord-webhook", endpoint: `${baseUrl}/discord`, enabled: true }];
    const message: MainNotificationMessage = { title: "warn title", body: "warn body", level: "warn" };
    const results = await dispatchMainNotifications(channels, message);
    expect(results).toEqual([{ id: "discord-int", ok: true }]);
    expect(captured).toHaveLength(1);
    const payload = JSON.parse(captured[0]!.body);
    expect(payload.content).toBe("warn title");
    expect(payload.embeds[0].title).toBe("warn title");
    expect(payload.embeds[0].description).toBe("warn body");
    expect(payload.embeds[0].color).toBe(0xd97706); // warn orange
  });

  it("error level maps to red on discord", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [{ id: "discord-err", label: "discord-err", kind: "discord-webhook", endpoint: `${baseUrl}/discord-err`, enabled: true }];
    await dispatchMainNotifications(channels, { title: "boom", level: "error" });
    const payload = JSON.parse(captured[0]!.body);
    expect(payload.embeds[0].color).toBe(0xdc2626); // error red
  });

  it("info level defaults when omitted, blue color on discord", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [{ id: "discord-info", label: "discord-info", kind: "discord-webhook", endpoint: `${baseUrl}/discord-info`, enabled: true }];
    await dispatchMainNotifications(channels, { title: "all good" });
    const payload = JSON.parse(captured[0]!.body);
    expect(payload.embeds[0].color).toBe(0x0ea5e9); // info blue
  });

  it("generic-webhook posts plain JSON object", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [{ id: "generic-int", label: "generic-int", kind: "generic-webhook", endpoint: `${baseUrl}/generic`, enabled: true }];
    const results = await dispatchMainNotifications(channels, { title: "generic title", body: "generic body", level: "info", sessionId: "sess-int" });
    expect(results).toEqual([{ id: "generic-int", ok: true }]);
    const payload = JSON.parse(captured[0]!.body);
    expect(payload.title).toBe("generic title");
    expect(payload.body).toBe("generic body");
    expect(payload.level).toBe("info");
    expect(payload.sessionId).toBe("sess-int");
    expect(typeof payload.ts).toBe("number");
  });

  it("disabled channels are skipped (no HTTP call)", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [{ id: "disabled", label: "disabled", kind: "slack-webhook", endpoint: `${baseUrl}/disabled`, enabled: false }];
    const results = await dispatchMainNotifications(channels, { title: "skip me" });
    expect(results).toEqual([]);
    expect(captured).toHaveLength(0);
  });

  it("channels without endpoint are skipped (no HTTP call, no crash)", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [
      { id: "no-ep", label: "no-ep", kind: "generic-webhook", enabled: true },
    ];
    const results = await dispatchMainNotifications(channels, { title: "no endpoint" });
    expect(results).toEqual([{ id: "no-ep", ok: false }]);
    expect(captured).toHaveLength(0);
  });

  it("non-http(s) endpoint throws and reports ok=false", async () => {
    const channels: OpenBuddyNotifyChannel[] = [
      { id: "ftp", label: "ftp", kind: "generic-webhook", endpoint: "ftp://example.com/x", enabled: true },
    ];
    const results = await dispatchMainNotifications(channels, { title: "ftp attempt" });
    expect(results).toEqual([{ id: "ftp", ok: false }]);
  });

  it("500 from server returns ok=false", async () => {
    await new Promise<void>((resolve) => {
      const errorServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        res.statusCode = 500;
        res.end("boom");
      });
      errorServer.listen(0, "127.0.0.1", () => {
        const url = `http://127.0.0.1:${(errorServer.address() as AddressInfo).port}/x`;
        dispatchMainNotifications(
          [{ id: "fail", label: "fail", kind: "generic-webhook", endpoint: url, enabled: true }],
          { title: "t" },
        ).then((results) => {
          expect(results).toEqual([{ id: "fail", ok: false }]);
          errorServer.close(() => resolve());
        });
      });
    });
  });

  it("mixed enabled/disabled + mixed http/email: only http webhooks fire", async () => {
    captured.length = 0;
    const channels: OpenBuddyNotifyChannel[] = [
      { id: "h-on", label: "h-on", kind: "generic-webhook", endpoint: `${baseUrl}/mix-on`, enabled: true },
      { id: "h-off", label: "h-off", kind: "generic-webhook", endpoint: `${baseUrl}/mix-off`, enabled: false },
      { id: "slack-on", label: "slack-on", kind: "slack-webhook", endpoint: `${baseUrl}/mix-slack`, enabled: true },
    ];
    const results = await dispatchMainNotifications(channels, { title: "mix" });
    expect(results).toEqual(expect.arrayContaining([
      { id: "h-on", ok: true },
      { id: "slack-on", ok: true },
    ]));
    expect(results.find((r) => r.id === "h-off")).toBeUndefined();
    // Two HTTP requests: h-on and slack-on
    expect(captured.map((c) => c.url).sort()).toEqual(["/mix-on", "/mix-slack"]);
  });
});

describe("notify-channels round-trip via pi-resources (matches IPC handler body)", () => {
  it("persists enabled channels, mutates, then persists again", async () => {
    const initial = await resources.readNotifyChannels();
    expect(Array.isArray(initial)).toBe(true);

    const updated: OpenBuddyNotifyChannel[] = [
      ...initial,
      { id: "rt-int-1", label: "rt-int-1", kind: "slack-webhook", endpoint: "https://hooks.slack.com/test", enabled: true },
      { id: "rt-int-2", label: "rt-int-2", kind: "discord-webhook", endpoint: "https://discord.com/api/test", enabled: false },
    ];
    const saved = await resources.writeNotifyChannels(updated);
    expect(saved.length).toBe(updated.length);

    const reloaded = await resources.readNotifyChannels();
    expect(reloaded.find((c) => c.id === "rt-int-1")?.enabled).toBe(true);
    expect(reloaded.find((c) => c.id === "rt-int-2")?.enabled).toBe(false);
  });
});
