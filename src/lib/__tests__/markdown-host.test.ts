import { describe, expect, it } from "vitest"
import { pathStatToType } from "../markdown/markdown-host"

describe("markdown-host pure helpers", () => {
  describe("pathStatToType", () => {
    it("maps 'file' to 'file'", () => {
      expect(pathStatToType("file")).toBe("file")
    })
    it("maps 'directory' to 'directory'", () => {
      expect(pathStatToType("directory")).toBe("directory")
    })
    it("maps anything else to 'unknown'", () => {
      expect(pathStatToType("")).toBe("unknown")
      expect(pathStatToType("symlink")).toBe("unknown")
      expect(pathStatToType("FILE")).toBe("unknown") // case-sensitive
    })
  })
})
