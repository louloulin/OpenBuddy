// @vitest-environment node
import { expect, it } from "vitest";
import { ExtensionUiBridge } from "../ui.js";
it("validates typed select/input/confirm responses with matching session identity", async () => {
  const events: Array<{ name: string; value: any }> = [];
  const bridge = new ExtensionUiBridge((name, value) =>
    events.push({ name, value }),
  );
  const ui = bridge.context("session");
  const answer = ui.select("Choose", ["one", "two"]);
  const request = events.at(-1)!.value;
  expect(() =>
    bridge.resolve({
      sessionId: "other",
      requestId: request.requestId,
      value: "one",
    }),
  ).toThrow();
  expect(() =>
    bridge.resolve({
      sessionId: "session",
      requestId: request.requestId,
      value: "invalid",
    }),
  ).toThrow();
  bridge.resolve({
    sessionId: "session",
    requestId: request.requestId,
    value: "two",
  });
  expect(await answer).toBe("two");
  const confirm = ui.confirm("Confirm", "Proceed?");
  bridge.cancel("session", "session_closed");
  expect(await confirm).toBe(false);
  expect(events.at(-1)!.value.reason).toBe("session_closed");
});
it("cancels on SDK AbortSignal and timeout and rejects stale resolutions", async () => {
  const events: any[] = [];
  const bridge = new ExtensionUiBridge((_n, p) => events.push(p));
  const ui = bridge.context("s");
  const c = new AbortController();
  const input = ui.input("Value", "hint", { signal: c.signal });
  const id = events.at(-1).requestId;
  c.abort();
  expect(await input).toBeUndefined();
  expect(() =>
    bridge.resolve({ sessionId: "s", requestId: id, value: "stale" }),
  ).toThrow();
  const timed = ui.select("Timeout", ["x"], { timeout: 10 });
  expect(await timed).toBeUndefined();
  expect(events.at(-1).reason).toBe("timeout");
  await expect(
    ui.custom(() => {
      throw Error("should not run");
    }),
  ).rejects.toThrow("not_implemented");
});
it("prevents stale contexts from opening new dialogs after cancellation or same-id replacement", async () => {
  const events: any[] = [];
  const bridge = new ExtensionUiBridge((name, p) => events.push({ name, p }));
  const old = bridge.context("s");
  const pending = old.input("old");
  bridge.cancel("s", "session_closed");
  expect(await pending).toBeUndefined();
  const next = bridge.context("s"),
    count = events.length;
  expect(await old.input("stale")).toBeUndefined();
  expect(events).toHaveLength(count);
  const current = next.input("current");
  const request = events.at(-1).p;
  bridge.resolve({
    requestId: request.requestId,
    sessionId: "s",
    value: "active",
  });
  expect(await current).toBe("active");
});
