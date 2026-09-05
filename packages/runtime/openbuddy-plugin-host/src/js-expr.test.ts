import { describe, expect, it } from "vitest";
import { evaluate, interpolate, isJsExpr } from "./js-expr";

describe("js-expr (deepseek-harness `!!js` parity)", () => {
  it("evaluates a simple expression against a scope object", () => {
    expect(evaluate({ x: 2, y: 3 }, "x + y")).toBe(5);
  });

  it("resolves scope helpers (mimics deepseek's dshHomePath)", () => {
    const scope = { dshHomePath: (sub: string) => `/home/me/.dsh/${sub}` };
    expect(evaluate(scope, "dshHomePath('sessions')")).toBe("/home/me/.dsh/sessions");
  });

  it("isJsExpr recognises the { __jsExpr } payload", () => {
    expect(isJsExpr({ __jsExpr: "dshHomePath('sessions')" })).toBe(true);
    expect(isJsExpr("plain string")).toBe(false);
    expect(isJsExpr({ other: "field" })).toBe(false);
    expect(isJsExpr(null)).toBe(false);
  });

  it("interpolate walks nested structures, replacing JsExpr nodes", () => {
    const scope = { base: "/home/me" };
    const input = {
      path: { __jsExpr: "base + '/sessions'" } as { __jsExpr: string },
      nested: {
        list: [
          { value: { __jsExpr: "base + '/a'" } as { __jsExpr: string } },
          { value: "static" },
        ],
      },
    };
    const out = interpolate(scope, input) as {
      path: string;
      nested: { list: Array<{ value: string | { __jsExpr: string } }> };
    };
    expect(out.path).toBe("/home/me/sessions");
    expect(out.nested.list[0]?.value).toBe("/home/me/a");
    expect(out.nested.list[1]?.value).toBe("static");
  });

  it("interpolate returns primitives untouched", () => {
    expect(interpolate({}, 42)).toBe(42);
    expect(interpolate({}, null)).toBe(null);
    expect(interpolate({}, "hello")).toBe("hello");
  });
});
