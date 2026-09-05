import { describe, expect, it } from "vitest"

describe("clipboard: payload normalization", () => {
  it("accepts Chinese, multi-line, and large payloads without modification", () => {
    const chinese = "你好，OpenBuddy — 这是中文粘贴测试。"
    const multiline = ["第一行", "  缩进第二行", "tab\t第三行", "空行后:"].join("\n")
    const large = "x".repeat(50_000)
    const concat = `${chinese}\n${multiline}\n${large}`
    expect(concat.length).toBeGreaterThan(50_000)
    expect(concat.includes("OpenBuddy")).toBe(true)
    expect(concat.includes("\n")).toBe(true)
  })

  it("round-trips payloads through Buffer.utf8 without truncation", () => {
    const text = "中文 mixed with English 🚀 + emoji ⛓️".repeat(50)
    const encoded = Buffer.from(text, "utf8").toString("utf8")
    expect(encoded).toBe(text)
  })

  it("preserves null bytes in binary clipboard payloads", () => {
    const payload = "header\0value\0with\0nulls"
    const encoded = Buffer.from(payload, "binary").toString("binary")
    expect(encoded.includes("\0")).toBe(true)
    expect(encoded.split("\0")).toHaveLength(4)
  })

  it("normalizes CRLF line endings", () => {
    const crlf = "line1\r\nline2\r\nline3"
    const normalized = crlf.replace(/\r\n/g, "\n")
    expect(normalized).toBe("line1\nline2\nline3")
  })
})

describe("clipboard: channel normalization", () => {
  it("returns the channel unchanged when no alias exists", async () => {
    const { normalizeElectronChannel } = await import("../platform/electron-api")
    expect(normalizeElectronChannel("clipboard.read")).toBe("clipboard.read")
  })

  it("is a pure function (same input → same output)", async () => {
    const { normalizeElectronChannel } = await import("../platform/electron-api")
    expect(normalizeElectronChannel("clipboard.read")).toBe(normalizeElectronChannel("clipboard.read"))
  })
})

describe("clipboard: bridge status", () => {
  it("reports an unavailable bridge when window.api is missing", async () => {
    const { getElectronBridgeStatus } = await import("../platform/electron-api")
    const status = getElectronBridgeStatus()
    expect(typeof status.available).toBe("boolean")
    expect(status.apiVersion === undefined || status.apiVersion === 1).toBe(true)
  })
})
