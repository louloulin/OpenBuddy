import { describe, expect, it } from "vitest";

import { WsBridgeTransport } from "../ws-bridge-transport";

/**
 * The transport is constructed while the app boots. A malformed base URL used
 * to throw out of the constructor and take the whole renderer down with it.
 */
describe("WsBridgeTransport 非法 base URL", () => {
  it("构造不抛错，状态为 closed", () => {
    let transport: WsBridgeTransport | undefined;
    expect(() => {
      transport = new WsBridgeTransport({
        baseUrl: "not a url",
        token: "t",
        socketFactory: () => {
          throw new Error("must not be called");
        },
      });
    }).not.toThrow();
    expect(transport?.state()).toBe("closed");
    transport?.close();
  });
});
