import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the IPC bridge so we exercise the reader adapter without electron.
const invokeMock = vi.fn();
vi.mock("@/lib/platform/electron-api", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { createElectronDirectoryReader, isElectronAvailable } from "../files/electron-kb-reader";

describe("isElectronAvailable", () => {
  it("returns false in a plain Node test environment", () => {
    expect(isElectronAvailable()).toBe(false);
  });
});

describe("createElectronDirectoryReader", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("lists a directory and normalizes is_dir to isDir", async () => {
    invokeMock.mockResolvedValueOnce([
      { name: "a.md", path: "/docs/a.md", is_dir: false },
      { name: "sub", path: "/docs/sub", is_dir: true },
    ]);
    const reader = createElectronDirectoryReader();
    const entries = await reader.listDir("/docs");
    expect(entries).toEqual([
      { name: "a.md", path: "/docs/a.md", isDir: false },
      { name: "sub", path: "/docs/sub", isDir: true },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("shellfs:browse-directory", "/docs");
  });

  it("returns null text when shellfs read fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("denied"));
    const reader = createElectronDirectoryReader();
    expect(await reader.readText("/secret.txt")).toBeNull();
  });

  it("reads text via shellfs:read-text", async () => {
    invokeMock.mockResolvedValueOnce("hello");
    const reader = createElectronDirectoryReader();
    expect(await reader.readText("/x.txt")).toBe("hello");
    expect(invokeMock).toHaveBeenCalledWith("shellfs:read-text", { path: "/x.txt", cwd: null, maxBytes: 256 * 1024 });
  });

  it("decodes base64 read-bytes payload into Uint8Array", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const b64 = Buffer.from(bytes).toString("base64");
    invokeMock.mockResolvedValueOnce(`data:application/octet-stream;base64,${b64}`);
    const reader = createElectronDirectoryReader();
    const out = await reader.readBytes!("/x.bin");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out!)).toEqual(Array.from(bytes));
  });

  it("returns null bytes when base64 read fails", async () => {
    invokeMock.mockRejectedValueOnce(new Error("denied"));
    const reader = createElectronDirectoryReader();
    expect(await reader.readBytes!("/secret.bin")).toBeNull();
  });
});
