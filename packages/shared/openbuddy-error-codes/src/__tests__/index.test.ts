import { describe, expect, it } from "vitest";
import {
  ErrorCodes,
  PROTOCOL_VERSION,
  RpcCallError,
  StableErrorCodeNames,
  stripProxyEnv,
} from "../index.js";

describe("@openbuddy/shared-error-codes", () => {
  it("Exposes the JSON-RPC standard codes plus OpenBuddy-specific codes", () => {
    expect(ErrorCodes.ParseError).toBe(-32700);
    expect(ErrorCodes.MethodNotFound).toBe(-32601);
    expect(ErrorCodes.HostOverloaded).toBe(1002);
    expect(ErrorCodes.HandshakeFailed).toBe(1014);
  });

  it("Stable names map matches numeric codes", () => {
    expect(StableErrorCodeNames[ErrorCodes.HostOverloaded]).toBe("HOST_OVERLOADED");
    expect(StableErrorCodeNames[ErrorCodes.PermissionDenied]).toBe("PERMISSION_DENIED");
    expect(StableErrorCodeNames[-32601]).toBe("METHOD_NOT_FOUND");
  });

  it("Protocol version is stable across TS and Rust", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("RpcCallError.isHostOverloaded honours both code and errorCode", () => {
    const byCode = new RpcCallError("overloaded", ErrorCodes.HostOverloaded, "ANY");
    expect(byCode.isHostOverloaded()).toBe(true);
    const byName = new RpcCallError("overloaded", 9999, "HOST_OVERLOADED");
    expect(byName.isHostOverloaded()).toBe(true);
    const unrelated = new RpcCallError("no", ErrorCodes.SecretNotFound, "SECRET_NOT_FOUND");
    expect(unrelated.isHostOverloaded()).toBe(false);
  });

  it("stripProxyEnv removes proxy variables but preserves the rest", () => {
    const out = stripProxyEnv({
      PATH: "/usr/bin",
      HTTP_PROXY: "http://user:pw@proxy.example.com",
      HTTPS_PROXY: "http://user:pw@proxy.example.com",
      NO_PROXY: "localhost",
      OPENBUDDY_KEY: "secret",
      lowercase_proxy: "should also go",
    });
    expect(out.PATH).toBe("/usr/bin");
    expect(out.OPENBUDDY_KEY).toBe("secret");
    expect("HTTP_PROXY" in out).toBe(false);
    expect("HTTPS_PROXY" in out).toBe(false);
    expect("NO_PROXY" in out).toBe(false);
    expect("lowercase_proxy" in out).toBe(false);
  });
});
