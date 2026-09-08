import { describe, expect, it } from "vitest";
import { invokeConnection } from "./remote-connection";

describe("remote-connection", () => {
  it("delegates named connection dispatches to the live context", async () => {
    const context = {
      get: () => ({
        dispatch: async (method: string, payload: unknown, signal: AbortSignal, request: unknown) => ({
          handled: method === "ping",
          value: { payload, signal: Boolean(signal), request },
        }),
      }),
    };
    const request = { authority: "loopback" as const };
    await expect(invokeConnection(context, "ping", { value: 7 }, request)).resolves.toEqual({
      handled: true,
      value: { payload: { value: 7 }, signal: true, request },
    });
  });

  it("returns handled=false when no connection service is available", async () => {
    await expect(invokeConnection(null, "ping", { value: 7 })).resolves.toEqual({ handled: false });
  });
});
