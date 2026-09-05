import { describe, expect, it } from "vitest"
import {
  CASDOOR_RESOURCE_TYPES,
  isCasdoorResourceType,
  normalizeCasdoorResourceIdempotencyKey,
  normalizeCasdoorResourceMetadata,
  normalizeCasdoorResourceName,
} from "@openbuddy/auth-casdoor"

describe("casdoor-resources pure helpers", () => {
  describe("CASDOOR_RESOURCE_TYPES", () => {
    it("lists the canonical resource kinds", () => {
      expect(CASDOOR_RESOURCE_TYPES).toEqual(["project", "knowledge_base", "storage_connection"])
    })
  })

  describe("isCasdoorResourceType", () => {
    it("returns true for each known resource type", () => {
      for (const type of CASDOOR_RESOURCE_TYPES) {
        expect(isCasdoorResourceType(type)).toBe(true)
      }
    })
    it("returns false for unknown or non-string values", () => {
      expect(isCasdoorResourceType("foo")).toBe(false)
      expect(isCasdoorResourceType("")).toBe(false)
      expect(isCasdoorResourceType(undefined)).toBe(false)
      expect(isCasdoorResourceType(null)).toBe(false)
      expect(isCasdoorResourceType(42)).toBe(false)
      expect(isCasdoorResourceType({})).toBe(false)
    })
  })

  describe("normalizeCasdoorResourceMetadata", () => {
    it("returns {} for null, undefined, arrays, and primitives", () => {
      expect(normalizeCasdoorResourceMetadata(undefined)).toEqual({})
      expect(normalizeCasdoorResourceMetadata(null)).toEqual({})
      expect(normalizeCasdoorResourceMetadata("nope")).toEqual({})
      expect(normalizeCasdoorResourceMetadata([1, 2, 3])).toEqual({})
    })

    it("keeps primitive metadata values", () => {
      const out = normalizeCasdoorResourceMetadata({
        project: "alpha",
        count: 12,
        enabled: true,
        nullable: null,
      })
      expect(out).toEqual({ project: "alpha", count: 12, enabled: true, nullable: null })
    })

    it("drops entries with invalid keys", () => {
      const out = normalizeCasdoorResourceMetadata({
        "valid_key": "ok",
        "": "empty",
        "with space": "no",
        "with/slash": "no",
        ["a".repeat(81)]: "too long",
      })
      expect(out).toEqual({ valid_key: "ok" })
    })

    it("strips sensitive-looking keys (secret/password/token/credential/etc.)", () => {
      const out = normalizeCasdoorResourceMetadata({
        clientSecret: "should-drop",
        password: "should-drop",
        apiToken: "should-drop",
        credential: "should-drop",
        privateKey: "should-drop",
        accessKey: "should-drop",
        apiKeySecret: "should-drop",
        SAFE: "keep",
      })
      expect(out).toEqual({ SAFE: "keep" })
    })

    it("drops entries with non-primitive values", () => {
      const out = normalizeCasdoorResourceMetadata({
        a: "string",
        b: 1,
        c: true,
        d: null,
        e: { nested: "no" },
        f: [1, 2, 3],
      })
      expect(out).toEqual({ a: "string", b: 1, c: true, d: null })
    })

    it("truncates long strings to 2000 chars", () => {
      const long = "x".repeat(5000)
      const out = normalizeCasdoorResourceMetadata({ long })
      expect(out.long).toBe("x".repeat(2000))
    })

    it("respects the maxEntries bound", () => {
      const input: Record<string, number> = {}
      for (let i = 0; i < 200; i++) input[`k${i}`] = i
      const out = normalizeCasdoorResourceMetadata(input, 5)
      expect(Object.keys(out)).toHaveLength(5)
      expect(out.k0).toBe(0)
      expect(out.k4).toBe(4)
    })
  })

  describe("normalizeCasdoorResourceIdempotencyKey", () => {
    it("returns undefined for non-string values", () => {
      expect(normalizeCasdoorResourceIdempotencyKey(undefined)).toBeUndefined()
      expect(normalizeCasdoorResourceIdempotencyKey(null)).toBeUndefined()
      expect(normalizeCasdoorResourceIdempotencyKey(123)).toBeUndefined()
      expect(normalizeCasdoorResourceIdempotencyKey({})).toBeUndefined()
    })

    it("accepts canonical patterns and trims whitespace", () => {
      expect(normalizeCasdoorResourceIdempotencyKey("  abc_123.45 ")).toBe("abc_123.45")
    })

    it("rejects strings with illegal characters", () => {
      expect(normalizeCasdoorResourceIdempotencyKey("has space")).toBeUndefined()
      expect(normalizeCasdoorResourceIdempotencyKey("weird$char")).toBeUndefined()
      expect(normalizeCasdoorResourceIdempotencyKey("中文key")).toBeUndefined()
    })

    it("truncates to 120 characters and accepts the truncated key when valid", () => {
      const key = "a".repeat(120) + "B"
      const out = normalizeCasdoorResourceIdempotencyKey(key)
      expect(out).toBe("a".repeat(120))
    })

    it("returns undefined for empty string after trim", () => {
      expect(normalizeCasdoorResourceIdempotencyKey("   ")).toBeUndefined()
    })
  })

  describe("normalizeCasdoorResourceName", () => {
    it("returns empty string for non-string values", () => {
      expect(normalizeCasdoorResourceName(undefined)).toBe("")
      expect(normalizeCasdoorResourceName(null)).toBe("")
      expect(normalizeCasdoorResourceName(42)).toBe("")
      expect(normalizeCasdoorResourceName({})).toBe("")
    })

    it("replaces CR/LF/Tab with space and trims", () => {
      expect(normalizeCasdoorResourceName("  Hello\nWorld\t!  ")).toBe("Hello World !")
    })

    it("truncates to 200 characters", () => {
      const long = "a".repeat(250)
      const out = normalizeCasdoorResourceName(long)
      expect(out).toHaveLength(200)
    })

    it("preserves unicode names but strips control chars", () => {
      const out = normalizeCasdoorResourceName("项目名称 — Alpha")
      expect(out).toBe("项目名称 — Alpha")
    })
  })
})
