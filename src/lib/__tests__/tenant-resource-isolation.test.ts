import { describe, it, expect, vi } from "vitest";
import { CasdoorResourceBackend } from "@openbuddy/auth-casdoor";

describe("Casdoor resource isolation contract", () => {
  it("rejects unsafe API URLs and never exposes credentials", () => {
    expect(() => new CasdoorResourceBackend("https://user:password@resource.test")).toThrow();
    expect(() => new CasdoorResourceBackend("https://resource.test/path?token=secret")).toThrow();
  });

  it("encodes tenant and resource identifiers in URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock as unknown as typeof fetch);
    await backend.list("token", "tenant/a");
    expect(fetchMock).toHaveBeenCalledWith("https://resource.test/v1/tenants/tenant%2Fa/resources", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer token" }) }));
  });

  it("keeps bearer tokens inside the main-process fetch wrapper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const backend = new CasdoorResourceBackend("https://resource.test", fetchMock as unknown as typeof fetch);
    await backend.list("secret-token", "tenant-a");
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-token");
    expect(JSON.stringify(headers)).not.toContain("password");
  });
});
