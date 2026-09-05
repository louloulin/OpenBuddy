import { describe, expect, it } from "vitest";
import { describeTypertCatalog } from "./typert-catalog";

describe("Typert catalog projection", () => {
  it("projects packages, invocations, and JSON schemas without exposing runtime objects", () => {
    const schema = { type: "object", properties: { value: { type: "string" } } };
    const result = describeTypertCatalog({
      listPackages: () => [{ package: "@fixture/demo", face: "host", key: "@fixture/demo#host", model: { services: [] }, invocations: [{ namespace: "demo", method: "ping" }] }],
      list: () => [{ package: "@fixture/demo", face: "host", key: "@fixture/demo#Request", name: "Request" }],
      toJSONSchema: () => schema,
    });

    expect(result).toEqual({
      packages: [{
        package: "@fixture/demo",
        face: "host",
        key: "@fixture/demo#host",
        model: { services: [] },
        invocations: [{ namespace: "demo", method: "ping" }],
        schemas: [{ key: "@fixture/demo#Request", name: "Request", schema }],
      }],
      diagnostics: [],
    });
  });

  it("isolates schema serialization failures and sanitizes non-JSON values", () => {
    const cyclic: Record<string, unknown> = { value: 1 };
    cyclic.self = cyclic;
    const result = describeTypertCatalog({
      listPackages: () => [{ package: "@fixture/demo", face: "host", key: "@fixture/demo#host", model: cyclic, invocations: [] }],
      list: () => [
        { package: "@fixture/demo", face: "host", key: "@fixture/demo#Good", name: "Good" },
        { package: "@fixture/demo", face: "host", key: "@fixture/demo#Broken", name: "Broken" },
      ],
      toJSONSchema: (key) => {
        if (key.endsWith("Broken")) throw new Error("schema unavailable");
        return { type: "string" };
      },
    });

    expect(result.packages[0]?.model).toEqual({ value: 1, self: "[circular]" });
    expect(result.packages[0]?.schemas).toEqual([
      { key: "@fixture/demo#Good", name: "Good", schema: { type: "string" } },
      { key: "@fixture/demo#Broken", name: "Broken" },
    ]);
    expect(result.diagnostics).toEqual([{ package: "@fixture/demo", key: "@fixture/demo#Broken", message: "schema unavailable" }]);
  });
});
