import { describe, expect, it } from "vitest"
import { buildSessionMarkdown, sanitizeFilename } from "../files/export-markdown"

describe("export-markdown pure helpers", () => {
  describe("sanitizeFilename", () => {
    it("strips path traversal sequences", () => {
      expect(sanitizeFilename("../../etc/passwd")).not.toMatch(/\.\./)
    })
    it("replaces illegal chars with underscores", () => {
      expect(sanitizeFilename("a/b\\c:d*e?f\"g<h>i|j.txt")).toMatch(/^a_b_c_d_e_f_g_h_i_j\.txt$/)
    })
    it("preserves Unicode letters and digits", () => {
      expect(sanitizeFilename("会话-A1")).toBe("会话-A1")
    })
    it("falls back to untitled for empty input", () => {
      expect(sanitizeFilename("")).toBe("对话导出")
    })
  })

  describe("buildSessionMarkdown", () => {
    const messages = [
      { role: "user" as const, parts: [{ kind: "text", text: "Hello" }] },
      { role: "assistant" as const, parts: [{ kind: "text", text: "Hi there" }] },
    ]
    it("includes the title as a heading", () => {
      const md = buildSessionMarkdown(messages as never, "Sample Session")
      expect(md).toContain("# Sample Session")
    })
    it("uses default heading when title is missing", () => {
      const md = buildSessionMarkdown(messages as never)
      expect(md).toContain("# 对话导出")
    })
    it("includes user and assistant content", () => {
      const md = buildSessionMarkdown(messages as never, "T")
      expect(md).toContain("Hello")
      expect(md).toContain("Hi there")
    })
    it("returns a non-empty string", () => {
      expect(buildSessionMarkdown(messages as never).length).toBeGreaterThan(0)
    })
  })
})
